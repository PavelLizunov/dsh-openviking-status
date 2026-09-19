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

### Option A: From Source

```bash
pnpm install
pnpm run build
```

### Option B: From GitHub Release

Download the `dsh-openviking-status-vX.Y.Z.tgz` tarball or unzip `dsh-openviking-status-lib.zip` directly into your local plugins directory.

### Register in Cordis patch

Add to `~/.dsh/profiles/desktop/cordis.patch.yml`:

```yaml
- insert:
    - id: openviking-status-ui
      name: "@openviking-community/dsh-openviking-status"
```

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
