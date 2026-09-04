// The CoreAudio process-tap and aggregate-device setup in this file was adapted
// from Pluely's GPL-3.0 macOS speaker capture implementation:
// https://github.com/iamsrikanthnani/pluely/blob/e6ac1760be308c0a06287fa3d24df0c4a98bdf44/src-tauri/src/speaker/macos.rs

use anyhow::Result;
use cidre::core_audio::aggregate_device_keys as agg_keys;
use cidre::{arc, av, cat, cf, core_audio as ca, ns, os};
use ringbuf::{
    traits::{Consumer, Producer, Split},
    HeapCons, HeapProd, HeapRb,
};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

pub struct SystemAudioCapture {
    consumer: HeapCons<f32>,
    sample_rate: Arc<AtomicU32>,
    _device: ca::hardware::StartedDevice<ca::AggregateDevice>,
    _context: Box<CaptureContext>,
    _tap: ca::TapGuard,
}

struct CaptureContext {
    format: arc::R<av::AudioFormat>,
    producer: HeapProd<f32>,
    sample_rate: Arc<AtomicU32>,
    overflowed: Arc<AtomicBool>,
}

impl SystemAudioCapture {
    pub fn start() -> Result<Self> {
        let output_device = ca::System::default_output_device()?;
        let output_uid = output_device.uid()?;

        let sub_device = cf::DictionaryOf::with_keys_values(
            &[ca::sub_device_keys::uid()],
            &[output_uid.as_type_ref()],
        );

        let tap_description =
            ca::TapDesc::with_mono_global_tap_excluding_processes(&ns::Array::new());
        let tap = tap_description.create_process_tap()?;
        let tap_uid = tap.uid()?;

        let sub_tap = cf::DictionaryOf::with_keys_values(
            &[ca::sub_device_keys::uid()],
            &[tap_uid.as_type_ref()],
        );

        let aggregate_description = cf::DictionaryOf::with_keys_values(
            &[
                agg_keys::is_private(),
                agg_keys::is_stacked(),
                agg_keys::tap_auto_start(),
                agg_keys::name(),
                agg_keys::main_sub_device(),
                agg_keys::uid(),
                agg_keys::sub_device_list(),
                agg_keys::tap_list(),
            ],
            &[
                cf::Boolean::value_true().as_type_ref(),
                cf::Boolean::value_false(),
                cf::Boolean::value_true(),
                cf::str!(c"live-caption-system-audio"),
                &output_uid,
                &cf::Uuid::new().to_cf_string(),
                &cf::ArrayOf::from_slice(&[sub_device.as_ref()]),
                &cf::ArrayOf::from_slice(&[sub_tap.as_ref()]),
            ],
        );

        let asbd = tap.asbd()?;
        let format = av::AudioFormat::with_asbd(&asbd)
            .ok_or_else(|| anyhow::anyhow!("CoreAudio returned an unsupported stream format"))?;
        let ring = HeapRb::<f32>::new(1024 * 256);
        let (producer, consumer) = ring.split();
        let sample_rate = Arc::new(AtomicU32::new(asbd.sample_rate as u32));
        let overflowed = Arc::new(AtomicBool::new(false));
        let mut context = Box::new(CaptureContext {
            format,
            producer,
            sample_rate: sample_rate.clone(),
            overflowed,
        });

        let aggregate_device = ca::AggregateDevice::with_desc(&aggregate_description)?;
        let proc_id = aggregate_device.create_io_proc_id(audio_callback, Some(&mut context))?;
        let started_device = ca::device_start(aggregate_device, Some(proc_id))?;

        Ok(Self {
            consumer,
            sample_rate,
            _device: started_device,
            _context: context,
            _tap: tap,
        })
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate.load(Ordering::Acquire)
    }

    pub fn read_available(&mut self, output: &mut Vec<f32>, limit: usize) -> usize {
        let start = output.len();
        while output.len() - start < limit {
            match self.consumer.try_pop() {
                Some(sample) => output.push(sample),
                None => break,
            }
        }
        output.len() - start
    }
}

extern "C" fn audio_callback(
    device: ca::Device,
    _now: &cat::AudioTimeStamp,
    input_data: &cat::AudioBufList<1>,
    _input_time: &cat::AudioTimeStamp,
    _output_data: &mut cat::AudioBufList<1>,
    _output_time: &cat::AudioTimeStamp,
    context: Option<&mut CaptureContext>,
) -> os::Status {
    let Some(context) = context else {
        return os::Status::NO_ERR;
    };

    if let Ok(rate) = device.actual_sample_rate() {
        context.sample_rate.store(rate as u32, Ordering::Release);
    }

    if let Some(buffer) = av::AudioPcmBuf::with_buf_list_no_copy(&context.format, input_data, None)
    {
        if let Some(samples) = buffer.data_f32_at(0) {
            let pushed = context.producer.push_slice(samples);
            if pushed < samples.len() && !context.overflowed.swap(true, Ordering::AcqRel) {
                eprintln!("audio ring buffer overflow; dropping samples");
            } else if pushed == samples.len() {
                context.overflowed.store(false, Ordering::Release);
            }
        }
    }

    os::Status::NO_ERR
}
