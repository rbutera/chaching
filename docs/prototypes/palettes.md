# Palette comparison prototype

Question: which concrete colours should fill the seven Themes' semantic slots?

Run `pnpm prototype` in this worktree, then open http://127.0.0.1:5196/?palette=register-light. The bottom picker and left/right keys change palette. Account view changes the accepted quota layouts; Preview state opens cold scan or session detail. Palette mapping below the dashboard exposes every semantic role, hex value and surface. Explore and Settings retain the accepted fixture prototype's interactions.

This throwaway branch extends dashboard prototype `4c25bdf`, including the typography and motion refinements after the original layout acceptance. All data remains fictional. No production theme preference, storage bootstrap, TUI change or receipt export change is implemented here. The URL carries the prototype palette and reloads it; OS-driven Auto and flash-free startup belong to the implementation spec.

Rai chose neutral white and brass for Register & Receipt Light during this session. Palette acceptance is still pending.

![All seven palettes, in picker order](palettes/comparison.png)

## Mapping proposals

Register & Receipt Dark keeps warm ink and the exact brass accent. Dim text and cache misses are brighter to satisfy the accepted small-text contract. Register & Receipt Light uses neutral white/gray surfaces, dark ink, dark brass and an olive-yellow Haiku slot to separate it from brass.

One Dark Pro and GitHub use their blue action family. Catppuccin uses mauve actions. Money warmth in the spend ladder uses orange/peach for the alternatives; yellow stays available for Haiku. Providers map Claude to purple, Codex to blue, OpenCode to green, Cursor to yellow, Pi to red, unknown to muted. Model slots keep Opus purple, Sonnet blue, Haiku yellow and other muted across themes. The prototype exposes those slots; the production stable family/hash resolver remains implementation work.

The dashboard subsidisation panel follows the web palette. Exported receipts retain the original fixed-brand token source. Raw cream colours remain available to fixed-brand consumers, but do not tint the proposed neutral Light dashboard.

## Upstream sources and adaptations

Starting colours were verified against [One Dark Pro](https://github.com/Binaryify/OneDark-Pro/blob/master/themes/OneDark-Pro.json), [Catppuccin](https://github.com/catppuccin/palette/blob/main/palette.json), and the [GitHub theme mappings](https://github.com/primer/github-vscode-theme/blob/main/src/theme.js) plus [explicit overrides](https://github.com/primer/github-vscode-theme/blob/main/src/colors.js). These are semantic adaptations, not exact editor theme reproductions. Concrete source is `src/lib/brand/prototype-palettes.ts`.

Small labels share categorical colours, so all proposed readable roles are held to 4.5:1 against all four fill surfaces, stronger than the 3:1 graphical-indicator minimum. One Dark purple/red/orange and muted text are lifted. GitHub light blue/purple/green and Latte mauve/blue/green/red/yellow/peach are darkened. GitHub Dark uses brighter blue/purple/red/orange relatives. Surfaces and borders are composed for dashboard density. Decorative borders are excluded from text contrast.

| Palette | Lowest semantic contrast | Accent/Haiku OKLab distance |
| --- | ---: | ---: |
| Register & Receipt Dark | 5.22 | 0.093 |
| Register & Receipt Light | 5.11 | 0.090 |
| One Dark Pro | 4.89 | 0.236 |
| GitHub Dark | 5.99 | 0.292 |
| GitHub Light | 4.59 | 0.285 |
| Catppuccin Mocha | 5.43 | 0.223 |
| Catppuccin Latte | 4.60 | 0.323 |

## Validation

`pnpm exec vitest run src/lib/brand/contrast.test.ts src/lib/components/prototype-data.test.ts`: 81 tests passed. The existing contrast test now parameterises the seven palettes; the first run correctly rejected insufficient One Dark, GitHub Light and Latte contrast and insufficient Light brass/Haiku separation. Those values were corrected. Existing fixed-brand checks still pass.

`pnpm check`: zero errors and warnings. `pnpm build:sk`: passed, with the existing adapter warning about external `node:sqlite`.

Browser checked all seven palettes at 1440×1000 and 390×700, plus 560×560, without horizontal overflow. Checked palette select, keyboard cycling, URL reload, three Account views, cold scan, session detail, Explore search and return to dashboard. Screenshots include the neutral Light desktop and Latte phone. These checks establish a runnable comparison, not production acceptance.

Two inherited Svelte warnings reproduce on the unmodified dashboard prototype at port 5192 as well: NumberFlow hydration mismatch and TanStack proxy equality in the Explore journey. No runtime errors were observed. Mechanical design scan reported existing thick-border and chart size-transition warnings; palette-only work leaves those layout decisions intact.
