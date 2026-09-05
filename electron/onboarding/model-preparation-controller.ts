import { errorMessage } from "../audio/native-sidecar";
import { LocalAsrStream } from "../local-asr/local-asr-stream";
import { LocalTranslationService } from "../local-translation/local-translation-service";
import type { WindowManager } from "../ui/window-manager";

export interface ModelPreparationStatus {
  model: "transcription" | "translation";
  state: "preparing" | "ready" | "error";
  detail: string;
  percent?: number;
}

function progressFrom(detail: string): number | undefined {
  const match = detail.match(/download:\s*(\d+)%/i);
  return match ? Number(match[1]) : undefined;
}

export class ModelPreparationController {
  private active?: "transcription" | "translation";
  private operationQueue: Promise<void> = Promise.resolve();
  private readonly transcription: LocalAsrStream;
  private readonly translation: LocalTranslationService;

  constructor(private readonly windows: WindowManager) {
    this.transcription = new LocalAsrStream({
      onStatus: (detail) => this.send("transcription", "preparing", detail, progressFrom(detail)),
      onPartial: () => {},
      onFinal: () => {},
      onFailure: (detail) => this.send("transcription", "error", detail)
    });
    this.translation = new LocalTranslationService({
      onStatus: (detail) => this.send("translation", "preparing", detail),
      onFailure: (detail) => this.send("translation", "error", detail)
    });
  }

  async transcriptionAvailability(language: string): Promise<{ installed: boolean; supported: boolean; deletable: boolean }> {
    return this.enqueue("transcription", () => this.transcription.checkAvailability(language));
  }

  async transcriptionLanguages(): Promise<string[]> {
    return this.enqueue("transcription", () => this.transcription.supportedLanguages());
  }

  async translationLanguages(sourceLanguage?: string): Promise<string[]> {
    return this.enqueue("translation", () => this.translation.supportedLanguages(sourceLanguage));
  }

  async translationAvailability(
    sourceLanguage: string,
    targetLanguage: string
  ): Promise<{ installed: boolean; supported: boolean; deletable: boolean }> {
    return this.enqueue("translation", () => (
      this.translation.checkAvailability(sourceLanguage, targetLanguage)
    ));
  }

  async prepareTranscription(language: string): Promise<{ ok: true }> {
    return this.enqueue("transcription", async () => {
      this.send("transcription", "preparing", "Checking the on-device transcription model…", 0);
      try {
        await this.transcription.open(language);
        this.send("transcription", "ready", "Transcription language is ready for offline captions.", 100);
        return { ok: true };
      } catch (error) {
        const detail = errorMessage(error);
        this.send("transcription", "error", detail);
        throw error;
      } finally {
        this.transcription.close();
      }
    });
  }

  async releaseTranscription(language: string): Promise<{ ok: true }> {
    return this.enqueue("transcription", async () => {
      const released = await this.transcription.release(language);
      if (!released) throw new Error("This model can’t be deleted right now");
      return { ok: true };
    });
  }

  async prepareTranslation(sourceLanguage: string, targetLanguage: string): Promise<{ ok: true }> {
    return this.enqueue("translation", async () => {
      this.send("translation", "preparing", "Checking the required Apple Translation languages…");
      try {
        await this.translation.open(sourceLanguage, targetLanguage);
        this.send("translation", "ready", "Translation languages are installed and ready.");
        return { ok: true };
      } catch (error) {
        const detail = errorMessage(error);
        this.send("translation", "error", detail);
        throw error;
      } finally {
        this.translation.close();
      }
    });
  }

  close(): void {
    this.transcription.close();
    this.translation.close();
    this.active = undefined;
  }

  private begin(model: "transcription" | "translation"): void {
    this.active = model;
  }

  private enqueue<T>(model: "transcription" | "translation", operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(async () => {
      this.begin(model);
      try {
        return await operation();
      } finally {
        this.active = undefined;
      }
    });
    this.operationQueue = result.then(() => {}, () => {});
    return result;
  }

  private send(
    model: ModelPreparationStatus["model"],
    state: ModelPreparationStatus["state"],
    detail: string,
    percent?: number
  ): void {
    this.windows.sendOnboardingStatus({ model, state, detail, percent });
  }
}
