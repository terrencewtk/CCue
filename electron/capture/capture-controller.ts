import { NativeSidecar, errorMessage } from "../audio/native-sidecar";
import { CaptionService } from "../captions/caption-service";
import { segmentDraftSentences } from "../captions/caption-timeline";
import { LocalAsrStream } from "../local-asr/local-asr-stream";
import { LocalTranslationService } from "../local-translation/local-translation-service";
import { normalizeCaptureSettings } from "../settings/settings-store";
import type { AudioChunk, CaptureSettings, CaptureSettingsInput, SidecarEvent } from "../shared/types";
import { WindowManager } from "../ui/window-manager";

export class CaptureController {
  private readonly captions: CaptionService;
  private readonly localTranscription: LocalAsrStream;
  private readonly localTranslation: LocalTranslationService;
  private readonly sidecar: NativeSidecar;
  private capturing = false;
  private sessionId = 0;
  private audioClockMs = 0;
  private settings: CaptureSettings = normalizeCaptureSettings({});
  private partialTranslationTimer?: NodeJS.Timeout;
  private partialTranslationGeneration = 0;
  private readonly segmentTranslationCache = new Map<string, Promise<string>>();
  private translationReady = false;

  constructor(
    private readonly windows: WindowManager,
    private readonly validateSettings?: (settings: CaptureSettings) => Promise<void>
  ) {
    this.captions = new CaptionService(windows);
    this.localTranscription = new LocalAsrStream({
      onStatus: (detail) => this.windows.sendStatus({ state: "connecting", detail }),
      onFailure: (message) => this.handleTranscriptionFailure(message),
      onPartial: (utterance) => this.handlePartial(utterance, "apple-speech"),
      onFinal: (utterance) => this.handleFinal(utterance, "apple-speech")
    });
    this.localTranslation = new LocalTranslationService({
      onStatus: (detail) => this.windows.sendStatus({ state: "connecting", detail }),
      onFailure: (message) => this.handleTranslationFailure(message)
    });
    this.sidecar = new NativeSidecar({
      onEvent: (event) => this.handleSidecarEvent(event),
      onError: (message) => this.windows.sendStatus({ state: "error", detail: message }),
      onExit: (code) => this.handleSidecarExit(code)
    });
  }

  get isCapturing(): boolean { return this.capturing; }
  ensureSidecar(): void { this.sidecar.ensureRunning(); }
  clearCaptions(): void { this.captions.clear(); }

  async start(settingsInput: CaptureSettingsInput): Promise<{ ok: true }> {
    if (this.capturing) return { ok: true };
    const settings = normalizeCaptureSettings(settingsInput);
    await this.validateSettings?.(settings);

    this.settings = settings;
    this.sessionId += 1;
    this.captions.beginSession(settings.overlayLineCount);
    this.audioClockMs = 0;
    this.translationReady = false;
    this.cancelPartialTranslation();
    this.segmentTranslationCache.clear();
    this.localTranslation.close();
    this.windows.showOverlay();
    this.windows.sendStatus({ state: "connecting", detail: "Preparing on-device transcription" });
    this.capturing = true;

    try {
      if (settings.translationEnabled) {
        try {
          await this.localTranslation.open(settings.language, settings.translationLanguage);
          this.translationReady = true;
        } catch (error) {
          this.localTranslation.close();
          const message = errorMessage(error);
          if (!await this.windows.confirmStartWithoutTranslation(message)) throw error;
          this.settings = { ...settings, translationEnabled: false };
          this.windows.sendStatus({ state: "connecting", detail: "Starting captions without translation" });
        }
      }
      await this.localTranscription.open(settings.language);
      this.sendCapturingStatus("Offline transcription ready");
    } catch (error) {
      this.sessionId += 1;
      this.capturing = false;
      this.localTranscription.close();
      this.localTranslation.close();
      this.translationReady = false;
      this.windows.hideOverlay();
      this.windows.sendStatus({ state: "error", detail: errorMessage(error) });
      throw error;
    }
    this.sidecar.send("start");
    return { ok: true };
  }

  async stop(): Promise<{ ok: true }> {
    if (!this.capturing) {
      this.windows.hideOverlay();
      return { ok: true };
    }
    this.sessionId += 1;
    this.capturing = false;
    this.windows.hideOverlay();
    this.sidecar.send("stop");
    await this.localTranscription.stop();
    this.cancelPartialTranslation();
    this.segmentTranslationCache.clear();
    this.localTranslation.close();
    this.translationReady = false;
    this.audioClockMs = 0;
    this.windows.sendStatus({ state: "idle", detail: "Capture stopped" });
    return { ok: true };
  }

  quit(): void {
    this.capturing = false;
    this.sidecar.quit();
    this.localTranscription.close();
    this.localTranslation.close();
    this.segmentTranslationCache.clear();
    this.translationReady = false;
  }

