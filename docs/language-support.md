# Language support

CCue does not maintain an exhaustive language allowlist. At runtime, its Swift helpers query the same Apple frameworks used for transcription and translation, then pass canonical identifiers to the app UI.

## Transcription

CCue uses `SpeechAnalyzer` with `SpeechTranscriber`, available on macOS 26 and later. `SpeechTranscriber.supportedLocales` is the source of truth for the locales that the current Mac can transcribe with an installed or downloadable on-device model. `SpeechTranscriber.isAvailable` and `AssetInventory.status(forModules:)` provide device and model status checks.

Apple documents these APIs in [SpeechTranscriber](https://developer.apple.com/documentation/speech/speechtranscriber) and demonstrates the supported/installed locale checks in [Bring advanced speech-to-text to your app](https://developer.apple.com/videos/play/wwdc2025/277/).

## Translation

CCue uses Apple's Translation framework. `LanguageAvailability.supportedLanguages` provides the runtime language catalog. A language appearing in that catalog does not imply that every possible pair is supported, so CCue asks `LanguageAvailability.status(from:to:)` about targets for the selected transcription language and omits `.unsupported` pairs.

Apple documents the catalog and pair check in [LanguageAvailability](https://developer.apple.com/documentation/translation/languageavailability).

## Identifiers and saved settings

Framework identifiers are canonicalized as BCP 47 tags, deduplicated, named with the user's locale, and sorted with a locale-aware collator. Saved selections from earlier CCue versions remain valid. If Apple reports the same language with a different regional identifier (for example, `en` instead of `en-US`), CCue selects the equivalent runtime entry. Simplified and Traditional Chinese remain distinct.

English, Chinese, and Japanese are representative examples, not a hard-coded promise or an exhaustive list. The exact choices may change after an OS update or across Macs because Apple determines support from the OS, hardware, downloadable assets, and translation pair.
