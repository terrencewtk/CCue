# CCue

[![CI](https://github.com/terrencewtk/ccue/actions/workflows/ci.yml/badge.svg)](https://github.com/terrencewtk/ccue/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/terrencewtk/ccue)](https://github.com/terrencewtk/ccue/releases/latest)
[![License: GPL-3.0](https://img.shields.io/github/license/terrencewtk/ccue)](LICENSE)
![Platform](https://img.shields.io/badge/macOS-26%2B-000000?logo=apple)

Private, real-time captions for your Mac's system audio.

CCue is a free and open-source macOS app that turns the audio playing on your Mac into an always-on-top caption overlay. Transcription uses Apple's on-device Speech framework, and optional translation uses Apple's on-device Translation framework. There is no account, subscription, hosted backend, or usage allowance.

![CCue live captions demo](docs/screen_recording.gif)

## Highlights

- **Local by design** — captured audio, transcripts, and translations are processed on your Mac.
- **Captions any system audio** — use CCue with videos, meetings, podcasts, streams, and other apps.
- **Optional live translation** — display the original speech and its translation together.
- **Unobtrusive overlay** — captions stay above other windows and remain visible in full screen.
- **Configurable history** — show between 1 and 3 caption rows.
- **Downloadable language models** — prepare and manage Apple language models from onboarding or Settings.
- **Configurable global shortcut** — start or stop captions from any app, or disable the shortcut entirely.

## Language support

| Feature | Languages |
| --- | --- |
| Transcription | English (US), Japanese, Korean, Chinese (Mandarin) |
| Translation | English (US), Japanese, Korean, Chinese (Simplified), Chinese (Traditional) |

Actual model availability depends on the language pair and the models supported by macOS on your Mac.

## Requirements

- Apple silicon Mac with macOS 26 or later

Translation itself requires macOS 15 or later, but the transcription pipeline makes macOS 26 the minimum version for CCue as a whole.

## Install

1. Download the signed DMG from the [latest GitHub release](https://github.com/terrencewtk/ccue/releases/latest).
2. Open the DMG and drag CCue to Applications.
3. Start CCue and complete the on-device model setup. macOS will ask for system-audio capture permission when captions start.

The initial distribution supports Apple silicon (`arm64`) only. Every official build is signed with a Developer ID certificate and notarized by Apple. GitHub displays the SHA-256 digest for each uploaded release asset.

## Build from source

- Apple silicon Mac with macOS 26 or later
- Xcode 26 or later (Swift 6.2+)
- Rust toolchain
- Node.js 20 or later and npm

CCue is macOS-only because its audio capture and speech pipeline rely on CoreAudio and Apple frameworks.

## Quick start

From the repository root, install the Node.js dependencies and launch the app:

```bash
npm ci
npm start
```

`npm start` builds the Rust audio-capture sidecar, both Swift helpers, and the Electron main process before opening CCue. The first build can take a few minutes.

For later Electron-only UI work, reuse the native helpers you have already built:

```bash
npm run start:electron
```

## Using CCue

1. Complete the first-run setup and choose a spoken language.
2. Download the Apple transcription model when prompted.
3. Optionally choose a translation language and download the required models.
4. Play audio on your Mac and select **Start captions**.
5. Select **Stop captions**, or use the global shortcut, to end the session. The default is <kbd>Command</kbd> + <kbd>Shift</kbd> + <kbd>L</kbd>.

Open **CCue → Settings…** or press <kbd>Command</kbd> + <kbd>,</kbd> to manage models, translation, the keyboard shortcut, and the number of visible caption rows. macOS may request permission to capture system audio.

## Privacy and security

CCue does not require an account or an application server. The app streams captured audio only to local helper processes, stores preferences in Electron's local user-data directory, and does not persist transcripts.

The renderer runs with context isolation, sandboxing, Node.js integration disabled, and a narrow preload bridge. Diagnostics that may contain caption text are opt-in and disabled by default.

Please report sensitive issues according to [SECURITY.md](SECURITY.md). Do not put captured audio, transcripts, credentials, or translation traces in a public issue.

## How it works

```text
System audio
    │
    ▼
Rust CoreAudio sidecar ── 16 kHz mono PCM ──► Electron main process
                                                    │
                                      ┌─────────────┴─────────────┐
                                      ▼                           ▼
                              Apple Speech helper       Apple Translation helper
                                      │                           │
                                      └─────────────┬─────────────┘
                                                    ▼
                                           Caption overlay
```

Native helpers communicate with Electron using newline-delimited JSON over standard input and output. This keeps capture and Apple-framework integration outside the renderer while preserving a small, auditable interface between components.

```text
electron/
  audio/              Native sidecar IPC and PCM helpers
  captions/           Caption records and rolling timeline
  capture/            Capture-session lifecycle
  local-asr/          Apple Speech helper client
  local-translation/  Apple Translation helper client
  onboarding/         First-run model preparation
  settings/           Local preferences
  updater/            Update checks and preferences
  ui/                 Electron window management
local-asr/             Swift transcription helper
local-translation/     Swift translation helper
native/                Rust CoreAudio capture sidecar
renderer/              Dependency-free TypeScript window interfaces
scripts/               TypeScript build and packaging helpers
test/                  TypeScript Node.js test suite
```

For architectural tradeoffs and current production gaps, see [DECISIONS.md](DECISIONS.md).

## Development

Run the complete verification suite before submitting a change:

```bash
npm run verify
```

Useful individual commands:

| Command | Purpose |
| --- | --- |
| `npm test` | Compile and run the TypeScript Node.js tests |
| `npm run check` | Type-check Electron, renderer, tests, and build helpers |
| `npm run app:build` | Compile Electron and renderer TypeScript |
| `npm run native:check` | Format-check and test the Rust sidecar |
| `npm run local-asr:test` | Test the Swift transcription helper |
| `npm run local-translation:check` | Build-check the Swift translation helper |
| `npm run updater:preview` | Preview updater UI without contacting a server |

### Development diagnostics

Caption and translation diagnostics can contain private text, so they must be enabled explicitly for a local session:

```bash
CCUE_DEBUG_TRANSLATIONS=1 npm start
CCUE_ENABLE_ADAPTIVE_HINTS=1 npm start
```

Translation traces are written to the ignored `debug-output/` directory. Review them before sharing.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## Build and distribution

Build an unpacked macOS application:

```bash
npm run build
open "dist/mac-arm64/CCue.app"
```

Create DMG and ZIP artifacts:

```bash
npm run dist
```

Official releases are created only by the repository owner through the manually dispatched [release workflow](.github/workflows/release.yml). It verifies the source, builds with the hardened runtime, signs every executable with the same Developer ID identity, notarizes the app with Apple, validates the result, and publishes the DMG plus the ZIP metadata required for automatic updates.

Versions follow [Semantic Versioning](https://semver.org/) and use `vMAJOR.MINOR.PATCH` Git tags. See [RELEASING.md](RELEASING.md) for the owner-only release procedure and credential setup.

## License

CCue is licensed under the [GNU General Public License v3.0 only](LICENSE). The CoreAudio implementation was adapted from [Pluely](https://github.com/iamsrikanthnani/pluely), also under GPL-3.0. See [NOTICE.md](NOTICE.md) for provenance and attribution.
