# Desktop Packaging

Aide packages Electron from the checked-in, frozen Bun dependency graph. The
packager is pinned to `electron-builder@26.15.3`; package scripts first build
`out/main`, `out/preload`, and `out/renderer`, then rebuild `node-pty` against
the running Electron ABI.

## Local Linux x64 package

Run the following on a native Linux x64 host after a fresh locked install:

```sh
bun install --frozen-lockfile
bun run package:linux
```

This produces these deterministic artifact names in `dist/`:

- `Aide-<version>-linux-x86_64.AppImage`
- `Aide-<version>-linux-x64.tar.gz`
- `SHA256SUMS`

The command removes stale `dist/` contents, verifies the rebuilt local
`node-pty`, and smoke-tests both the packaged tarball and AppImage. Each smoke
test verifies that the ASAR contains the application, the Claude executable is
unpacked and executable, and the unpacked `node-pty` native module loads using
the packaged Electron executable.

## Native macOS packages

Never create production macOS artifacts from Linux. Run each command after a
fresh locked install on a host of the same architecture:

```sh
bun run package:mac:x64
bun run package:mac:arm64
```

Each native job produces a DMG, ZIP, and `SHA256SUMS` in `dist/`. The package
configuration uses the hardened runtime with the required JIT, unsigned
executable-memory, and native-module library-validation entitlements.

`node-pty` and the platform-specific Claude Agent SDK executable package are
unpacked from ASAR. A fresh install is required for every target: do not copy
`node_modules` from a Linux build into a macOS package.

## Signing and notarization

The `Package desktop artifacts` workflow builds Linux on `ubuntu-24.04`, macOS
x64 on `macos-15-intel`, and macOS arm64 on `macos-15`. It uses only
commit-pinned actions and uploads only distributables plus their checksums.

For tagged `v*` builds, configure these GitHub Actions secrets. The workflow
rejects a tag build if either signing or notarization material is missing:

- `CSC_LINK`: a base64-encoded Developer ID Application `.p12` certificate (or
  another `electron-builder`-supported certificate locator).
- `CSC_KEY_PASSWORD`: password for that certificate.
- `APPLE_API_KEY_P8`: contents of an App Store Connect API-key `.p8` file.
- `APPLE_API_KEY_ID`: the key ID.
- `APPLE_API_ISSUER`: the issuer ID.

The workflow writes the API key to a protected runner-temporary file and passes
its path as `APPLE_API_KEY`. `electron-builder`'s built-in notarization runs
when the Apple credentials are available. After a signed/notarized build, the
native package command verifies `codesign`, Gatekeeper assessment, and stapled
notarization. Manual workflow dispatch without secrets may create unsigned
test artifacts, but is not a release path.

## Checksums

`bun run package:checksums` writes SHA-256 hashes for AppImage, tar.gz, DMG,
and ZIP artifacts in lexical filename order. Verify a download with:

```sh
sha256sum --check SHA256SUMS
```

## OTA publication

Package artifacts are not public releases. Tagged builds are collected into an
internal immutable bundle, then a separately protected workflow verifies
offline-signed per-target promotion records before writing public Cloudflare R2
objects and stable channel pointers. See [OTA release operations](18-ota-release-operations.md).
