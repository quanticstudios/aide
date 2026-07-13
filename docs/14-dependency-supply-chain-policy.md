# Dependency and Supply-Chain Policy

The application is only shipped from a reproducible Bun dependency graph. The
enforcement command is `bun run check:dependencies`; CI runs it after a frozen
install and before every test or build step.

## Repository Controls

- `packageManager` pins Bun to `1.3.14`; CI also pins Node to `24.17.0`.
- Every direct runtime and development dependency must be an exact SemVer
  version. Ranges, tags, Git URLs, and local paths fail the policy check.
- `bun.lock` is committed and all local/CI installs use
  `bun install --frozen-lockfile`.
- Lifecycle scripts are trusted only for Electron and `node-pty`, which need
  platform binaries. UI packages are consumed from their published artifacts
  and do not execute install-time authentication or arbitrary lifecycle code in
  CI.
- `bunfig.toml` requires a seven-day (`604800` seconds) release age for every
  new direct or transitive resolution. Exceptions are prohibited by the policy
  check.
- CI fails on high or critical advisories with `bun audit --audit-level high`.
- Dependabot checks both Bun dependencies and GitHub Actions weekly.

## Security Overrides

These top-level Bun overrides are exact pins and are asserted both in
`package.json` and in the resolved `bun.lock` graph:

| Package | Pin | Vulnerable path and compatibility check |
| --- | --- | --- |
| `fast-uri` | `3.1.2` | Fixes versions through `3.1.1`; the MCP SDK's `ajv` dependency accepts `^3.0.1`. |
| `hono` | `4.12.25` | Fixes versions below `4.12.25`; the MCP SDK accepts `^4.11.4` and `@hono/node-server` peers on `^4`. |
| `picomatch` | `4.0.4` | Fixes the vulnerable `4.0.x` series; Vite, Vitest, and Tinyglobby accept `^4.0.3`. Bun resolves the former nested `micromatch/picomatch@2.3.2` entry to this single patched override. |

When changing a direct dependency or a security override, run the following and
commit both manifests only if every command passes:

```sh
bun install
bun install --frozen-lockfile
bun run test:dependency-policy
bun run check:dependencies
bun audit --audit-level high
```

## Protected `main` Prerequisites

Repository administrators must configure the following GitHub ruleset or branch
protection rule for `main`; a workflow file alone cannot make these requirements
non-bypassable.

1. Require a pull request before merging, with at least one approving review.
2. Require the `CI / Linux security and quality` status check and require it to
   be current with the target branch.
3. Require all review conversations to be resolved.
4. Block force pushes and branch deletion, and do not allow administrators or
   GitHub Apps to bypass the rule except for an explicitly documented emergency
   process.
5. Keep Actions restricted to approved actions where the organization supports
   that setting, and enable Dependabot security updates/alerts.

The required CI job covers a fresh Ubuntu install, dependency policy, audit,
locked React Doctor, node tests, Biome, build, Electron-native PTY ABI, and
Xvfb-backed Electron end-to-end coverage.
