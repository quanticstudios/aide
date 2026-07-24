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
   collector) and `main` (for promotion). Put these non-secret variables there: `AIDE_UPDATE_ORIGIN`, `AIDE_UPDATE_HEALTH_ENDPOINT`,
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

The protected variables are compiled into tagged desktop packages. Native package
jobs independently validate the exact values immediately before building, so a
launch shell cannot redirect the update origin, keyring, or health endpoint.
`AIDE_RELEASE_PUBLIC_KEY_PEM` must be a PEM `PUBLIC KEY` (SPKI) for Ed25519;
private PEMs, development key IDs, IP literals, loopback, `r2.dev`,
`workers.dev`, and trailing-dot variants are rejected. Unpackaged builds and a
package with absent inputs are deliberately manual-only.

## Linux packaged upgrade drill

Run the expensive Linux x64 acceptance gate manually from the `Linux packaged
OTA upgrade drill` workflow or any isolated Linux host:

```sh
bun install --frozen-lockfile
bun run test:ota-linux-upgrade
```

The drill creates an ephemeral Ed25519 signing key in process memory and a
local CA/feed bound only to `127.0.0.1` in a temporary directory, then compiles the exact
`AIDE_OTA_DRILL_BUILD=1` policy into those disposable AppImages. That policy
permits only HTTPS `127.0.0.1` as the update origin; it cannot be activated by
a launch environment, and tagged builds reject the flag. The local CA is trusted
via `NODE_EXTRA_CA_CERTS`; TLS is never disabled and the production parser still
rejects every IP literal.
It packages bootstrap, target, and recovery AppImages with the public test key
compiled in, drives the real preload update commands under Xvfb/CDP, verifies
the stable versionless `Aide.AppImage` replacement, retained userData/SQLite
marker, and `node-pty` before and after restart. It also refreshes a signed
revocation after download and proves restart refusal before publishing and
installing the higher recovery patch. Temporary certificates, feed, and logs
are removed in `finally`; the drill never mutates system networking
configuration. The signing private key is neither written nor printed. The
only retained CI evidence is bounded request paths, lifecycle stages, and
process exit summaries; raw process output remains in the temporary directory
and is deleted with it. Failure screenshots contain only the hermetic drill
application state, never user data.

## OTA rollout health service

The optional health service is a separate Cloudflare Worker and D1 database in
`workers/ota-health/`; it has no R2 binding, no promotion capability, and no
public read API. Before deploying it:

1. Create the D1 database and a Worker custom HTTPS hostname such as
   `health.example.com`. Replace every `REPLACE_WITH_*` placeholder in
   `workers/ota-health/wrangler.jsonc`, then apply
   `bunx wrangler d1 migrations apply <database-name> --remote` and deploy with
   `bunx wrangler deploy`. Both commands resolve the exact version pinned in
   `bun.lock`. Use a narrowly scoped Worker/D1 deployment token; do not add that
   token to a desktop release workflow.
2. Configure a Cloudflare WAF rate rule for only
   `POST /v1/ota-health/events`, in addition to the Worker binding that limits
   each opaque update attempt. The Worker must never inspect or store source
   IPs, headers, user agents, request bodies in logs, or any identifier other
   than the permitted per-attempt ID. Do not enable Workers Logpush/request
   body logging for this route without a separate privacy review.
3. Supply `AIDE_UPDATE_HEALTH_ENDPOINT` at desktop package build time as the
   exact custom HTTPS `https://health.example.com/v1/ota-health/events` URL.
   Tagged builds fail closed when this protected environment value is absent or
   uses a provider-default `workers.dev` or `r2.dev` hostname. It is
   compiled into the main bundle rather than read from a user's launch shell.
   Missing, malformed, credentialed, query-bearing, or non-HTTPS values disable
   reporting completely. The current update feed origin remains independently
   configured by the packaged OTA bootstrap work.
4. Verify locally with `bun run test:ota-health`. A remote validation must send
   one synthetic fixed-schema event, confirm its anonymous aggregate, wait for
   or invoke the retention cron, and verify that no raw record older than 30
   days remains. Do not use production project, repository, workspace, prompt,
   terminal, file-path, IP, or user-agent data in this check.

The desktop queues at most 100 fixed-schema events and uploads only after the
user has both acknowledged the disclosure and left reporting enabled. Turning
off either choice atomically purges the local queue; a failed request is retried
without retaining server or transport detail. Event and Worker receipt
timestamps are rounded down to their UTC minute before storage. Durations are
upper-bounded into fixed 1s, 5s, 15s, 30s, 1m, 5m, 15m, 1h, 6h, 1d, 3d, or 7d
buckets; the collector rejects exact timestamps or durations. The service keeps
raw events for 30 days and writes only anonymous daily aggregates thereafter.

### Manual rollout gates

Rollout is never automatic. An operator exports only
`ota_health_daily_aggregates` from D1, then runs a reviewed local gate before
offline-signing a new 10%, 50%, or 100% envelope:

```sh
node scripts/check-ota-health-gate.mjs \
  --input aggregates.json \
  --version 1.2.3 \
  --rollout 50 \
  --window-start 2026-07-24T00:00:00.000Z \
  --window-end 2026-07-25T00:00:00.000Z \
  --min-observations 100 \
  --max-failure-rate 0.02
```

The command requires an already elapsed 24-hour window with UTC-midnight
endpoints, the requested cohort boundary, and explicit sample/failure
thresholds. Because aggregates are UTC-day buckets, the window is half-open:
the start day is included and the end day is excluded. It independently evaluates
download failures as `download-failed / (downloaded + download-failed)` and
install failures as
`install-failed / (install-succeeded + install-failed)`. Each stage must meet
the minimum observation count and maximum failure rate. Started lifecycle
events and `check-failed` are excluded because the anonymous aggregates cannot
attribute them to a corresponding successful outcome. The command only returns
a report and cannot contact R2, sign an envelope, or promote a channel. Record
the stage metrics and human approval with the next offline-signed promotion
record.

The outstanding external blockers are the Cloudflare account, D1 database ID,
custom health hostname, Worker rate-limit namespace, WAF policy, and scoped
deployment token. Until those exist the built client remains safely silent.

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
