# Nightly releases and reusable CI

Implementation specification for [Release mechanics](https://github.com/rbutera/chaching/issues/10) and [CI gate](https://github.com/rbutera/chaching/issues/12), with the prerequisite [npm trusted-publisher setup](https://github.com/rbutera/chaching/issues/11). Implements the previously approved nightly app-only patches, manual version bumps and generated commit-based notes. Planning only; no workflow or publisher settings were changed.

Build this after the Nx migration. Use its single assembled `dist/chaching` distribution and dependency graph. Keep pnpm for dependency installation, builds and scripts; a pinned npm CLI is a registry publishing tool only, not a second package manager or lockfile.

## Release eligibility and notes

Schedule `.github/workflows/release.yml` for 03:17 UTC daily, away from the start of the hour. GitHub schedules are best-effort and may run late. The manual Release action supports patch, minor and major, with patch default. Manual release can publish without an app diff. Scheduled release requires an unreleased app change and always bumps patch.

Compare the pinned candidate against the last fully completed automated release, not the latest tag or last workflow run. Bootstrap once from a verified existing common version/tag/npm release; do not infer completion from a historical tag alone or repair the old tag/npm gaps. Keep the bootstrap anchor in release configuration once verified.

Release-relevant inputs are CLI/dashboard production sources, their transitive workspace dependencies, runtime dependencies and shipped app assets. A dependency graph edge alone is insufficient: filter test and documentation inputs before determining affected distribution projects. Root version/changelog changes from the release bot do not qualify. Test-only, documentation-only, planning-only, CI-only and standalone site-only changes do not qualify. Build or packaging configuration changes qualify when they can alter shipped app behavior. Mixed app/docs changes qualify.

Compare resolved dependency closures for the distribution and its build tools rather than treating every lockfile edit as an app change. Dev-only test or site dependency updates do not trigger publication. Renames and deletions count; use both baseline and candidate graphs so deleting a dependency/project cannot hide its effect. Unknown changed paths under a shipped runtime root count conservatively. Classification is one tested script shared by scheduled releases and dry-run diagnostics.

Generate notes from Git commits since the completed-release anchor through the candidate source SHA. Group conventional feature/fix subjects and other release-relevant changes. Handle plain commit messages without rejecting the release. Exclude release-generated commits and merge-wrapper duplicates. Use structured Git output, not shell interpolation of commit subjects. Escape Markdown where needed. Use the same generated section in CHANGELOG.md and the GitHub release body; no hand-written changelog or required PR labels.

Use a small Node release script with a direct patch/minor/major bump; Nx Release, release-please and a changelog service are unnecessary for one published package. Create annotated `vX.Y.Z` tags. Check in the root version and generated changelog together. Asset generation must be deterministic: CI regenerates tracked assets and fails on a diff; release automation does not silently commit unrelated generated asset churn.

## One tested artifact and safe promotion

Serialize all prepare, publish and recovery invocations with one repository-wide release concurrency group and `cancel-in-progress: false`. The publish continuation below queues behind its preparing run, which must exit after dispatch. CI uses a different group so it cannot cancel the parent release.

1. Pin current main as source S. Recover any incomplete automated release before allocating another version. Compute eligibility and version; a scheduled no-op exits successfully with an explicit skipped outcome.
2. Create release commit R from S containing only version/changelog changes. Push an ordinary temporary candidate branch so R is fetchable by reusable CI. Never write main yet. Run the full reusable gate on R and produce the final tarball from R. A prior successful gate on S does not prove R passed.
3. Record R, S, version, gate run, normalized package contents and tarball integrity in a release manifest. Keep the tested tarball as an Actions artifact. Immediately before promotion, verify remote main is still S. Atomically push the fast-forward main update and annotated tag. If main advanced, abandon this candidate without force-pushing; rebuild a fresh candidate on the next attempt. A conflicting existing tag is an error, not permission to retag.
4. Create a draft GitHub release for the tag and attach the exact tested tarball and manifest. Retry bounded transient upload failures. Dispatch `release.yml` again at that tag with a `resume_tag` input, then end preparation. The tagged invocation skips allocation and publishes only that recorded version. This makes the publishing workflow's source revision match the tagged package source for provenance. Do not rely on a tag push made with GITHUB_TOKEN triggering another workflow.
5. The tagged run verifies its checked-out commit, immutable tag, successful gate record, manifest and tarball integrity before publishing. Use the artifact as-is with lifecycle scripts disabled; do not rebuild in the privileged publishing step. Publish with provenance and public access. Check registry availability and the registry tarball integrity, then undraft the GitHub release and verify its assets/body/tag. Only then is the release complete.

The existing green-SHA optimization applies only when the exact R, workflow revision and full gate contract already passed in this repository and the matching artifact still exists. Accept trusted push/candidate-release results, not arbitrary named checks from PRs or forks. Missing/ambiguous evidence means run CI. Skipped/cancelled jobs never become a successful gate through an unconditional `always()` branch.

A retry reads durable tag/draft/manifest state and resumes the same version. If npm already has it, compare published integrity with the recorded tarball and continue only on equality. Never republish that version, delete a tag, unpublish or allocate another patch to hide a partial failure. If the tarball is missing, rebuild the same R and rerun the gate; if npm already contains the version, require a byte-identical matching artifact or stop with the mismatch. Preserve incomplete release state for repair.

The final `always()` outcome job distinguishes no-op, complete and failed/partial outcomes. For attempted releases it independently verifies immutable tag target, expected npm version/integrity, published GitHub release and assets. Poll registry propagation with a bounded timeout. A tag alone or an uploaded draft never counts as completion. Keep diagnostics and candidate artifacts for failed attempts.

## Workflow identities and permissions

`ci.yml` supports pull_request, push to main and workflow_call with an explicit source ref. It has contents-read permission. `release.yml` contains scheduled/manual preparation and tagged recovery/publication. Preparation gets contents-write only where it pushes refs or writes release assets, and actions-write only where it dispatches the tagged continuation. Publication gets id-token-write and only the GitHub permissions required to read evidence and finalize the release. Checkout credentials are not retained in package build/test jobs. Pin external actions to reviewed commit SHAs.

Use GitHub-hosted runners for OIDC publication. The trusted publisher identifies owner `rbutera`, repository `chaching`, workflow `release.yml`, environment `npm-release`, with direct publish allowed. Configure that environment for release tag refs and no routine required reviewer, matching unattended nightly releases. Publication checks that the tag came from an automated candidate based on main and carries the expected evidence. Arbitrary branch dispatches cannot take the publish path.

Keep 2FA enabled. Do not switch to auth-only, add long-lived npm tokens or use stage-only publishing that would require nightly manual approval. Pin a release-tool npm CLI satisfying the documented OIDC minimum, 11.5.1 or newer, on the pinned supported Node runner; install it through the pnpm-managed tooling. Preserve package repository.url and provenance. Validate the exact pinned CLI/toolchain during implementation.

## CI matrix and order

| Runner | Node | Required work |
| --- | --- | --- |
| Ubuntu 24.04 | 24.16.0 supported floor | Full lint/boundary/type/test/build/package gate; PostgreSQL integration and rollout recovery |
| Ubuntu 24.04 | 26.7.0 initial dev pin | Same full gate; canonical release tarball |
| macOS 15 | 26.7.0 initial dev pin | CLI/renderer tests, typecheck/build, packed-install and dashboard smoke; no PostgreSQL service leg |

Keep these pins aligned with the Nx spec; toolchain upgrades are separate. The macOS leg checks the platform previously used for publication. No Windows support promise is introduced here.

Install with `pnpm install --frozen-lockfile`, including optional renderer dependencies and approved native build scripts. Use a PostgreSQL 17 service on Ubuntu with a health check, dedicated disposable credentials and matching pg_dump/pg_restore tools. Set both database and PG-tools test capability flags. Assert that the expected integration suites actually ran; a green report with all database tests skipped fails CI.

Generate SvelteKit configs and assets, then run boundary checks, typechecks, build and tests in their declared Nx order. Build both CLI and dashboard before subprocess tests that depend on their presence; the serve test must exercise its built-server branch. Use seeded provider fixtures and disposable config/history paths, preserving the real HOME needed by Node shims. No provider test may discover the runner's real user data or contact a live pool.

Run positive controls for forbidden imports and expected invalid gate inputs in disposable fixtures. Check both installed PNG success with renderer dependencies and the supported no-optional behavior in a separate packed install. The full renderer suite itself runs with optional dependencies installed. Exercise the packed CLI from an unrelated directory and serve root/subpath, assets and receipt routes on ephemeral ports.

Each matrix leg has a timeout and reports independently; do not let one failure cancel evidence from other legs. PR updates may cancel older CI runs on that PR. Main and reusable release gates do not cancel a release invocation. The gate aggregator runs with `always()` and explicitly requires every mandatory leg to succeed.

## Nx cache and artifact trust

Reuse Rennet's zero-dependency `tools/nx-cache-proxy.mjs` and restore/start steps. Adapt cache namespaces for OS, architecture, Node version, lockfile and trust context. The proxy must pass its health check or CI falls back to local execution, never silently skipping work. Do not restore Nx's local database as a portable remote cache.

PR-controlled caches cannot supply privileged release artifacts. Use a trusted-main/candidate namespace for release runs; fork PRs have no write access to it. Never cache mutation/publish tasks. Cache keys include build configuration and base path as specified by Nx. A cached test run may be reused only under the matching declared test inputs and capabilities; PostgreSQL-enabled and skipped-capability runs must not share a result key.

Store the canonical tested package and release manifest as run-scoped artifacts, with integrity checked by the publishing job. Verify the installed package version equals R's version. Cache reuse is an optimization, not evidence that an unrelated downloaded artifact was tested.

## Acceptance and rollout

Implement scripts and workflow fixtures first. Test scheduled app change, docs-only no-op, mixed change, source deletion, runtime versus test-only dependency change and manual minor/major. Fault-inject gate failure, missing matrix results, unavailable PG, stale CI evidence, main advancement, duplicate dispatch, interrupted upload, npm success followed by GitHub failure, registry delay and integrity mismatch. Every partial publication must resume the same version; no failed gate can publish.

Run dry-run preparation and packed-install gates without publication. Merge workflow implementation before configuring its trusted-publisher identity. Complete the authenticated npm/GitHub setup task, verify the recorded identity, then perform one deliberately initiated real release through the same workflow and verify both destinations. Enable the nightly schedule after that successful end-to-end run. A dry run cannot prove OIDC publication works.

The 2.0 launch checklist remains a separate product readiness decision. Routine CI/release automation does not itself certify that the landing page, launch documentation or 2.0 scope is complete.

## Sources

- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/): supported runners, tool minimums, workflow identity and token-free publishing.
- [npm 2FA package settings](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/): retain strong account settings with trusted publishing.
- [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax): schedule, reusable workflows and concurrency.
- Local Rennet `auto-release.yml`, `release.yml` and `ci.yml`: reusable gate, exact-SHA lookup, atomic ref push, draft-first assets, retry and outcome assertion patterns. This spec tightens candidate-SHA verification and npm artifact recovery for chaching.
