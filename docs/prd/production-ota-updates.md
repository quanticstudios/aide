# Production OTA Updates

## Summary

Aide will ship secure, staged over-the-air updates for packaged Linux x64
AppImages and signed/notarized macOS x64 and arm64 applications. Source remains
private while anonymous update artifacts are served from Cloudflare R2 through
an owned HTTPS hostname.

The updater checks after launch and every six hours, downloads stable updates
automatically by default, and never restarts without the user's explicit
consent. Active agents and terminals make deferral the primary action. Normal
updates roll out to deterministic 10%, 50%, and 100% cohorts with at least
24 healthy hours at each partial stage.

## User Experience

- The top bar exposes available, downloading, failed, critical, and
  restart-ready states without stealing focus.
- An application-level modal supports manual checks, progress, retry, a
  24-hour normal-update snooze, update preferences, and graceful restart.
- Critical updates remain visibly actionable but cannot force a restart.
- Development, unpacked, tarball, and unsupported Linux installations explain
  that manual updating is required.
- A first-run disclosure explains the narrow OTA health data before any
  optional event is sent. Reporting defaults on and can be disabled.

## Runtime and Trust

The main process exclusively owns an exact-pinned `electron-updater` instance.
Renderer delivery uses a monotonic, full-snapshot event contract and the
existing subscribe-before-snapshot reconciliation pattern.

Every public channel offer is a deterministic JSON envelope signed by an
offline Ed25519 key. The client embeds only a versioned public keyring and
validates product, version, platform, architecture, stable channel, origin,
cohort, revocation, updater metadata digest, and artifact digest. A downloaded
artifact is rehashed and the channel is freshly revalidated before
installation. CDN compromise alone must not authorize an arbitrary Linux
binary.

The first updater-enabled build is a manually installed bootstrap. Cached
updates never install on ordinary quit; explicit restart first completes a
bounded shutdown of workspace setup, managed sessions, terminals, and the
database, then invokes the updater exactly once.

## Persistence and Privacy

Schema migration 8 stores only updater preferences, disclosure, a local random
cohort identifier, snooze state, last-check state, a pending update marker, and
a bounded health-event queue. It never stores feed credentials, downloaded
paths, raw transport errors, or full release payloads.

Allowed OTA health fields are a per-release attempt identifier, current and
target version, platform, architecture, cohort bucket, lifecycle event, stable
error code, and coarse timestamp/duration. The service does not persist IP,
headers, user agent, repository, project, workspace, prompt, file path, or
terminal data. Raw events expire after 30 days and rollout never promotes
automatically.

## Release Pipeline

An annotated stable tag must match `package.json`, resolve to protected `main`,
and have green CI. Native Linux x64, macOS x64, and macOS arm64 jobs build
frozen dependencies. macOS artifacts must be signed, notarized, stapled, and
Gatekeeper-verified.

A single collector merges the two macOS updater manifests, preserves ZIP
blockmap metadata, verifies exact artifact names and architectures, recomputes
aggregate hashes, and creates CycloneDX SBOMs and provenance attestations.
Versioned R2 objects upload first with immutable caching and are downloaded
back for verification. A protected promotion job accepts only an offline-signed
promotion record and writes the short-cache channel envelope last.

Rollback stops new installations with a signed revocation. Already installed
clients receive a higher patch; releases are never overwritten, retagged, or
silently downgraded.

## Acceptance

- Unit tests cover all updater transitions, stale events, revision races,
  signature and target validation, rollout boundaries, revocation, corruption,
  offline failure, snooze, telemetry opt-out, persistence, and quit ordering.
- Renderer tests cover every modal state, focus restoration, progress
  announcements, critical treatment, and absence of nested interactive
  controls.
- A signed local HTTPS feed proves a packaged Linux AppImage bootstrap,
  upgrade, state preservation, tamper rejection, revocation, and recovery.
- Native macOS x64/arm64 CI proves the same path with signed/notarized builds.
- `bun run test:node`, `bun run check`, `bun run build`, and
  `bun run test:e2e` pass before release.

## Boundaries

OTA v1 is stable-only. Windows, beta/nightly channels, DEB/package-manager
updates, tarball updates, forced deadlines, automatic downgrade, and silent
restart remain out of scope. The exact Cloudflare hostname and production
credentials are deployment inputs; production promotion fails closed until
they are configured and verified.
