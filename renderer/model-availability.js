(() => {
const TRANSCRIPTION_LANGUAGES = [
  { value: "zh-CN", name: "Chinese (Mandarin)", nativeName: "中文（普通话）" },
  { value: "en-US", name: "English", nativeName: "English (US)" },
  { value: "ja-JP", name: "Japanese", nativeName: "日本語" },
  { value: "ko-KR", name: "Korean", nativeName: "한국어" }
];

const TRANSLATION_LANGUAGES = [
  { value: "zh-CN", name: "Chinese (Simplified)", nativeName: "简体中文" },
  { value: "zh-TW", name: "Chinese (Traditional)", nativeName: "繁體中文" },
  { value: "en-US", name: "English", nativeName: "English (US)" },
  { value: "ja-JP", name: "Japanese", nativeName: "日本語" },
  { value: "ko-KR", name: "Korean", nativeName: "한국어" }
];

function createModelChecker(captions) {
  let operationQueue = Promise.resolve();

  function run(operation) {
    const result = operationQueue.then(operation, operation);
    operationQueue = result.catch(() => {});
    return result;
  }

  return {
    run,
    transcription: (language) => run(() => captions.getTranscriptionModelAvailability(language)),
    translation: (sourceLanguage, targetLanguage) => run(() => (
      captions.getTranslationModelAvailability(sourceLanguage, targetLanguage)
    ))
  };
}

window.modelAvailability = {
  TRANSCRIPTION_LANGUAGES,
  TRANSLATION_LANGUAGES,
  createModelChecker,
  isReady: (availability) => availability.supported && availability.installed
};
})();
