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

### Option A: Standard `dsh plugin add` (Recommended)

In your DSH terminal / shell:

```bash
dsh plugin add github:dipertq/dsh-openviking-status#v0.1.2
```

**That's it!** DSH will:

1. Automatically download the plugin repository and compile `lib/` via `tsup`.
2. Recognize it as a native DSH Bundle via `cordis.patch.yml` and add it to `dsh.profile.bundles`.
3. Automatically inject the OpenViking Status widget into the composer bar on next restart.

---

### Option B: From GitHub Release Tarball

```bash
dsh plugin add https://github.com/dipertq/dsh-openviking-status/releases/download/v0.1.2/openviking-community-dsh-openviking-status-0.1.2.tgz
```

---

### Option C: Manual Configuration (Alternative)

If installing manually without `dsh plugin add`:

1. Add to `~/.dsh/profiles/desktop/package.json`:

```json
"dependencies": {
  "@openviking-community/dsh-openviking-status": "github:dipertq/dsh-openviking-status#v0.1.2"
}
```

2. Add to `~/.dsh/profiles/desktop/cordis.patch.yml`:

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
