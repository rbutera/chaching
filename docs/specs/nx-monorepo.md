# Nx monorepo migration

Implementation handoff for [Nx workspace package boundaries](https://github.com/rbutera/chaching/issues/6), [publish layout](https://github.com/rbutera/chaching/issues/7) and [workspace hygiene](https://github.com/rbutera/chaching/issues/9). Product choices were approved in the Wayfinder conversation. Remaining settings below are engineering defaults. Source baseline is main `277a950`; the automatic-pricing implementation must land before this migration starts.

## Package ownership and dependencies

Use six private ESM workspaces, all named `@chaching/<name>`. Root package is private workspace tooling. Only the generated distribution is named `chaching` and published.

| Directory | Responsibility | Allowed first-party dependencies |
| --- | --- | --- |
| `packages/shared` | Types, format, brand, voice, pure pricing and shared pure snapshot calculations | None |
| `packages/core` | Provider ingestion, accounting orchestration, history, pricing fetch/cache, Account discovery, sync | shared |
| `packages/receipt` | Receipt/Wrapped models, redaction, text and PNG rendering | shared |
| `packages/cli` | Commands, TUI, MCP, terminal capability discovery | shared, core, receipt |
| `apps/web` | Dashboard and its server routes | shared; core and receipt only in server code; receipt's pure models may be used in browser code |
| `apps/site` | Landing page | shared; receipt in build-only asset generation |

Declare each imported external dependency in its consuming workspace. Internal dependencies use `workspace:*`. Do not depend on root hoisting. Keep libraries source-exported through explicit subpaths used by callers, following Rennet's source-export approach. Do not create one barrel that imports every module, export wildcard internals or add separate library build steps without a consumer requiring them.

Shared contains no Node, PostgreSQL, SvelteKit, filesystem or environment access. Move the existing pure aggregation, window selection and subsidisation helpers there when receipt/browser callers need them; do not copy their implementations. Automatic pricing's shared resolver belongs here, while download/cache/persistence stays in core. Build-time base-path normalization retains its plain JavaScript entry so Svelte configuration can load it directly.

Receipt exposes pure models/build transforms separately from `./text` and `./png`. Pass resolved valuation data and terminal rendering options into transforms; do not resolve Node pricing or inspect terminal state while constructing browser-safe models. Move reusable personality copy/constants to shared. Terminal detection stays in CLI. PNG imports satori/resvg lazily and reads packaged fonts through its Node adapter. Preserve default-theme receipt output and all existing personality text.

## Enforced boundaries

Give each Nx project a `layer:<name>` tag and encode the table with `@nx/enforce-module-boundaries` in ESLint. Check dependency declarations as well as source imports; forbid cross-package relative imports and cycles. Allow intra-package relative imports. Do not add exceptions for the old web-to-CLI receipt dependency.

Project tags alone cannot distinguish Svelte server routes from browser code in the same app. Keep core and receipt PNG imports under web server-only modules/routes. Extend existing client-safety checks over browser entry graphs, including Svelte imports, to reject transitive Node imports and server-only receipt subpaths. The pure receipt entry cannot re-export the PNG entry.

Adapt Rennet's `scripts/check-boundaries.mjs` positive-control pattern. Insert temporary forbidden imports in isolated fixtures and assert the intended diagnostic, then remove them in `finally`. Cover shared importing core, web importing CLI and a browser component reaching receipt PNG. A parser error, missing fixture or unrelated lint error does not count as the expected failure. Also prove a permitted shared import succeeds.

Use ESLint for these architecture checks. Do not introduce Biome, a broad new style policy or mass formatting during the move. Preserve existing tabs and file style. Formatter adoption can be a separate change if requested.

## Distribution assembly and installed paths

Create one root-owned `package` target and `tools/assemble-package.mjs`. It assembles `dist/chaching` from completed CLI and dashboard builds. This is generated output, not a seventh source workspace. Root package holds the single release version and package metadata; assembly derives the publish manifest from it, sets name `chaching`, removes private/tooling fields and includes only the external runtime dependencies actually needed by emitted code.

| Installed path | Source or consumer |
| --- | --- |
| `package.json` | Generated publish manifest; `bin.chaching` points to `bin/chaching.js` |
| `bin/chaching.js` | Thin launcher loading `../cli/index.js`; retain supported exit behavior |
| `cli/index.js` | Bundled CLI plus first-party source dependencies |
| `server/` | Entire adapter-node output, including its client and server subdirectories |
| `assets/pricing/` | Bundled normalized catalogs from the pricing implementation |
| `assets/fonts/` | Fonts required by receipt and Wrapped rendering |
| `docs/`, `CONFIG.md`, `config.example.json`, `docker-compose.sync.yml`, `LICENSE`, `README.md` | Existing shipped documentation and support files |

Site output is deployed separately and is excluded from the npm artifact. Keep dashboard static assets in adapter-node's output. Resolve font package assets at build time through declared dependencies, then copy the required files; remove assumptions about root `node_modules/@fontsource` paths.

Installed code resolves package-owned paths relative to module URLs, never the user's working directory. Supply the generated distribution root explicitly at the CLI/server bootstrap boundary and pass it to Node asset adapters. Browser code never receives filesystem paths. Development targets provide their known source asset root; do not retain a ten-parent search or legacy server-launch fallback to mask an incomplete package.

Bundle all `@chaching/*` references into the CLI and adapter output. Explicitly configure adapter/Vite handling for source workspaces; do not leave private workspace imports or `workspace:` dependency versions in the tarball. External native dependencies remain external. Preserve optional PNG behavior when renderer dependencies are omitted; reconcile today's duplicate renderer declarations into the appropriate build and published optional dependencies. Assert that bundled SQLite imports use `node:sqlite`; retain the existing tsup fix until the emitted artifact proves it unnecessary.

`CHACHING_BASE_PATH` remains build-time configuration. Include it in the dashboard and assembly cache inputs. Runtime origin remains runtime configuration. Update launcher, serve, rollout scripts, pricing adapters, font loading and subprocess test paths together for the new installed layout. Live user config/history paths and pool schema do not change as part of Nx.

## Workspace configuration

Use pnpm 10.32.1, matching the completed workspace spike, with an exact root `packageManager`. Use the isolated linker; the spike found no correctness reason to hoist. Keep `engine-strict=true`, Node `>=24.16.0` as the package floor and Node 26.7.0 as the initial development pin. CI must exercise the supported floor as well as the development line. Do not bundle an unrelated toolchain upgrade into the move.

Use Rennet's supply-chain policy, not its application-specific exceptions: seven-day minimum release age, no trust downgrade, strict peers, exact saves and explicit dependency build allowlist. Inventory the locked tree's required native build scripts and allow only those. Use pnpm-10-compatible settings; do not copy newer-version configuration blindly. Delete package-lock.json and replace repository npm script calls with pnpm. Consumer installation through npm remains supported.

Libraries extend a shared strict `tsconfig.base.json` without cross-package `paths`. Web retains an app-local tsconfig extending its generated `.svelte-kit/tsconfig.json`. Share compatible compiler options through the generated config hook or supported configuration composition; do not replace SvelteKit's generated aliases with a second hand-maintained mapping. Remove the obsolete root extension to root `.svelte-kit`.

Scope forced runes to each app's own `src` using the tested normalized absolute-path predicate from the workspace spike. Linked libraries infer their own Svelte mode. App-local tests use SvelteKit's Vite plugin and run with that app as cwd; pure library and CLI tests use Node-oriented Vitest configs. Preserve component setup/cleanup in web tests only.

Move the subprocess CLI harness with CLI tests. Pass a built or freshly installed artifact root into it instead of counting parent directories. Continue using fixture provider/config paths and disposable databases, never developer usage. Update nested generated-output ignores, `.serena/project.yml` where present, and repository agent/developer instructions. Do not rewrite unrelated documentation or untracked user files.

## Nx targets and cache correctness

Expose root `build`, `check`, `test` and `package` commands through explicit Nx targets. Use the existing Vite/tsup/Vitest tools; Nx schedules them rather than replacing them. Source-only libraries have lint/typecheck/test targets, not placeholder builds. App typechecks/tests depend on app-local SvelteKit sync; CLI subprocess tests depend on the CLI build. Packaging depends on CLI and dashboard builds plus required assets, but never on itself through a prepack loop.

Declare actual output directories per target. Include transitive production source, relevant lock/config files, asset inputs, build-time base path and platform/Node identity where output is platform-sensitive. Test inputs include tests and setup. Exclude generated outputs from inputs. Never cache publish, database mutation or live migration targets.

Make packaging a root-owned Nx project with explicit dependencies on CLI, web and consumed asset producers. Tests changing alone must invalidate tests without requiring a new npm release. Shared runtime and asset changes must affect their consumers. Site-only changes must not affect the distribution target. These graph facts are the input to the later nightly-release decision; release workflows are outside this migration.

Copy Rennet's zero-dependency Nx cache proxy when wiring CI, as already required by the map. Local correctness must not require the remote cache. CI job matrices, OIDC and release orchestration remain in their existing planning tickets.

## Migration order and acceptance

1. Start from main after automatic pricing merges. Inventory the resulting imports and all emitted runtime dependencies. Preserve the agreed ownership split while moving new pricing code with it.
2. Create workspace manifests/configs, move shared/core/receipt code with callers and tests, then move CLI/web/site. Remove old import paths and duplicate helpers in the same change. Keep site scaffolding limited to the tooling needed for the later site build.
3. Add boundary enforcement and app-specific client-safety checks. Run the forbidden and permitted controls with a cold cache.
4. Wire builds and deterministic distribution assembly. Build twice and verify no stale files survive assembly. Inspect the packed manifest and emitted imports for private workspace references and missing externals.
5. Install the tarball outside the checkout. Exercise CLI help, seeded stats, text/JSON receipt and Wrapped, PNG with renderer installed, supported behavior without optional renderer dependencies, and dashboard root/subpath routes. Run the pool rollout rehearsal against the new artifact layout in disposable databases.
6. Run every existing test, typecheck and build through Nx. Prove cold-cache and warm-cache runs agree. Change a shared runtime fixture and confirm affected consumers rerun; change only site code and confirm the distribution is unaffected. Verify clean checkout setup using the pinned tools and supported Node floor.

The migration is complete when the packed app works independently of workspace links and every former production check still executes. No live pool migration, release publication or new pricing behavior belongs in this PR.

## Evidence

- [Completed workspace compatibility spike](https://github.com/rbutera/chaching/issues/8#issuecomment-5635463418): both linkers, app-local runes/tests/types and stale root tsconfig reproduction.
- [Nx module-boundary rule](https://nx.dev/docs/kb/enforce-module-boundaries): tag-based dependency constraints.
- [pnpm 10 settings](https://github.com/pnpm/pnpm.io/blob/main/versioned_docs/version-10.x/settings.md): linker and supply-chain configuration.
- Rennet's local `nx.json`, package source exports, `eslint.config.mjs` and `scripts/check-boundaries.mjs` supplied the implementation patterns. Its unrelated vendor, Electron and package exceptions do not transfer.

## Implementation validation

The migration uses source exports with explicit Nx targets. The site workspace contains only tooling scaffolding; it has no invented landing-page content or distribution dependency. CLI tests install the assembled tarball into a temporary directory, so isolated linking cannot hide a missing runtime dependency.

Adapter-node externalizes regular dependencies, so the web workspace declares the PNG renderer there while the receipt workspace declares it optional. Assembly emits the renderer only under optionalDependencies in the public package. The package manager retains a seven-day release delay and no-downgrade trust policy, with a one-year trust-history window; no package-specific trust exceptions were added.

Validation covered all 1,165 tests, disposable PostgreSQL integration and schema 2/3/4 rollout rehearsals, six workspace typechecks, forbidden/permitted boundary controls, deterministic assembly with stale-file cleanup, and installed-package checks on Node 24.16 and 26.7. Root and subpath dashboards, CLI JSON/text/PNG output, and omitted optional renderers were exercised outside the repository. Task-hash probes showed shared test edits invalidating only shared tests, shared runtime edits invalidating consumers, and site-only edits leaving distribution tasks unchanged.
