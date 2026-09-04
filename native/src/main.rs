mod capture;

use anyhow::Result;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use capture::SystemAudioCapture;
use rubato::audioadapter_buffers::direct::InterleavedSlice;
use rubato::{Fft, FixedSync, Resampler};
use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, BufWriter, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

const TARGET_SAMPLE_RATE: u32 = 16_000;
const OUTPUT_CHUNK_SAMPLES: usize = 1_600;

#[derive(Deserialize)]
struct Command {
    command: String,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum SidecarEvent<'a> {
    Ready,
    CaptureStarted { sample_rate: u32, output_rate: u32 },
    CaptureStopped,
    Audio { pcm16: &'a str, samples: usize },
    Error { message: &'a str },
}

struct StreamingResampler {
    source_rate: u32,
    inner: Fft<f32>,
    input_samples: Vec<f32>,
}

impl StreamingResampler {
    fn new(source_rate: u32) -> Result<Self> {
        let source_rate = source_rate.max(1);
        let input_chunk_frames = (source_rate / 10).max(1) as usize;
        let inner = Fft::<f32>::new(
            source_rate as usize,
            TARGET_SAMPLE_RATE as usize,
            input_chunk_frames,
            1,
            FixedSync::Input,
        )?;
        Ok(Self {
            source_rate,
            inner,
            input_samples: Vec::with_capacity(input_chunk_frames * 2),
        })
    }

    fn source_rate(&self) -> u32 {
        self.source_rate
    }

    fn push(&mut self, samples: &[f32], output: &mut Vec<f32>) -> Result<()> {
        self.input_samples.extend_from_slice(samples);
        loop {
            let input_frames = self.inner.input_frames_next();
            if self.input_samples.len() < input_frames {
                break;
            }

            let output_frames = self.inner.output_frames_next();
            let input =
                InterleavedSlice::new(&self.input_samples[..input_frames], 1, input_frames)?;
            let mut resampled = vec![0.0_f32; output_frames];
            let mut output_buffer = InterleavedSlice::new_mut(&mut resampled, 1, output_frames)?;
            let (consumed, written) =
                self.inner
                    .process_into_buffer(&input, &mut output_buffer, None)?;
            output.extend_from_slice(&resampled[..written]);
            self.input_samples.drain(..consumed);
        }
        Ok(())
    }
}

type SharedOutput = Arc<Mutex<BufWriter<io::Stdout>>>;

fn emit<T: Serialize>(output: &SharedOutput, event: &T) {
    let Ok(line) = serde_json::to_string(event) else {
        return;
    };
    if let Ok(mut writer) = output.lock() {
        let _ = writeln!(writer, "{line}");
        let _ = writer.flush();
    }
}

fn main() {
    let output = Arc::new(Mutex::new(BufWriter::new(io::stdout())));
    emit(&output, &SidecarEvent::Ready);

    let mut capture_stop: Option<Arc<AtomicBool>> = None;
    let mut capture_thread: Option<thread::JoinHandle<()>> = None;

    for line in io::stdin().lock().lines().map_while(Result::ok) {
        let Ok(command) = serde_json::from_str::<Command>(&line) else {
            emit(
                &output,
                &SidecarEvent::Error {
                    message: "invalid sidecar command",
                },
            );
            continue;
        };

        match command.command.as_str() {
            "start" if capture_thread.is_none() => {
                let stop = Arc::new(AtomicBool::new(false));
                let thread_stop = stop.clone();
                let thread_output = output.clone();
                capture_stop = Some(stop);
                capture_thread = Some(thread::spawn(move || {
                    run_capture(thread_output, thread_stop)
                }));
            }
            "stop" => {
                if let Some(stop) = capture_stop.take() {
                    stop.store(true, Ordering::Release);
                }
                if let Some(handle) = capture_thread.take() {
                    let _ = handle.join();
                }
            }
            "quit" => {
                if let Some(stop) = capture_stop.take() {
                    stop.store(true, Ordering::Release);
                }
                if let Some(handle) = capture_thread.take() {
                    let _ = handle.join();
                }
                break;
            }
            "start" => emit(
                &output,
                &SidecarEvent::Error {
                    message: "capture is already running",
                },
            ),
            _ => emit(
                &output,
                &SidecarEvent::Error {
                    message: "unknown sidecar command",
                },
            ),
        }
    }
}

fn run_capture(output: SharedOutput, stop: Arc<AtomicBool>) {
    let mut capture = match SystemAudioCapture::start() {
        Ok(capture) => capture,
        Err(error) => {
            let message = format!("failed to start CoreAudio process tap: {error:#}");
            emit(&output, &SidecarEvent::Error { message: &message });
            return;
        }
    };

    let source_rate = capture.sample_rate();
    emit(
        &output,
        &SidecarEvent::CaptureStarted {
            sample_rate: source_rate,
            output_rate: TARGET_SAMPLE_RATE,
        },
    );

    let mut resampler = match StreamingResampler::new(source_rate) {
        Ok(resampler) => resampler,
        Err(error) => {
            let message = format!("failed to initialize audio resampler: {error:#}");
            emit(&output, &SidecarEvent::Error { message: &message });
            return;
        }
    };
    let mut source_samples = Vec::with_capacity(8192);
    let mut resampled_samples = Vec::with_capacity(OUTPUT_CHUNK_SAMPLES * 2);
    let mut output_samples = Vec::with_capacity(OUTPUT_CHUNK_SAMPLES * 2);

    while !stop.load(Ordering::Acquire) {
        source_samples.clear();
        if capture.read_available(&mut source_samples, 8192) == 0 {
            thread::sleep(Duration::from_millis(4));
            continue;
        }

        let current_source_rate = capture.sample_rate().max(1);
        if current_source_rate != resampler.source_rate() {
            resampler = match StreamingResampler::new(current_source_rate) {
                Ok(resampler) => resampler,
                Err(error) => {
                    let message = format!("failed to update audio resampler: {error:#}");
                    emit(&output, &SidecarEvent::Error { message: &message });
                    return;
                }
            };
        }

        resampled_samples.clear();
        if let Err(error) = resampler.push(&source_samples, &mut resampled_samples) {
            let message = format!("audio resampling failed: {error:#}");
            emit(&output, &SidecarEvent::Error { message: &message });
            return;
        }
        output_samples.extend(resampled_samples.iter().copied().map(float_to_pcm16));

        while output_samples.len() >= OUTPUT_CHUNK_SAMPLES {
            let chunk: Vec<i16> = output_samples.drain(..OUTPUT_CHUNK_SAMPLES).collect();
            emit_audio(&output, &chunk);
        }
    }

    if !output_samples.is_empty() {
        emit_audio(&output, &output_samples);
    }
    emit(&output, &SidecarEvent::CaptureStopped);
}

fn float_to_pcm16(sample: f32) -> i16 {
    let scaled = sample.clamp(-1.0, 1.0) * i16::MAX as f32;
    scaled.round() as i16
}

fn emit_audio(output: &SharedOutput, samples: &[i16]) {
    let mut bytes = Vec::with_capacity(samples.len() * 2);
    for sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    let pcm16 = BASE64.encode(bytes);
    emit(
        output,
        &SidecarEvent::Audio {
            pcm16: &pcm16,
            samples: samples.len(),
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::TAU;

    fn resample_tone(frequency: f32) -> Vec<f32> {
        let source_rate = 48_000_u32;
        let input: Vec<f32> = (0..source_rate)
            .map(|sample| (TAU * frequency * sample as f32 / source_rate as f32).sin())
            .collect();
        let mut output = Vec::new();
        let mut resampler = StreamingResampler::new(source_rate).unwrap();
        resampler.push(&input, &mut output).unwrap();
        output
    }

    fn settled_rms(samples: &[f32]) -> f32 {
        let margin = TARGET_SAMPLE_RATE as usize / 10;
        let settled = &samples[margin..samples.len() - margin];
        (settled.iter().map(|sample| sample * sample).sum::<f32>() / settled.len() as f32).sqrt()
    }

    #[test]
    fn preserves_speech_band_audio() {
        let output = resample_tone(1_000.0);
        assert!(output.len() >= 15_000);
        assert!(settled_rms(&output) > 0.6);
    }

    #[test]
    fn attenuates_audio_above_the_target_nyquist_limit() {
        let output = resample_tone(12_000.0);
        assert!(settled_rms(&output) < 0.05);
    }
}
