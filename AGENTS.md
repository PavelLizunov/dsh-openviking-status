# AGENTS.md

## Agent skills

### Issue tracker

GitHub issues tracked via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical five-role triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`CONTEXT.md` and `docs/adr/` at repo root). See `docs/agents/domain.md`.

## Releases & CI/CD

### Release Pipeline

Releases are automated via GitHub Actions:

- **CI Workflow** (`.github/workflows/ci.yml`): Runs on every push and pull request to `main`. Executes `tsc --noEmit`, `pnpm test`, and `pnpm run build`.
- **Release Workflow** (`.github/workflows/release.yml`): Triggered automatically when a Git tag matching `v*` (e.g. `v0.1.0`) is pushed, or manually via `workflow_dispatch`. It builds artifacts, packages a `pnpm pack` tarball, archives `lib/`, and creates a GitHub Release with auto-generated release notes.

### Versioning Rules for Agents & Developers

1. Follow Semantic Versioning (`vMAJOR.MINOR.PATCH`).
2. Always ensure local verification passes before cutting a release: `pnpm test` and `pnpm run build`.
3. To trigger a release:
   - Patch release (bugfix, minor update): `pnpm run release:patch`
   - Minor release (new backward-compatible features): `pnpm run release:minor`
   - Major release (breaking architectural changes): `pnpm run release:major`
   - Or manually: `git tag vX.Y.Z && git push origin vX.Y.Z`
4. Never push a tag on a broken or unverified branch.
5. See `docs/adr/0002-release-workflow.md` for the architectural decision record.
