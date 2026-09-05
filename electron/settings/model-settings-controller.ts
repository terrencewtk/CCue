import type {
  CaptureSettings,
  CaptureSettingsInput,
  ModelAvailability,
  ModelSettingsResult
} from "../shared/types";

export type ModelSettingsAction =
  | { type: "refresh" }
  | { type: "prepare-transcription"; language: string }
  | { type: "delete-transcription"; language: string }
  | { type: "prepare-translation"; language: string };

export interface ModelSettingsDependencies {
  normalize(settings: CaptureSettingsInput): CaptureSettings;
  read(): CaptureSettings;
  commit(settings: CaptureSettings): void;
  transcriptionLanguages(): Promise<string[]>;
  translationLanguages(sourceLanguage: string): Promise<string[]>;
  transcriptionAvailability(language: string): Promise<ModelAvailability>;
  translationAvailability(sourceLanguage: string, targetLanguage: string): Promise<ModelAvailability>;
  prepareTranscription(language: string): Promise<unknown>;
  deleteTranscription(language: string): Promise<unknown>;
  prepareTranslation(sourceLanguage: string, targetLanguage: string): Promise<unknown>;
}

function canonical(value: string): string | undefined {
  try {
    return Intl.getCanonicalLocales(value)[0];
  } catch {
    return undefined;
  }
}

function sameLanguage(left: string, right: string): boolean {
  try {
    const a = new Intl.Locale(left).maximize();
    const b = new Intl.Locale(right).maximize();
    return a.language === b.language && (a.language !== "zh" || a.script === b.script);
  } catch {
    return left.toLocaleLowerCase() === right.toLocaleLowerCase();
  }
}

function uniqueLanguages(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const normalized = canonical(value);
    if (!normalized || seen.has(normalized.toLocaleLowerCase())) return [];
    seen.add(normalized.toLocaleLowerCase());
    return [normalized];
  });
}

function resolveLanguage(preferred: string, available: readonly string[], fallback: string): string | undefined {
  const preferredCanonical = canonical(preferred)?.toLocaleLowerCase();
  return available.find((value) => canonical(value)?.toLocaleLowerCase() === preferredCanonical)
    ?? available.find((value) => sameLanguage(value, preferred))
    ?? available.find((value) => sameLanguage(value, fallback))
    ?? available[0];
}

export class ModelSettingsController {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly dependencies: ModelSettingsDependencies) {}

  run(candidate: CaptureSettingsInput, action: ModelSettingsAction = { type: "refresh" }): Promise<ModelSettingsResult> {
    const operation = this.queue.then(() => this.perform(candidate, action));
    this.queue = operation.catch(() => {});
    return operation;
  }

  saveGeneral(candidate: CaptureSettingsInput): Promise<CaptureSettings> {
    const operation = this.queue.then(() => {
      const settings = this.dependencies.normalize({
        ...this.dependencies.read(),
        overlayLineCount: candidate.overlayLineCount,
        globalShortcut: candidate.globalShortcut
      });
      this.dependencies.commit(settings);
      return settings;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  private async perform(candidate: CaptureSettingsInput, action: ModelSettingsAction): Promise<ModelSettingsResult> {
    const normalized = this.dependencies.normalize(candidate);
    const transcriptionLanguages = uniqueLanguages(await this.dependencies.transcriptionLanguages());
    const sourceLanguage = resolveLanguage(normalized.language, transcriptionLanguages, "en-US");
    if (!sourceLanguage) throw new Error("Apple reported no transcription languages available on this Mac.");

    const translationLanguages = uniqueLanguages(
      await this.dependencies.translationLanguages(sourceLanguage)
    ).filter((language) => !sameLanguage(language, sourceLanguage));
    const selectedTranslationLanguage = resolveLanguage(
      normalized.translationLanguage,
      translationLanguages,
      "en-US"
    ) ?? null;
    const settings = this.dependencies.normalize({
      ...normalized,
      language: sourceLanguage,
      translationEnabled: normalized.translationEnabled && selectedTranslationLanguage !== null,
      translationLanguage: selectedTranslationLanguage ?? normalized.translationLanguage
    });

    if (action.type === "prepare-transcription") {
      await this.dependencies.prepareTranscription(action.language);
    } else if (action.type === "delete-transcription") {
      await this.dependencies.deleteTranscription(action.language);
    } else if (action.type === "prepare-translation") {
      if (!selectedTranslationLanguage || !translationLanguages.includes(action.language)) {
        throw new Error("That translation target is not available for the selected spoken language.");
      }
      await this.dependencies.prepareTranslation(sourceLanguage, action.language);
    }

    this.dependencies.commit(settings);

    const transcription = [];
    for (const language of transcriptionLanguages) {
      transcription.push({
        language,
        availability: await this.dependencies.transcriptionAvailability(language)
      });
    }
    const translation = [];
    for (const language of translationLanguages) {
      translation.push({
        language,
        availability: await this.dependencies.translationAvailability(sourceLanguage, language)
      });
    }
    return { settings, transcription, translation, selectedTranslationLanguage };
  }
}
