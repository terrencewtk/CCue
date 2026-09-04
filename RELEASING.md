# Releasing CCue

Official releases are owner-only, manual, signed, and notarized. Pull requests and ordinary pushes can run CI, but they cannot access release credentials or publish a release.

## One-time GitHub setup

The public repository must have an environment named `release` with:

- Terrence Wong (`@terrencewtk`) as its only required reviewer.
- Self-review allowed, so the owner can approve a release they initiated.
- Deployment restricted to the `main` branch.
- Every Apple credential below stored as an environment secret, not a repository secret.

Do not grant Write, Maintain, or Admin access to other users on this personal repository. GitHub users with write access can create releases outside Actions; fork-based pull requests and public issues do not require write access.

## Apple credentials

The workflow expects these `release` environment secrets:

| Secret | Value |
| --- | --- |
| `CSC_LINK` | Base64-encoded, password-protected `.p12` containing a valid **Developer ID Application** certificate and its private key |
| `CSC_KEY_PASSWORD` | Password used when exporting the `.p12` |
| `APPLE_API_KEY_BASE64` | Base64-encoded App Store Connect API `.p8` key used only for notarization |
| `APPLE_API_KEY_ID` | App Store Connect API key ID |
| `APPLE_API_ISSUER` | App Store Connect API issuer ID |
| `APPLE_TEAM_ID` | Ten-character Apple Developer Team ID; also used to verify the final signature |

Apple never lets an automation download an existing signing private key. Create or install a Developer ID Application certificate on a trusted Mac, verify that Keychain Access shows its private key, then export the certificate and private key together as a password-protected `.p12`. Create a dedicated App Store Connect API key with the least privilege that permits notarization; its `.p8` can be downloaded only once.

Encode the files without copying their contents into shell history:

```bash
base64 -i DeveloperIDApplication.p12 | pbcopy
base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy
```

Paste each value directly into the matching GitHub environment secret, then clear the clipboard.

## Publish a release

1. Update `package.json` to the desired stable semantic version and merge that change into `main` through CI.
2. Review the pull requests merged since the previous release and ensure each has an appropriate release-note label. Categories and exclusions are defined in `.github/release.yml`.
3. In GitHub Actions, open **Release**, choose **Run workflow**, keep the branch set to `main`, and enter the exact version without a leading `v`.
4. Approve the pending `release` environment deployment as `@terrencewtk`.
5. Wait for source verification, signing, notarization, Gatekeeper assessment, checksums, and release publication to succeed.
6. Download the published DMG and perform a clean-machine smoke test before announcing the release.

The workflow refuses non-owner actors, non-`main` refs, mismatched versions, missing credentials, and existing tags. It creates the `vMAJOR.MINOR.PATCH` tag only after all build and validation steps pass.
