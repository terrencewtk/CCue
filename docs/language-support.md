# Language support

CCue does not maintain an exhaustive language allowlist. Its Swift helpers can query the same Apple frameworks used for transcription and translation, but the complete catalog is fetched only during onboarding and Settings language or pair selection. Normal menus render a small persisted language library immediately.

## Transcription

CCue uses `SpeechAnalyzer` with `SpeechTranscriber`, available on macOS 26 and later. `SpeechTranscriber.supportedLocales` is the source of truth for the locales that the current Mac can transcribe with an installed or downloadable on-device model. `SpeechTranscriber.isAvailable` and `AssetInventory.status(forModules:)` provide device and model status checks.

Apple documents these APIs in [SpeechTranscriber](https://developer.apple.com/documentation/speech/speechtranscriber) and demonstrates the supported/installed locale checks in [Bring advanced speech-to-text to your app](https://developer.apple.com/videos/play/wwdc2025/277/).

## Translation

CCue uses Apple's Translation framework. `LanguageAvailability.supportedLanguages` provides the runtime language catalog. The library stores explicit source/target pairs because a language appearing in that catalog does not imply that every possible pair is supported. Settings asks the user to choose both languages, and CCue checks `LanguageAvailability.status(from:to:)` for that exact pair without substituting another target.

Apple documents the catalog and pair check in [LanguageAvailability](https://developer.apple.com/documentation/translation/languageavailability).

## Identifiers and saved settings

Framework identifiers are canonicalized as BCP 47 tags, deduplicated, named with the user's locale, and sorted with a locale-aware collator. Existing target-only libraries are migrated once by pairing their targets with the one persisted source that the old data represented; CCue does not invent pairs for other enabled transcription languages. After that, the versioned library changes only through onboarding or explicit Settings actions. Simplified and Traditional Chinese remain distinct.

Model readiness is never persisted. The control window filters translation targets to pairs whose source matches its selected transcription language, then checks only that selected pair. Settings checks each saved pair independently. Start remains unavailable during checks or when a required model is missing, model mutations notify the control window to check again, and capture performs one final validation immediately before starting.

English, Chinese, and Japanese are representative examples, not a hard-coded promise or an exhaustive list. The exact choices may change after an OS update or across Macs because Apple determines support from the OS, hardware, downloadable assets, and translation pair.
