# Desktop Packaging

Aide packages Electron from the checked-in, frozen Bun dependency graph. The
packager is pinned to `electron-builder@26.15.3`; package scripts first build
`out/main`, `out/preload`, and `out/renderer`, then rebuild `node-pty` against
the running Electron ABI.

## Local Linux x64 package

`build/icon.png` contains the square aIDE symbol with white lettering for dark
desktops. The packager uses this image for platform icons and application
windows. `build/logo.png` retains the full supplied wordmark. The desktop
installer copies the square icon beside the installed AppImage.

<details>
<summary>Icon preparation prompt</summary>

Tool: built-in imagegen. Source: the supplied dark-letter logo.

Edit this logo to make a final production desktop icon. Use the TOP SYMBOL ONLY,
remove the whole bottom wordmark. Preserve the shape of the lowercase a with
&lt;&gt; code brackets and the two stars. Change ONLY the dark navy fill of the
lowercase a to solid pure white. Keep purple left chevron and large star, bright
blue right chevron and small star. Redraw edges as perfectly clean smooth
antialiased vector-style curves with absolutely NO speckles, texture, rough
edges, paint debris, grain, scratches, outlines, shadows or glow. Preserve shape
and layout; this is not a redesign. Tight SQUARE canvas, symbol including stars
fills 90 percent width and height with about five percent safe padding.
Transparent alpha background; no black backdrop, no background tile, no
checkerboard painted into image. Clean flat opaque fills, high contrast on a
dark desktop. No words, no lettering outside the a symbol.

</details>

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

## Install or update the Linux desktop launcher

The app displays its packaged version beside Diagnostics in the top bar. Local
releases start at `0.0.1`; increment the patch version in `package.json` for each
subsequent release, such as `0.0.2`, before building.

```sh
bun run install:linux
```

This builds and verifies only the AppImage in `dist/local-install/`, then installs
`~/.local/share/aide/Aide.AppImage`, `~/.local/bin/aide`, and one desktop entry
named **aIDE**. `XDG_DATA_HOME` overrides the data directory. Each installation
atomically replaces the AppImage at the same path. Close aIDE and reopen the
same shortcut after installing an update. Saved workspaces remain in the app's
user data directory.

To install an existing trusted build without rebuilding:

```sh
bun run install:linux /absolute/path/to/Aide-version-linux-x86_64.AppImage
```

The launcher optionally sources `~/.config/aide/launch-env`, respecting
`XDG_CONFIG_HOME`. Put desktop-only environment setup there, such as adding your
provider CLI directory to `PATH` or sourcing an existing protected Jev credential
file. Credentials stay out of the desktop entry and build artifacts.

AppImages normally require FUSE 2. Hosts without `libfuse.so.2` can add
`export APPIMAGE_EXTRACT_AND_RUN=1` to `launch-env` to use the AppImage runtime's
extraction mode. Extraction adds startup time and uses temporary disk space.

This command installs local builds. Automatic downloads require the signed
release configuration described in the OTA operations guide.

The display name is `aIDE`. Existing `Aide-<version>` artifact names, the `aide`
executable, desktop ID, and user data directory remain stable.

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
