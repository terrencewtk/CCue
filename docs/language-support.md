# Language support

CCue does not maintain an exhaustive language allowlist. Its Swift helpers can query the same Apple frameworks used for transcription and translation, but the complete catalog is fetched only during onboarding and Settings **Add Language…**. Normal menus render a small persisted enabled-language library immediately.

## Transcription

CCue uses `SpeechAnalyzer` with `SpeechTranscriber`, available on macOS 26 and later. `SpeechTranscriber.supportedLocales` is the source of truth for the locales that the current Mac can transcribe with an installed or downloadable on-device model. `SpeechTranscriber.isAvailable` and `AssetInventory.status(forModules:)` provide device and model status checks.

Apple documents these APIs in [SpeechTranscriber](https://developer.apple.com/documentation/speech/speechtranscriber) and demonstrates the supported/installed locale checks in [Bring advanced speech-to-text to your app](https://developer.apple.com/videos/play/wwdc2025/277/).

## Translation

CCue uses Apple's Translation framework. `LanguageAvailability.supportedLanguages` provides the runtime language catalog. Translation targets are enabled globally, but a language appearing in that catalog does not imply that every possible pair is supported. CCue asks `LanguageAvailability.status(from:to:)` for the current source/target pair and never substitutes an unsupported target.

Apple documents the catalog and pair check in [LanguageAvailability](https://developer.apple.com/documentation/translation/languageavailability).

## Identifiers and saved settings

Framework identifiers are canonicalized as BCP 47 tags, deduplicated, named with the user's locale, and sorted with a locale-aware collator. Existing users are migrated once with CCue’s earlier built-ins plus their stored source and target. After that, the versioned library changes only through onboarding or explicit Settings actions. Simplified and Traditional Chinese remain distinct.

Model readiness is never persisted. The control window checks only its selected transcription language and, when translation is enabled, its selected pair. Settings checks only enabled library members. Start remains unavailable during checks or when a required model is missing, and capture performs one final validation immediately before starting.

English, Chinese, and Japanese are representative examples, not a hard-coded promise or an exhaustive list. The exact choices may change after an OS update or across Macs because Apple determines support from the OS, hardware, downloadable assets, and translation pair.
