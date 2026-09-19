# @dipertq/dsh-openviking-status

> Minimalist OpenViking status chip and popover for DeepSeek Harness (DSH Desktop / Web).

## Overview

This DSH UI plugin injects a live status chip into the composer bottom bar (`conversation.input.right`). It provides at-a-glance transparency into OpenViking memory management:

- **Server Health**: Online / Offline indicator with live health checks.
- **Pending Tokens**: Real-time counter of session tokens accumulated before the auto-commit threshold (20,000 tokens).
- **Peer Scope**: Active project/repository context peer ID.
- **Commit Trigger**: Instant "Commit To Memory Now" action button.

## Architecture & Design

See [CONTEXT.md](./CONTEXT.md), [ADR 0001](./docs/adr/0001-client-ui-widget.md), and [ADR 0002](./docs/adr/0002-release-workflow.md).

## Installation in DeepSeek Harness

### From npm (recommended)

```bash
dsh plugin add @dipertq/dsh-openviking-status
```

Then restart DSH Desktop. That is the whole procedure: DSH reads the package's
`dsh.bundle.patch`, adds it to `dsh.profile.bundles` itself, and the chip appears
in the composer bar.

### From a release tarball

Equivalent, and useful when the registry is unreachable. Use a
**version-pinned** URL:

```bash
dsh plugin add https://github.com/dipertq/dsh-openviking-status/releases/download/v0.1.7/dipertq-dsh-openviking-status-0.1.7.tgz
```

Not `/releases/latest/download/…`: that URL keeps its name while its content
changes, so pnpm records no `integrity` for it and every later `pnpm install` in
the profile fails with `ERR_PNPM_MISSING_TARBALL_INTEGRITY`.

### Why not `github:dipertq/...`?

That form works, but costs an extra manual step. A `github:` spec makes pnpm
build the package on your machine, and pnpm blocks build scripts until the
package is allowlisted. The pnpm shipped with DSH Desktop (11.8.0) only matches
a commit-pinned key, which changes on every push — so the entry has to be
re-added for each new version:

```yaml
# ~/.dsh/profiles/desktop/pnpm-workspace.yaml
allowBuilds:
  "@dipertq/dsh-openviking-status@https://codeload.github.com/dipertq/dsh-openviking-status/tar.gz/<commit-sha>": true
```

Both recommended forms ship `lib/` already compiled, so no build script runs and
no allowlist entry is needed. See [ADR 0004](./docs/adr/0004-install-paths.md).

### Troubleshooting: `ERR_PNPM_IGNORED_BUILDS`

If a previous `github:` attempt left entries in your profile's
`pnpm-workspace.yaml`, pnpm may have written them with a literal placeholder:

```yaml
allowBuilds:
  "@dipertq/dsh-openviking-status@https://...": set this to true or false
```

A placeholder means "not decided yet", so every install fails until it is a real
boolean. Delete those stale entries — neither recommended install path needs
any of them:

```yaml
allowBuilds:
  node-pty: true
```

## Releases & CI/CD

- **CI**: Runs on every pull request and push to `main` (`tsc`, README install-URL
  check, `pnpm test`, `pnpm run build`).
- **Release**: Pushing a `v*` tag builds the package, verifies it, and publishes a
  GitHub Release with the versioned `.tgz`.
- **Trigger a release**:
  ```bash
  pnpm run release:patch  # 0.1.0 -> 0.1.1
  pnpm run release:minor  # 0.1.0 -> 0.2.0
  pnpm run release:major  # 0.1.0 -> 1.0.0
  ```
  Bump the install URL in this README to the new version — CI fails if it drifts.

### npm publishing

Releases publish to npm through
[trusted publishing](https://docs.npmjs.com/trusted-publishers): GitHub Actions
authenticates over OIDC with short-lived credentials, so there is no `NPM_TOKEN`
secret to store or rotate, and each release carries a provenance attestation
proving which commit and workflow built it.

This is already configured, so a release needs nothing beyond the usual
`pnpm run release:*`. The one-time setup was: publish the first version by hand
(trusted publishing is configured per package, so the package has to exist),
then register a GitHub Actions publisher on the package's
**Settings → Trusted Publisher** page — user `dipertq`, repository
`dsh-openviking-status`, workflow `release.yml`, environment blank.

## License

MIT
