# AGENTS.md

## Agent skills

### Issue tracker

GitHub issues tracked via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical five-role triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`CONTEXT.md` and `docs/adr/` at repo root). See `docs/agents/domain.md`.

## DSH plugin contract

Breaking any of these sends DSH into Recovery Mode on the user's machine. Each
rule below cost a failed release; the details and evidence are in
`docs/adr/0003-dsh-client-bundle-contract.md`.

1. **The client bundle is not a module.** DSH serves `exports["./client"].default`
   to the browser as a `<script>` inside a combo bundle — there is no `exports`,
   `module`, or `import` in scope. The file must synchronously call
   `window.__ModuleLoader__.load({ id, factory })` at top level, with `id` equal
   to the package name, and take dependencies via the `require` passed to
   `factory`. `tsup.config.ts` wraps a CJS body in that call via banner/footer.
2. **`exports["./client"]` is resolved literally** — a string, or an object with a
   string `default`. Other conditions (`browser`, `node`) are ignored there.
3. **Claim a slot cell with `ctx.effect` + `ctx.slots.inject`/`register`**, passing
   the real slot key as `name` plus your own `id`. Reusing another plugin's `id`
   replaces its cell. `ctx.effect` is what binds the disposer to the plugin
   lifecycle.
4. **Session-scoped slots supply `sessionId` as a standard prop.** Never read it
   out of a global store.
5. **`tests/clientBundle.test.ts` guards rules 1 and 3** by executing the built
   artifact the way the browser does. Keep it passing; source-level unit tests
   cannot catch a build-format regression.

To discover a slot's exact contract (props, kind, scope, example), grep the
shipped catalog: `@deepseek-ai/dsh-cordis-client-runner/lib/client.js`.

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
4. **Recommend the release tarball, never `github:`.** A `github:` spec makes
   pnpm run `prepare` on the user's machine, and the pnpm bundled with DSH
   Desktop (11.8.0) blocks that until a _commit-pinned_ `allowBuilds` key is
   added — a key that changes on every push. The packed tarball ships `lib/`
   pre-built, so no build script runs and no allowlist entry is needed. The
   documented link is `/releases/latest/download/dsh-openviking-status.tgz`,
   a version-free asset the release workflow publishes alongside the versioned
   one. Details and the experiment in `docs/adr/0004-install-paths.md`.
5. Never manually add a package to `dsh.profile.bundles` if its `package.json` does not declare `dsh.bundle.patch` — doing so will trigger DSH Recovery Mode.
6. Never push a tag on a broken or unverified branch.
7. See `docs/adr/0002-release-workflow.md` for the architectural decision record.
