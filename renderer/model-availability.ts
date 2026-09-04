export const TRANSCRIPTION_LANGUAGES = [
  { value: "zh-CN", name: "Chinese (Mandarin)", nativeName: "中文（普通话）" },
  { value: "en-US", name: "English", nativeName: "English (US)" },
  { value: "ja-JP", name: "Japanese", nativeName: "日本語" },
  { value: "ko-KR", name: "Korean", nativeName: "한국어" }
];

export const TRANSLATION_LANGUAGES = [
  { value: "zh-CN", name: "Chinese (Simplified)", nativeName: "简体中文" },
  { value: "zh-TW", name: "Chinese (Traditional)", nativeName: "繁體中文" },
  { value: "en-US", name: "English", nativeName: "English (US)" },
  { value: "ja-JP", name: "Japanese", nativeName: "日本語" },
  { value: "ko-KR", name: "Korean", nativeName: "한국어" }
];

export interface LanguageModel {
  value: string;
  name: string;
  nativeName: string;
}

export interface ModelChecker {
  run<T>(operation: () => Promise<T>): Promise<T>;
  transcription(language: string): Promise<ModelAvailability>;
  translation(source: string, target: string): Promise<ModelAvailability>;
}

export function createModelChecker(captions: CaptionsBridge): ModelChecker {
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
