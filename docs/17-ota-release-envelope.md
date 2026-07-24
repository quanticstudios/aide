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
detached signature; it never prints or stores private-key material.

## Client policy

The verifier rejects unknown fields, unsupported schema/product/channel values,
pre-release versions, malformed timestamps, noncanonical JSON, unknown keys, bad
signatures, insecure production origins, credentials, query strings, fragments,
cross-origin URLs, wrong platform/architecture, non-newer versions, revoked
versions, and installations outside the signed 10%, 50%, or 100% cohort.

The cohort is deterministic: `SHA-256(installationId + targetVersion) mod 100`.
The update manager must revalidate the envelope and stream-check the published
artifact SHA-256, SHA-512, and size immediately before installation.
