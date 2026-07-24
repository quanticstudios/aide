# OTA release operations

This runbook publishes stable Aide updates to the public custom update hostname.
It is intentionally unusable until the required protected environment, offline
key, native macOS credentials, and Cloudflare configuration exist.

## One-time production setup

1. Create a private R2 bucket. Expose it only through an owned HTTPS custom
   hostname such as `updates.example.com`; never use an `r2.dev` hostname.
   Disable directory listing and configure immutable cache headers for
   `/releases/*` and `no-store` for `/channels/*`.
2. Create the protected GitHub environment `ota-production` with required
   reviewers. Its deployment rules must permit stable `v*` tags (for the
   collector) and `main` (for promotion). Put these non-secret variables there: `AIDE_UPDATE_ORIGIN`,
   `AIDE_RELEASE_KEY_ID`, `AIDE_RELEASE_PUBLIC_KEY_PEM`, `R2_BUCKET`, and
   `R2_ENDPOINT`.
3. Put only short-lived, bucket-scoped R2 credentials in its environment
   secrets: `R2_TEMPORARY_ACCESS_KEY_ID`,
   `R2_TEMPORARY_SECRET_ACCESS_KEY`, and, when issued,
   `R2_TEMPORARY_SESSION_TOKEN`. The token issuer must restrict writes to the
   promotion run and expire credentials after the release window. Never place
   an offline signing private key, Cloudflare account token, or long-lived R2
   administrative token in GitHub.
4. Configure the tagged packaging workflow with Developer ID signing and Apple
   notarization credentials documented in [desktop packaging](15-desktop-packaging.md).
   Protect `main`, require CI before tag creation, and require review for
   `release-promotions/**` and both release workflows.
5. Replace the development key embedded in the app through a reviewed bootstrap
   release before configuring a production origin. The matching private Ed25519
   key remains offline.

## Normal stable promotion

1. Create an annotated `vMAJOR.MINOR.PATCH` tag at a green `main` commit. Its
   package version must match the tag. The package workflow rejects lightweight,
   prerelease, mismatched, and non-main tags.
2. Wait for `Package desktop artifacts` to complete successfully. It builds
   native Linux x64, macOS x64, and macOS arm64 artifacts, verifies signed macOS
   builds, and stores only internal Actions artifacts.
3. Obtain the collector run ID. Download its `aide-release-bundle-<version>`
   artifact only for inspection. Verify `SHA256SUMS` against every listed
   immutable package, updater metadata, CycloneDX SBOM, and provenance input;
   the checksum deliberately does not hash itself or `release-manifest.json`
   to avoid self-reference. Use GitHub's attestation UI/API to verify the two
   collector attestations for `SHA256SUMS` and `sbom.cdx.json`, then compare
   architecture and notarization evidence with the release checklist.
4. Use the offline machine and the commands in
   [signed release envelopes](17-ota-release-envelope.md) to create one
   canonical, detached-signed record per target. Commit both files under:

   ```text
   release-promotions/v<version>/linux-x64/release-envelope.{json,sig}
   release-promotions/v<version>/darwin-x64/release-envelope.{json,sig}
   release-promotions/v<version>/darwin-arm64/release-envelope.{json,sig}
   ```

   The records must point to the exact `releases/v<version>/...` metadata and
   artifact digests in the collector manifest. Review and merge them to `main`.

5. From `main`, manually run `Promote signed OTA release` with the version and
   source `Package desktop artifacts` run ID. A protected environment approval
   is mandatory.
6. The promotion verifies the source workflow path, tag, and GitHub run SHA;
   validates all three offline signatures; rejects any pre-existing immutable
   object; uploads every release asset, aggregate checksum, SBOM, provenance
   input, and audit manifest; then streams every public object through bounded
   size/digest readback. It replaces each short-cache stable channel signature
   before its envelope, byte-verifies both, and treats the envelope as the final
   commit point.
7. Validate all three public channel paths from a clean network and run the
   packaged upgrade drill before expanding the staged percentage.

## Halt, revoke, and hotfix

- **Halt before installation:** remove public routing to the channel objects or
  publish an offline-signed revocation envelope through the same protected flow.
  Do not delete or overwrite immutable `/releases/v*/` assets.
- **Bad released build:** stop promotion, publish the signed revocation channel,
  investigate, then release a higher patch version. Clients never downgrade
  automatically.
- **Hotfix:** create a new annotated higher patch tag and repeat the complete
  promotion flow. Do not retag, edit, or reuse the original tag/assets.
- **Lost or compromised signing key:** halt all channel changes, rotate the
  embedded public key through a manually installed signed bootstrap build, wait
  until the old key is no longer required by the supported installed base, then
  issue newly signed release records. Treat all envelopes signed by the
  compromised key as untrusted.
- **Compromised R2 credential or CDN control plane:** revoke the credential,
  rotate custom-hostname/R2 access, inspect object versions and audit logs, and
  publish a signed revocation envelope. CDN control alone must not authorize an
  unsigned client update, but it can deny service or serve stale content.

## Failure rules

Never bypass a failed signature, missing blockmap, mismatched hash, unsigned
macOS package, absent source-run evidence, or unavailable custom origin. A failed
promotion can leave immutable uploaded objects behind; those keys remain burned,
and the operator must cut a new version rather than overwrite them. Channel
updates are deliberately mutable pointers and must always be reviewed,
offline-signed, and written only after immutable readback succeeds.
