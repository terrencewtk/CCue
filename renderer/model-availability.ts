import { sameTranslationLanguage } from "./language-catalog.js";

interface ModelAvailabilityBridge {
  getTranscriptionModelAvailability(language: string): Promise<ModelAvailability>;
  getTranslationModelAvailability(source: string, target: string): Promise<ModelAvailability>;
}

export interface ModelChecker {
  run<T>(operation: () => Promise<T>): Promise<T>;
  transcription(language: string): Promise<ModelAvailability>;
  translation(source: string, target: string): Promise<ModelAvailability>;
}

export function createModelChecker(captions: ModelAvailabilityBridge): ModelChecker {
  let operationQueue: Promise<unknown> = Promise.resolve();

  function run<T>(operation: () => Promise<T>): Promise<T> {
    const result = operationQueue.then(operation, operation);
    operationQueue = result.catch(() => {});
    return result;
  }

  return {
    run,
    transcription: (language: string) => run(() => captions.getTranscriptionModelAvailability(language)),
    translation: (sourceLanguage: string, targetLanguage: string) => run(() => (
      captions.getTranslationModelAvailability(sourceLanguage, targetLanguage)
    ))
  };
}

export function isReady(availability: ModelAvailability): boolean {
  return availability.supported && availability.installed;
}

export interface SelectedModelSnapshot {
  settings: CaptureSettings;
  library: LanguageLibrary;
}

export interface SelectedModelReadiness {
  ready: boolean;
  detail: string;
}

export class SelectedModelReadinessController {
  private pending?: SelectedModelSnapshot;
  private running = false;

  constructor(
    private readonly checker: ModelChecker,
    private readonly onChecking: (snapshot: SelectedModelSnapshot) => void,
    private readonly onResult: (snapshot: SelectedModelSnapshot, result: SelectedModelReadiness) => void
  ) {}

  request(snapshot: SelectedModelSnapshot): void {
    this.pending = snapshot;
    if (!this.running) void this.drain();
  }

  private async drain(): Promise<void> {
    this.running = true;
    while (this.pending) {
      const snapshot = this.pending;
      this.pending = undefined;
      this.onChecking(snapshot);
      const result = await this.check(snapshot);
      if (!this.pending) this.onResult(snapshot, result);
    }
    this.running = false;
  }

  private async check(snapshot: SelectedModelSnapshot): Promise<SelectedModelReadiness> {
    const { settings, library } = snapshot;
    if (!library.enabledTranscriptionLanguages.includes(settings.language)) {
      return { ready: false, detail: "Choose an enabled transcription language." };
    }
    try {
      if (!isReady(await this.checker.transcription(settings.language))) {
        return { ready: false, detail: "The selected transcription model is not ready. Manage it in Settings." };
      }
      if (!settings.translationEnabled) return { ready: true, detail: "Selected transcription model is ready." };
      if (sameTranslationLanguage(settings.language, settings.translationLanguage)) {
        return { ready: false, detail: "The spoken and translation languages must be different." };
      }
      if (!library.enabledTranslationPairs.some((pair) => (
        pair.sourceLanguage === settings.language && pair.targetLanguage === settings.translationLanguage
      ))) {
        return { ready: false, detail: "Choose an enabled translation pair." };
      }
      if (!isReady(await this.checker.translation(settings.language, settings.translationLanguage))) {
        return { ready: false, detail: "The selected translation pair is not ready. Manage it in Settings." };
      }
      return { ready: true, detail: "Selected on-device models are ready." };
    } catch (error) {
      return { ready: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }
}
