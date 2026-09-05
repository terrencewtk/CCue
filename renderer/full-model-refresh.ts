export type ModelRefreshPhase = "preflight" | "transcription" | "translation";

export interface FullModelRefreshOptions<Availability> {
  transcriptionLanguages: readonly string[];
  isCurrent: () => boolean;
  setBusy: (busy: boolean) => void;
  setPhase: (phase: ModelRefreshPhase) => void;
  setChecking: (kind: "transcription" | "translation", language: string) => void;
  checkTranscription: (language: string) => Promise<Availability>;
  applyTranscription: (language: string, availability: Availability) => void;
  failTranscription: (language: string, error: unknown) => void;
  prepareTranslation: () => Promise<readonly string[] | null>;
  setTranslationLanguages: (languages: readonly string[]) => void;
  checkTranslation: (language: string) => Promise<Availability>;
  applyTranslation: (language: string, availability: Availability) => void;
  failTranslation: (language: string, error: unknown) => void;
}

export async function runFullModelRefresh<Availability>(
  options: FullModelRefreshOptions<Availability>
): Promise<"completed" | "stale"> {
  options.setBusy(true);
  try {
    options.setPhase("preflight");
    const translationLanguages = await options.prepareTranslation();
    if (!translationLanguages || !options.isCurrent()) return "stale";
    options.setTranslationLanguages(translationLanguages);

    options.setPhase("transcription");
    for (const language of options.transcriptionLanguages) {
      if (!options.isCurrent()) return "stale";
      options.setChecking("transcription", language);
      try {
        const availability = await options.checkTranscription(language);
        if (!options.isCurrent()) return "stale";
        options.applyTranscription(language, availability);
      } catch (error) {
        if (!options.isCurrent()) return "stale";
        options.failTranscription(language, error);
      }
    }

    if (!options.isCurrent()) return "stale";
    options.setPhase("translation");
    for (const language of translationLanguages) {
      if (!options.isCurrent()) return "stale";
      options.setChecking("translation", language);
      try {
        const availability = await options.checkTranslation(language);
        if (!options.isCurrent()) return "stale";
        options.applyTranslation(language, availability);
      } catch (error) {
        if (!options.isCurrent()) return "stale";
        options.failTranslation(language, error);
      }
    }
    return "completed";
  } finally {
    options.setBusy(false);
  }
}
