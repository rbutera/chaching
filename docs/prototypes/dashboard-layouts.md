# Dashboard layouts: throwaway prototype

Question: which layout makes spend, charts and Account capacity easiest to read at full-screen and monitor-corner sizes?

Run `pnpm prototype`, then open http://localhost:5192/?variant=A.

- A: current Accounts together, spare capacity immediately below.
- B: an Account ledger, ordered by the most constrained quota.
- C: provider columns, with each provider's Accounts together.

The floating bar and left/right keys switch layouts. Preview state selects overview, session detail or cold scan. Explore usage and Settings are fixture-backed previews. No real account/config mutations or live data are used. The fixture spans 120 days with previous/next day or window navigation and a native date input. The rest of the repository is retained to reuse its real fonts, tokens, mark and MoneyFigure primitive; only this branch replaces the homepage.

The prototype is on `feat/dashboard-layout-prototype`, not the production branch. No winner has been selected. Follow the dashboard IA resolution in the issue tracker; do not promote this rough rendering directly into production.

Validation: `pnpm check` passed with zero errors/warnings; `pnpm build:sk` passed. Browser checks covered all layouts at desktop/390px phone width, the switcher, session detail and cold scan. The mechanical design scan reported one thick-border/rounded-card warning; the relevant quota panels are square. Fixture checks cover filter intersections, totals and historical window bounds.

## Revision after live feedback

Prominent totals run in ascending order: local five-hour block, today, seven days, thirty days, all time. Charts follow, then compact remaining-quota rows. Preserve the real amount-driven chaching voice, not invented taglines. Provider/machine/Account filters operate on the same deterministic fixture entries and scope totals, charts, sessions, fees and quota rows. The five-hour block remains explicitly local. Header is compact; narrow or short windows use dense quota rows and collapsed prototype controls. Checked at 1440x1000, 560x560 and 390x700. The fixture selector has a passing intersection/deduplication check.

Explore uses searchable, sortable, paginated tables with 12 models and 140 projects. Selecting a model or project filters sessions; session rows open details. Day/7d/30d/90d/all controls, previous/next windows, date selection and chart-day drilldown share the selected range. Historical navigation leaves current headline totals and quotas current.

Spend comparisons show today versus yesterday, seven days versus the previous seven, and thirty days versus the previous thirty. Selected historical windows compare with the immediately preceding equal-length window under the same filters. Zero prior spend and unavailable history get explicit labels; all-time and the local five-hour fixture have no invented baseline. Today is partial and compares with the full prior day.

Comparison display: signed percentage only, green for lower spend and red for higher spend using existing good/bad tokens. Baseline context is in title/accessibility text. Today compares with all of yesterday, confirmed by Rai.

## Production parity refinement

This is a visual refresh, not a feature reduction. Use Space Grotesk throughout the interface, including session names, captions and numbers; reserve monospace for code and use tabular digits for aligned amounts. Labels are Spend, Sessions and Explore. Remove visible local/remaining-allowance boilerplate while preserving the five-hour block's underlying local scope.

The dashboard lists the five most recent sessions in the selected scope. Explore owns spend ranking, with the installed TanStack table sorting sessions by name, recency or spend and retaining search and bounded pages. Settings now previews account editing, sync/machine status and working personality/motion preferences. These controls remain fixture-only; production Settings must retain the existing real account and pool operations.

Headline amounts reuse production MoneyOdometer; quota and delta digits use its NumberFlow dependency. Bars transition their height/width as values change. Reduced-motion and the preview animation preference disable motion. Verified sortable headers, chronological sessions, account-edit controls, motion disablement, and no overflow at 390px/560px. Type check and build pass; three fixture checks pass. Five unchanged production MoneyOdometer tests pass from the production checkout; the prototype symlinked dependency setup cannot load that DOM suite directly.
