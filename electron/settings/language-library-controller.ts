import {
  LANGUAGE_LIBRARY_VERSION,
  type LanguageLibrary,
  type LanguageLibraryStatus,
  type ModelAvailability,
  type SettingsSnapshot,
  type TranslationPair
} from "../shared/types";
import { canonicalLanguageIdentifier } from "./settings-store";

export type LanguageLibraryAction =
  | { type: "refresh" }
  | { type: "enable-transcription"; language: string }
  | { type: "disable-transcription"; language: string }
  | { type: "prepare-transcription"; language: string }
  | { type: "delete-transcription"; language: string }
  | { type: "enable-translation-pair"; sourceLanguage: string; targetLanguage: string }
  | { type: "disable-translation-pair"; sourceLanguage: string; targetLanguage: string }
  | { type: "prepare-translation-pair"; sourceLanguage: string; targetLanguage: string };

export interface LanguageLibraryDependencies {
  read(): SettingsSnapshot;
  commit(snapshot: SettingsSnapshot): void;
  transcriptionAvailability(language: string): Promise<ModelAvailability>;
  translationAvailability(sourceLanguage: string, targetLanguage: string): Promise<ModelAvailability>;
  prepareTranscription(language: string): Promise<unknown>;
  deleteTranscription(language: string): Promise<unknown>;
  prepareTranslation(sourceLanguage: string, targetLanguage: string): Promise<unknown>;
  modelMutationCompleted?(library: LanguageLibrary): void;
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

function sameIdentifier(left: string, right: string): boolean {
  return left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US");
}

function normalizedPair(action: { sourceLanguage: string; targetLanguage: string }): TranslationPair {
  const sourceLanguage = canonicalLanguageIdentifier(action.sourceLanguage);
  const targetLanguage = canonicalLanguageIdentifier(action.targetLanguage);
  if (!sourceLanguage || !targetLanguage) {
    throw new Error("That translation pair contains an invalid language identifier.");
  }
  if (sameLanguage(sourceLanguage, targetLanguage)) {
    throw new Error("The spoken and translation languages must be different.");
  }
  return { sourceLanguage, targetLanguage };
}

function hasPair(pairs: readonly TranslationPair[], pair: TranslationPair): boolean {
  return pairs.some((candidate) => (
    sameIdentifier(candidate.sourceLanguage, pair.sourceLanguage)
    && sameIdentifier(candidate.targetLanguage, pair.targetLanguage)
  ));
}

function updateLibrary(library: LanguageLibrary, action: LanguageLibraryAction): LanguageLibrary {
  if (action.type === "enable-transcription") {
    const language = canonicalLanguageIdentifier(action.language);
    if (!language) throw new Error("That language identifier is invalid.");
    if (library.enabledTranscriptionLanguages.some((value) => sameIdentifier(value, language))) return library;
    return {
      ...library,
      version: LANGUAGE_LIBRARY_VERSION,
      enabledTranscriptionLanguages: [...library.enabledTranscriptionLanguages, language]
    };
  }

  if (action.type === "disable-transcription") {
    const language = canonicalLanguageIdentifier(action.language);
    if (!language) throw new Error("That language identifier is invalid.");
    const enabledTranscriptionLanguages = library.enabledTranscriptionLanguages.filter(
      (value) => !sameIdentifier(value, language)
    );
    const enabledTranslationPairs = library.enabledTranslationPairs.filter(
      (pair) => !sameIdentifier(pair.sourceLanguage, language)
    );
    if (
      enabledTranscriptionLanguages.length === library.enabledTranscriptionLanguages.length
      && enabledTranslationPairs.length === library.enabledTranslationPairs.length
    ) return library;
    return { version: LANGUAGE_LIBRARY_VERSION, enabledTranscriptionLanguages, enabledTranslationPairs };
  }

  if (action.type === "enable-translation-pair") {
    const pair = normalizedPair(action);
    if (!library.enabledTranscriptionLanguages.some((value) => sameIdentifier(value, pair.sourceLanguage))) {
      throw new Error("Enable the pair’s spoken language for transcription first.");
    }
    if (hasPair(library.enabledTranslationPairs, pair)) return library;
    return {
      ...library,
      version: LANGUAGE_LIBRARY_VERSION,
      enabledTranslationPairs: [...library.enabledTranslationPairs, pair]
    };
  }

  if (action.type === "disable-translation-pair") {
    const pair = normalizedPair(action);
    const enabledTranslationPairs = library.enabledTranslationPairs.filter((candidate) => !(
      sameIdentifier(candidate.sourceLanguage, pair.sourceLanguage)
      && sameIdentifier(candidate.targetLanguage, pair.targetLanguage)
    ));
    if (enabledTranslationPairs.length === library.enabledTranslationPairs.length) return library;
    return { ...library, version: LANGUAGE_LIBRARY_VERSION, enabledTranslationPairs };
  }

  return library;
}

export class LanguageLibraryController {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly dependencies: LanguageLibraryDependencies) {}

  run(action: LanguageLibraryAction = { type: "refresh" }): Promise<LanguageLibraryStatus> {
    const operation = this.queue.then(() => this.perform(action));
    this.queue = operation.catch(() => {});
    return operation;
  }

  private async perform(action: LanguageLibraryAction): Promise<LanguageLibraryStatus> {
    let snapshot = this.dependencies.read();
    const library = updateLibrary(snapshot.library, action);
    if (library !== snapshot.library) {
      snapshot = { ...snapshot, library };
      this.dependencies.commit(snapshot);
    }

    let modelMutated = false;
    if (action.type === "prepare-transcription") {
      await this.dependencies.prepareTranscription(action.language);
      modelMutated = true;
    } else if (action.type === "delete-transcription") {
      await this.dependencies.deleteTranscription(action.language);
      modelMutated = true;
    } else if (action.type === "prepare-translation-pair") {
      const pair = normalizedPair(action);
      if (!hasPair(library.enabledTranslationPairs, pair)) {
        throw new Error("Enable this translation pair before downloading it.");
      }
      await this.dependencies.prepareTranslation(pair.sourceLanguage, pair.targetLanguage);
      modelMutated = true;
    }

    try {
      const transcription = await Promise.all(library.enabledTranscriptionLanguages.map(async (language) => ({
        language,
        availability: await this.dependencies.transcriptionAvailability(language)
      })));
      const translation = await Promise.all(library.enabledTranslationPairs.map(async (pair) => ({
        ...pair,
        availability: await this.dependencies.translationAvailability(pair.sourceLanguage, pair.targetLanguage)
      })));
      return { library, transcription, translation };
    } finally {
      // Let the control window re-check its selected models after our own status
      // reads finish, including when one of those reads fails after a mutation.
      if (modelMutated) this.dependencies.modelMutationCompleted?.(library);
    }
  }
}
