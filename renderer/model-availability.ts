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
