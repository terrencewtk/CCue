# CCue Decisions

## Architecture

- **Offline-only:** Captions use Apple SpeechTranscriber and optional translation uses Apple's Translation framework. The app has no hosted backend, authentication, billing, entitlement, or metering path.
- **Electron plus native helpers:** Electron owns windows, settings, and caption state. Rust owns CoreAudio capture, while separate Swift helpers own transcription and translation.
- **TypeScript for application code:** Electron, renderer UI, tests, and Node.js build helpers use strict TypeScript. Renderer sources compile to native browser ES modules without adding a frontend framework or runtime dependency.
- **NDJSON over stdio:** Native helpers exchange commands and events with Electron as newline-delimited JSON.
- **macOS only:** System-audio capture and the selected on-device frameworks are macOS-specific.

## Audio Capture

- **16 kHz mono PCM16:** The Rust sidecar resamples captured float audio and emits 100 ms chunks.
- **Default system output:** Device selection is not currently exposed.

## Desktop Experience

- **Two windows:** A normal control window handles caption settings, and a transparent always-on-top overlay displays captions.
- **Paired subtitle lines:** Each visible row contains original text and, when enabled, its local translation immediately below.
- **Configurable rolling view:** Users can display 1–3 recent caption rows; the default is three.
- **Global shortcut:** `Command+Shift+L` toggles capture by default. Users can record a different shortcut or disable it during onboarding or in Settings.

## Privacy and Distribution

- Captured audio is routed only to local child processes and is not sent to an application server.
- Preferences are stored locally in Electron's user-data directory.
- The renderer uses context isolation and a narrow preload API.
- Official builds use the hardened runtime, Developer ID signing, Apple notarization, and a protected manual GitHub release workflow.
- Packaged builds can discover and install signed updates from GitHub Releases.
- Transcript persistence, diarization, deeper accessibility integration, and crash recovery remain out of scope.
