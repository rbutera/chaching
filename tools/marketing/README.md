# Public marketing site

`pnpm package && pnpm site:build` builds the static site into `apps/site/dist`. Serve that directory with a static host that resolves directory indexes. `pnpm site:dev` previews on port 4320. `pnpm site:check` checks the running preview (override `SITE_URL` to check a production build).

The homepage source is `apps/site/src/home.html`; the shared shell is `document.html`. Configuration, sync, licence and changelog pages are generated from repository documents. Command help comes from the built CLI. Generated pages are ignored, so edit their sources. No backend or analytics service is required.

## Product captures

`pnpm site:refresh` builds the product, creates an isolated fictional year of Claude usage and local Tokenmaxx accounts, starts an ephemeral PostgreSQL pool with two fictional machines, and runs the production receipt, Wrapped, browser and terminal renderers. It then rebuilds the shared social card and records asset/source hashes. `pnpm site:build` rejects missing or stale captures. Documentation-only changes do not require new captures.

Repeated captures reproduced receipt, Wrapped, desktop/corner dashboard and terminal poster bytes. The narrow dashboard capture now waits explicitly for the Machines control so asynchronous sync status cannot change its layout. VHS recordings kept the same duration/frame count; one transition frame differed between runs (a 1/15-second capture boundary).

Capture prerequisites: Docker, VHS, ffmpeg, Google Chrome and JetBrainsMono Nerd Font Mono installed. The current reference environment is macOS; exact tool versions, platform and terminal font hash are recorded in `assets.json`. The committed images allow ordinary builds without those capture tools. Locale is en-US, timezone UTC, time 2026-08-31 18:00, browser scale 1. All generated configuration/databases live in temporary directories and are removed. Capture reads no real usage directories or account stores.

The receipt and monthly Wrapped use August 1–31; the dashboard and terminal use the product's rolling 30-day period. A runtime assertion checks identical-period receipt/Wrapped totals. Browser sizes are 1440×1000, 560×560 and 390×700. The terminal movie is 1440×1000, 15 fps, H.264 with a static poster; reduced-motion visitors see the poster. The social card uses the actual receipt and bundled brand fonts, with no hand-authored spend figures.

The production Wrapped renderer currently supports monthly output. A yearly Wrapped export remains a launch dependency from issue #22; this site describes and shows the real monthly recap. Production hosting and the 2.0 launch switch remain tracked separately from this implementation.

## Production deployment

Cloudflare Pages project `chaching` serves `https://chaching.fyi` (`chaching-f1u.pages.dev`). The `Marketing site` GitHub Actions workflow builds and deploys pushes to `main` that change published site source/assets, its build configuration/generators, or the Markdown documents published on the site. Dashboard/CLI-only edits, tests and design notes do not trigger this workflow. A manual run on `main` is available for recovery.

The `marketing-production` GitHub environment permits only `main`. It holds `CLOUDFLARE_PAGES_API_TOKEN` and the `CLOUDFLARE_ACCOUNT_ID` variable. Wrangler is version-pinned in the workflow; Cloudflare Git integration is disabled because GitHub Actions owns the deployment. A build or freshness failure prevents upload. The workflow checks the public homepage and docs after uploading.
