import {
  LANGUAGE_LIBRARY_VERSION,
  type LanguageLibrary,
  type LanguageLibraryStatus,
  type ModelAvailability,
  type SettingsSnapshot
} from "../shared/types";
import { canonicalLanguageIdentifier } from "./settings-store";

export type LanguageLibraryAction =
  | { type: "refresh" }
  | { type: "enable"; kind: "transcription" | "translation"; language: string }
  | { type: "disable"; kind: "transcription" | "translation"; language: string }
  | { type: "prepare-transcription"; language: string }
  | { type: "delete-transcription"; language: string }
  | { type: "prepare-translation"; language: string };

export interface LanguageLibraryDependencies {
  read(): SettingsSnapshot;
  sourceLanguage(): string;
  commit(snapshot: SettingsSnapshot): void;
  transcriptionAvailability(language: string): Promise<ModelAvailability>;
  translationAvailability(sourceLanguage: string, targetLanguage: string): Promise<ModelAvailability>;
  prepareTranscription(language: string): Promise<unknown>;
  deleteTranscription(language: string): Promise<unknown>;
  prepareTranslation(sourceLanguage: string, targetLanguage: string): Promise<unknown>;
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

function updateLibrary(library: LanguageLibrary, action: LanguageLibraryAction): LanguageLibrary {
  if (action.type !== "enable" && action.type !== "disable") return library;
  const language = canonicalLanguageIdentifier(action.language);
  if (!language) throw new Error("That language identifier is invalid.");
  const field = action.kind === "transcription"
    ? "enabledTranscriptionLanguages"
    : "enabledTranslationLanguages";
  const existing = library[field];
  const hasLanguage = existing.some((value) => value.toLocaleLowerCase() === language.toLocaleLowerCase());
  const values = action.type === "enable"
    ? hasLanguage ? existing : [...existing, language]
    : existing.filter((value) => value.toLocaleLowerCase() !== language.toLocaleLowerCase());
  if (values === existing || (values.length === existing.length && values.every((value, index) => value === existing[index]))) {
    return library;
  }
  return { ...library, version: LANGUAGE_LIBRARY_VERSION, [field]: values };
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
    const sourceLanguage = this.dependencies.sourceLanguage();
    const library = updateLibrary(snapshot.library, action);
    if (library !== snapshot.library) {
      snapshot = { ...snapshot, library };
      this.dependencies.commit(snapshot);
    }

    if (action.type === "prepare-transcription") {
      await this.dependencies.prepareTranscription(action.language);
    } else if (action.type === "delete-transcription") {
      await this.dependencies.deleteTranscription(action.language);
    } else if (action.type === "prepare-translation") {
      if (sameLanguage(sourceLanguage, action.language)) {
        throw new Error("The spoken and translation languages must be different.");
      }
      await this.dependencies.prepareTranslation(sourceLanguage, action.language);
    }

    const transcription = await Promise.all(library.enabledTranscriptionLanguages.map(async (language) => ({
      language,
      availability: await this.dependencies.transcriptionAvailability(language)
    })));
    const translation = await Promise.all(library.enabledTranslationLanguages.map(async (language) => ({
      language,
      availability: sameLanguage(sourceLanguage, language)
        ? { installed: false, supported: false, deletable: false }
        : await this.dependencies.translationAvailability(sourceLanguage, language)
    })));
    return { library, transcription, translation };
  }
}