  private handleSidecarEvent(event: SidecarEvent): void {
    if (event.type === "capture_started") {
      this.sendCapturingStatus(`System audio ${event.sample_rate} Hz -> offline transcription at 16 kHz`);
    } else if (event.type === "audio" && this.capturing && event.pcm16) {
      this.appendAudio(event.pcm16);
    } else if (event.type === "error") {
      this.handleTranscriptionFailure(event.message || "Native capture failed");
    }
  }

  private handleSidecarExit(code: number | null): void {
    if (this.capturing) this.handleTranscriptionFailure(`Native capture exited (${code ?? "signal"})`);
  }

  private appendAudio(data: string): void {
    const durationMs = Buffer.from(data, "base64").length / 32;
    const startMs = this.audioClockMs;
    const endMs = startMs + durationMs;
    this.audioClockMs = endMs;
    this.captions.markAudioTime(endMs);
    const chunk: AudioChunk = { data, durationMs, startMs, endMs };
    this.localTranscription.appendAudio(chunk);
  }

  private handleTranscriptionFailure(message: string): void {
    if (!this.capturing) {
      this.windows.sendStatus({ state: "error", detail: message });
      return;
    }
    this.sessionId += 1;
    this.capturing = false;
    this.sidecar.send("stop");
    this.localTranscription.close();
    this.localTranslation.close();
    this.segmentTranslationCache.clear();
    this.translationReady = false;
    this.windows.hideOverlay();
    this.windows.sendStatus({ state: "error", detail: message });
  }

  private sendCapturingStatus(detail: string): void {
    this.windows.sendStatus({ state: "capturing", detail });
  }

  private handlePartial(utterance: Parameters<CaptionService["updateLiveCaption"]>[0], source: string): void {
    this.captions.updateLiveCaption({ ...utterance, translation: "" }, source, true);
    this.cancelPartialTranslation();
    if (!this.translationReady || !utterance.text.trim()) return;
    const segments = segmentDraftSentences(utterance.text);

    const generation = this.partialTranslationGeneration;
    const sessionId = this.sessionId;
    this.partialTranslationTimer = setTimeout(() => {
      this.partialTranslationTimer = undefined;
      void Promise.all(segments.map((segment) => this.translateSegment(segment))).then((translations) => {
        if (
          !this.capturing
          || sessionId !== this.sessionId
          || generation !== this.partialTranslationGeneration
        ) return;
        const translation = translations
          .map((value) => value.replace(/\s+/gu, " ").trim())
          .join("\n");
        this.captions.updateLiveCaption({ ...utterance, translation }, source);
      }).catch((error) => this.reportTranslationError(error));
    }, 180);
  }

  private translateSegment(segment: string): Promise<string> {
    const cached = this.segmentTranslationCache.get(segment);
    if (cached) return cached;

    const request = this.localTranslation.translate(segment).catch((error) => {
      if (this.segmentTranslationCache.get(segment) === request) {
        this.segmentTranslationCache.delete(segment);
      }
      throw error;
    });
    this.segmentTranslationCache.set(segment, request);
    return request;
  }

  private handleFinal(utterance: Parameters<CaptionService["commitUtterance"]>[0], source: string): void {
    this.cancelPartialTranslation();
    const id = this.captions.commitUtterance({ ...utterance, translation: "" }, source, true);
    if (!id || !this.translationReady || !utterance.text.trim()) return;

    const sessionId = this.sessionId;
    const segments = segmentDraftSentences(utterance.text);
    void Promise.all(segments.map((segment) => this.translateSegment(segment))).then((translations) => {
      if (!this.capturing || sessionId !== this.sessionId) return;
      const translation = translations
        .map((value) => value.replace(/\s+/gu, " ").trim())
        .join("\n");
      this.captions.setTranslation(id, translation);
    }).catch((error) => this.reportTranslationError(error));
  }

  private cancelPartialTranslation(): void {
    this.partialTranslationGeneration += 1;
    if (this.partialTranslationTimer) clearTimeout(this.partialTranslationTimer);
    this.partialTranslationTimer = undefined;
  }

  private reportTranslationError(error: unknown): void {
    if (!this.capturing || !this.translationReady) return;
    console.warn("[local-translation] Caption translation failed", error);
    this.windows.sendStatus({
      state: "capturing",
      detail: `Captions active; local translation failed: ${errorMessage(error)}`
    });
  }

  private handleTranslationFailure(message: string): void {
    this.translationReady = false;
    this.cancelPartialTranslation();
    this.segmentTranslationCache.clear();
    this.localTranslation.close();
    this.windows.sendStatus({
      state: this.capturing ? "capturing" : "error",
      detail: this.capturing ? `Captions active; local translation stopped: ${message}` : message
    });
  }
}
