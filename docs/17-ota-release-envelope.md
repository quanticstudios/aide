# Signed OTA release envelopes

Aide accepts an update only when its detached Ed25519 signature validates over
the exact canonical UTF-8 bytes of a schema-v1 release envelope. The application
ships public keys only. Production private keys stay offline and must never be
committed, copied to Cloudflare, or supplied to an application build.

The currently embedded key is a development fixture. Replacing it with a
production public key requires a reviewed application release before a production
update origin is enabled.

## Offline release flow

Create an unsigned JSON object containing every required field in the schema:

```sh
bun scripts/create-release-envelope.ts \
  --input release-input.json \
  --output envelope.json

bun scripts/sign-release-envelope.ts \
  --envelope envelope.json \
  --private-key /secure/offline/aide-release-ed25519.pem \
  --signature envelope.sig

bun scripts/verify-release-envelope.ts \
  --envelope envelope.json \
  --signature envelope.sig \
  --public-key aide-release-public.pem \
  --key-id aide-release-2026-01
```

`sign-release-envelope.ts` rejects pretty-printed or otherwise noncanonical
input. It reads the PEM only from the supplied path and writes only the requested
detached signature; it never prints or stores private-key material. The signature
path cannot be either input path. Publication uses an exclusive temporary file and
an atomic non-clobbering link, so an existing signature or operator path mistake
cannot overwrite the envelope or private key.

## Client policy

The verifier rejects unknown fields, unsupported schema/product/channel values,
pre-release versions, malformed timestamps, noncanonical JSON, unknown keys, bad
signatures, insecure production origins, credentials, query strings, fragments,
cross-origin URLs, wrong platform/architecture, non-newer versions, revoked
versions, and installations outside the signed 10%, 50%, or 100% cohort.

The cohort is deterministic: `SHA-256(installationId + targetVersion) mod 100`.
Raw envelopes are limited to 64 KiB and detached Ed25519 signatures must be exactly
64 bytes. Semantic-version components, URLs, key IDs, and the revocation list are
also bounded before cryptographic or updater work begins.

Before configuring the updater, the update manager must download its metadata to a
private cache file and call `verifyReleaseFileDigest`. Feed metadata is streamed
from one non-symlink regular file descriptor and limited to 1 MiB.

Before installation, `verifyArtifactDigest` streams SHA-256 and SHA-512 from one
non-symlink regular file descriptor and returns that verified file's device/inode,
size, and change timestamps. The updater must consume that exact updater-cache
identity. Call `releaseFileMatchesIdentity` immediately before handing the cache
path to the installer; if the identity changed, abort and re-download/reverify.
Never copy verification success from one path or file identity to another.
