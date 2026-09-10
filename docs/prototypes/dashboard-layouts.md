# Dashboard layouts: throwaway prototype

Question: which quota-first structure makes current and spare Account capacity easiest to read?

Run `pnpm prototype`, then open http://localhost:5192/?variant=A.

- A: current Accounts together, spare capacity immediately below.
- B: an Account ledger, ordered by the most constrained quota.
- C: provider columns, with each provider's Accounts together.

The floating bar and left/right keys switch layouts. Preview state selects overview, session detail or cold scan. Explore usage and Settings are fixture-backed previews. No real account/config mutations or live data are used. The illustrative period is fixed to 30 days. The rest of the repository is retained to reuse its real fonts, tokens, mark and MoneyFigure primitive; only this branch replaces the homepage.

The prototype is on `feat/dashboard-layout-prototype`, not the production branch. No winner has been selected. Follow the dashboard IA resolution in the issue tracker; do not promote this rough rendering directly into production.

Validation: `pnpm check` passed with zero errors/warnings; `pnpm build:sk` passed. Browser checks covered all layouts at desktop/390px phone width, the switcher, session detail and cold scan. The mechanical design scan reported one thick-border/rounded-card warning; the relevant quota panels are square. No tests were added for throwaway fixture rendering.
