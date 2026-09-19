# @openviking-community/dsh-openviking-status

> Minimalist OpenViking status chip and popover for DeepSeek Harness (DSH Desktop / Web).

## Overview
This DSH UI plugin injects a live status chip into the composer bottom bar (`conversation.input.right`). It provides at-a-glance transparency into OpenViking memory management:
- **Server Health**: Online / Offline indicator with live health checks.
- **Pending Tokens**: Real-time counter of session tokens accumulated before the auto-commit threshold (20,000 tokens).
- **Peer Scope**: Active project/repository context peer ID.
- **Commit Trigger**: Instant "Commit To Memory Now" action button.

## Architecture & Design
See [CONTEXT.md](./CONTEXT.md) and [ADR 0001](./docs/adr/0001-client-ui-widget.md).

## Installation in DeepSeek Harness

### 1. Build
```bash
pnpm install
pnpm run build
```

### 2. Register in Cordis patch
Add to `~/.dsh/profiles/desktop/cordis.patch.yml`:
```yaml
- insert:
    - id: openviking-status-ui
      name: '@openviking-community/dsh-openviking-status'
```

## License
MIT
