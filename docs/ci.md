# Continuous integration

CI runs on pull requests and pushes to main. It is also callable by another workflow with an optional exact `ref`, and can be run manually through GitHub Actions.

The required gate joins three independent legs:

- Ubuntu 24.04 with Node 24.16.0, the supported minimum.
- Ubuntu 24.04 with Node 26.7.0, the development pin and canonical package producer.
- macOS 15 with Node 26.7.0, including native receipt rendering and packed-install checks.

Linux uses disposable PostgreSQL 17 and matching client tools. Required sync, migration and pool recovery suites must execute successfully; a green test runner with skipped mandatory suites fails the gate. macOS runs without the PostgreSQL suites.

`node tools/run-ci.mjs` runs workspace boundaries, typechecks, builds, per-project tests with JSON reports, package assembly and packed-install verification. Tests run without Nx cache so CI captures fresh execution evidence. For local database coverage, provide a disposable `CHACHING_TEST_DATABASE_URL` and set `CHACHING_TEST_PG_TOOLS=1` with PostgreSQL tools on PATH. Never point this at a live pool.

The package verifier installs the exact tarball outside the repository with disposable provider/config/history fixtures. It checks stats, receipt and Wrapped output, PNGs, dashboard assets and server PNG output. A second install omits optional renderers and checks the supported failure message. Linux on the development pin also builds and verifies a `/ci-subpath` dashboard.

Successful canonical runs upload `tested-package`, containing the default-path tarball and a manifest with source SHA, version and SHA512 integrity. The subpath exercise does not replace that tarball. All legs upload JSON test reports. This workflow does not publish npm packages or run live migrations.

The local Nx cache proxy reuses Rennet's implementation. GitHub cache namespaces distinguish platform, architecture, Node, lockfile and PR context. If its health check fails, tasks execute without the remote cache. A failed or skipped matrix leg cannot become a successful required gate.
