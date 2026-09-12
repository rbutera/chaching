# Releases

Run the **Release** GitHub action on `main` with a patch, minor or major bump. Set `dry_run` to check the exact proposed release commit and packed install without updating main, tagging or publishing. A temporary `release-candidate/` branch and Actions artifacts retain the result for inspection.

The nightly schedule stays disabled until the first verified trusted-publisher release. Once enabled, 03:17 UTC runs publish a patch only for unreleased app or build changes. Documentation, tests, CI and the standalone site do not qualify. The classifier reads both Git trees and resolved runtime/build dependency closures; new build tools must be included in `tools/release-inputs.mjs`.

Every release tests its version/changelog commit through the existing Linux and macOS CI matrix, then promotes main and its annotated tag atomically. If main advances during CI, the run fails without overwriting it. Rerun Release on current main. The canonical Linux tarball is published unchanged by a second invocation of the same workflow at the release tag.

## Setup

The package's trusted publisher must identify `rbutera/chaching`, workflow `release.yml`, environment `npm-release`, with direct publication allowed. The environment allows `v*` tags and has no routine required reviewer. Keep account 2FA enabled and use no npm token. The pinned npm CLI runs through pnpm only in the publishing job. Repository metadata is retained in the assembled package for provenance.

The bootstrap anchor is the verified common tag, npm gitHead and GitHub release at `v1.18.0`. Its SHA and npm integrity live in `.github/release/config.json`. Historical tag-only releases are not repaired or treated as completed releases.

## Recovery

Run Release on `main` again after a failed release. An incomplete automated tag takes precedence over any new version allocation. The same tagged commit passes the full gate again; rebuilt package bytes must match the immutable tag manifest. The workflow restores draft assets and dispatches publication at that tag. A fresh `gate.json` binds recovery checks to the original source and tarball even when the old Actions run has expired.

For a publication-only retry with intact assets and gate evidence, dispatch Release at the exact tag and set `resume_tag` to that tag. An existing npm version is accepted only if its tarball integrity matches. Successful npm publication followed by GitHub failure therefore resumes without republishing or incrementing the version.

Keep the annotated tag, manifest and tarball when diagnosing failures. An integrity mismatch is an error; do not retag, unpublish or bump around it. The independent outcome job checks the tag target, npm tarball and published GitHub release assets. A successful preparing run means the tagged continuation was dispatched, not that publication is complete.

The checks in `tools/release.test.mjs` exercise skipped gates, stale evidence, concurrent main advancement, interrupted uploads, duplicate continuation dispatches, registry propagation, npm success followed by GitHub failure, missing artifacts and integrity mismatch using isolated Git repositories and simulated external services. Run them with `node --test tools/release.test.mjs tools/release-inputs.test.mjs`.
