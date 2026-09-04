# Contributing to CCue

Thanks for helping improve CCue. The project is macOS-only because it relies on CoreAudio and Apple's on-device Speech and Translation frameworks.

## Development setup

Install Node.js 20 or later, Rust, and Xcode 26 or later with Swift 6.2+, then run:

```bash
npm ci
npm run verify
```

Run the complete app with `npm start`. During Electron-only iteration, reuse previously built native helpers with `npm run start:electron`.

## Pull requests

- Search existing [issues](https://github.com/terrencewtk/ccue/issues) before opening a duplicate.
- For substantial behavior or architecture changes, open an issue for discussion before implementation.
- Fork the repository, create a focused branch, and open the pull request against `main`.
- Keep changes focused and explain any user-visible behavior change.
- Add or update tests for logic changes.
- Run `npm run verify` before submitting.
- Do not commit build output, local model data, debug traces, credentials, or captured audio/transcripts.
- Preserve the offline-only architecture unless a proposal has been discussed first.

Release notes are generated from merged pull requests and grouped by labels. Maintainers should apply the most specific relevant label:

- `security` for security-related changes.
- `enhancement` for new user-facing capabilities.
- `accessibility` or `performance` for improvements to existing behavior.
- `bug` for corrections.
- `dependencies` or `maintenance` for internal upkeep.
- `documentation` or `release-notes:skip` for changes that should not appear in release notes.

The CI workflow must pass before a change is merged. Official tags and releases are created only by the repository owner through the protected manual release workflow.

Security vulnerabilities do not belong in public issues. Follow [SECURITY.md](SECURITY.md) to report them privately.

## Code structure

- `electron/` contains the typed main process, preload bridge, and application services.
- `renderer/` contains dependency-free window UI.
- `native/` contains the Rust CoreAudio sidecar.
- `local-asr/` and `local-translation/` contain the Swift helpers.
- `test/` contains the Node test suite.

Architecture decisions and known production gaps are documented in [DECISIONS.md](DECISIONS.md).
