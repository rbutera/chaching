# Themes

Settings → Appearance → Theme selects Auto or one of seven complete palettes: Register & Receipt Dark/Light, One Dark Pro, GitHub Dark/Light, and Catppuccin Mocha/Latte. Auto follows the system between Register & Receipt Dark and Light. Explicit choices stay fixed. Preferences are stored per browser in `chaching.theme.v1`; invalid or unavailable storage falls back to Auto. A failed save leaves the previous choice selected and reports the problem.

Claude is orange, Codex blue and Pi purple. Cursor, OpenCode and unknown providers are neutral. Models use their observed provider colour; a model aggregated across different providers is neutral. Labels distinguish models sharing a colour. Warnings use yellow indicators with readable warning ink. The emblem follows the accent and the wordmark follows the text colour.

The interactive terminal queries its mode and actual foreground, background and 16 ANSI colours once, before Ink starts. Mode and palette discovery each have a 400ms timeout. Usable terminal colours take precedence; semantic colours retain their hues and readable contrast, including terminals whose bright slots are gray. Missing colours fall back to Register & Receipt using reported mode, then COLORFGBG, then dark. Keyboard input is retained and raw mode/listeners are restored before Ink takes ownership.

`CHACHING_THEME=auto|light|dark` controls the TUI. Explicit light/dark uses the built-in fallback palette without terminal queries. Invalid values act as Auto. Piped commands and NO_COLOR never wait for a terminal response. There is no terminal picker.

Receipt/ Wrapped PNGs, the cream terminal receipt, OG images and favicons retain their fixed brand colours. The web paper scope remains separate from global theme identity.

Palette values live in `packages/shared/src/brand/palettes.ts`, based on the accepted prototype at `6ed4497`. Fixed-brand consumers still use `tokens.ts`. Regenerate web CSS and its early bootstrap with `pnpm --dir apps/web exec tsx scripts/regen-appcss.ts`; tests verify both artifacts against their sources.

Terminal query reference: [Contour colour-scheme reporting](https://contour-terminal.org/vt-extensions/color-palette-update-notifications/). Palette selection follows the inspected Tokenmaxx approach without introducing its renderer or changing terminal receipt output.
