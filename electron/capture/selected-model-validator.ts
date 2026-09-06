import type { CaptureSettings, LanguageLibrary, ModelAvailability } from "../shared/types";

export interface SelectedModelValidatorDependencies {
  transcription(language: string): Promise<ModelAvailability>;
  translation(source: string, target: string): Promise<ModelAvailability>;
}

function sameIdentifier(left: string, right: string): boolean {
  return left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US");
}

function includes(values: readonly string[], language: string): boolean {
  return values.some((value) => sameIdentifier(value, language));
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

export async function validateSelectedModels(
  settings: CaptureSettings,
  library: LanguageLibrary,
  dependencies: SelectedModelValidatorDependencies
): Promise<void> {
  if (!includes(library.enabledTranscriptionLanguages, settings.language)) {
    throw new Error("The selected transcription language is not enabled.");
  }
  const transcription = await dependencies.transcription(settings.language);
  if (!transcription.supported || !transcription.installed) {
    throw new Error("The selected transcription model is not ready.");
  }
  if (!settings.translationEnabled) return;
  if (sameLanguage(settings.language, settings.translationLanguage)) {
    throw new Error("The spoken and translation languages must be different.");
  }
  if (!library.enabledTranslationPairs.some((pair) => (
    sameIdentifier(pair.sourceLanguage, settings.language)
    && sameIdentifier(pair.targetLanguage, settings.translationLanguage)
  ))) {
    throw new Error("The selected translation pair is not enabled.");
  }
  const translation = await dependencies.translation(settings.language, settings.translationLanguage);
  if (!translation.supported || !translation.installed) {
    throw new Error("The selected translation language pair is not ready.");
  }
}
