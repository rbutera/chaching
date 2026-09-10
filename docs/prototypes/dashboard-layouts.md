# Dashboard layouts: throwaway prototype

Question: which layout makes spend, charts and Account capacity easiest to read at full-screen and monitor-corner sizes?

Run `pnpm prototype`, then open http://localhost:5192/?variant=A.

- A: current Accounts together, spare capacity immediately below.
- B: an Account ledger, ordered by the most constrained quota.
- C: provider columns, with each provider's Accounts together.

The floating bar and left/right keys switch layouts. Preview state selects overview, session detail or cold scan. Explore usage and Settings are fixture-backed previews. No real account/config mutations or live data are used. The illustrative period is fixed to 30 days. The rest of the repository is retained to reuse its real fonts, tokens, mark and MoneyFigure primitive; only this branch replaces the homepage.

The prototype is on `feat/dashboard-layout-prototype`, not the production branch. No winner has been selected. Follow the dashboard IA resolution in the issue tracker; do not promote this rough rendering directly into production.

Validation: `pnpm check` passed with zero errors/warnings; `pnpm build:sk` passed. Browser checks covered all layouts at desktop/390px phone width, the switcher, session detail and cold scan. The mechanical design scan reported one thick-border/rounded-card warning; the relevant quota panels are square. No tests were added for throwaway fixture rendering.

## Revision after live feedback

Prominent all-time/today/7-day/30-day totals now precede charts and quotas. Preserve the real amount-driven chaching voice, not invented taglines. Provider/machine/Account filters operate on the same deterministic fixture entries and scope totals, charts, sessions, fees and quota rows. The five-hour block remains explicitly local. Header is compact; narrow or short windows use dense quota rows and collapsed prototype controls. Checked at 1440x1000, 560x560 and 390x700. The fixture selector has a passing intersection/deduplication check.
