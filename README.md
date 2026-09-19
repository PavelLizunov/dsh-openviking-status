# @openviking-community/dsh-openviking-status

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

### Release tarball (recommended)

In the DSH terminal:

```bash
dsh plugin add https://github.com/dipertq/dsh-openviking-status/releases/latest/download/dsh-openviking-status.tgz
```

Then restart DSH Desktop. That is the whole procedure: DSH reads the package's
`dsh.bundle.patch`, adds it to `dsh.profile.bundles` itself, and the chip appears
in the composer bar.

The link always resolves to the newest release, so it never goes stale. To pin a
specific version, use its asset instead:

```bash
dsh plugin add https://github.com/dipertq/dsh-openviking-status/releases/download/v0.1.3/openviking-community-dsh-openviking-status-0.1.3.tgz
```

### Why not `github:dipertq/...`?

That form works, but costs an extra manual step. A `github:` spec makes pnpm
build the package on your machine, and pnpm blocks build scripts until the
package is allowlisted. The pnpm shipped with DSH Desktop (11.8.0) only matches
a commit-pinned key, which changes on every push — so the entry has to be
re-added for each new version:

```yaml
# ~/.dsh/profiles/desktop/pnpm-workspace.yaml
allowBuilds:
  "@openviking-community/dsh-openviking-status@https://codeload.github.com/dipertq/dsh-openviking-status/tar.gz/<commit-sha>": true
```

The tarball ships `lib/` already compiled, so no build script runs and no
allowlist entry is needed. See [ADR 0004](./docs/adr/0004-install-paths.md).

## Releases & CI/CD

- **CI**: Runs on every pull request and push to `main` (`tsc`, `pnpm test`, `pnpm run build`).
- **Release**: Automatically publishes GitHub Releases with compiled artifacts (`.tgz` and `.zip`) when a tag `v*` is pushed.
- **Trigger a release**:
  ```bash
  pnpm run release:patch  # 0.1.0 -> 0.1.1
  pnpm run release:minor  # 0.1.0 -> 0.2.0
  pnpm run release:major  # 0.1.0 -> 1.0.0
  ```

## License

MIT
