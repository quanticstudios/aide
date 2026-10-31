# Web protocol fixtures

Vendored from pitwall's [`testdata/web-protocol`](https://github.com/quanticstudios/pitwall/tree/main/testdata/web-protocol). Do not edit them here: pitwall's README there describes the format and how pitwall builds them, and its `TestConformance` fails when its code no longer produces them.

Each `*.json` is one fake provider scenario. `deltas` is the stream pitwall sends a web client and `snapshot` is where that stream ends. `src/shared/web-protocol-fixtures.test.ts` applies `deltas` with `applyDelta` and expects `snapshot`, and checks every file against `SHA256SUMS`.

To update the copy after a pitwall change merges, run this and commit the result:

```sh
bun run vendor:web-protocol
```

`bun run check:web-protocol` exits 1 when the copy differs from pitwall `main`. The `Web protocol fixtures` workflow runs it on every push, every pull request, and daily.
