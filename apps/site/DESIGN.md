---
name: Chaching Register & Receipt
description: Warm register surfaces, brass controls and real product receipts.
colors:
  ink: "#0e0d0b"
  paper: "#f4efe4"
  muted: "#9a9080"
  brass: "#eba92c"
  line: "#4a443b"
  surface: "#131210"
typography:
  display:
    fontFamily: "Space Grotesk, sans-serif"
    fontSize: "clamp(60px, 5.6vw, 86px)"
    fontWeight: 700
    lineHeight: 0.98
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Space Grotesk, sans-serif"
    fontSize: "clamp(40px, 4.4vw, 66px)"
    fontWeight: 700
    lineHeight: 1.06
    letterSpacing: "-0.035em"
  body:
    fontFamily: "Space Grotesk, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.6
  command:
    fontFamily: "JetBrains Mono, monospace"
    fontSize: "clamp(22px, 2.15vw, 33px)"
    fontWeight: 400
    letterSpacing: "-0.035em"
  nav:
    fontFamily: "Space Grotesk, sans-serif"
    fontSize: "15px"
    fontWeight: 400
rounded:
  panel: "12px"
  control: "13px"
spacing:
  pair-gap: "16px"
  gutter-wide: "52px"
  gutter-medium: "24px"
  gutter-small: "20px"
components:
  install:
    backgroundColor: "transparent"
    textColor: "{colors.brass}"
    typography: "{typography.command}"
    rounded: "{rounded.control}"
    padding: "10px 25px"
  install-hover:
    backgroundColor: "{colors.brass}"
    textColor: "{colors.ink}"
  navigation:
    textColor: "{colors.paper}"
    typography: "{typography.nav}"
  text-link:
    textColor: "{colors.brass}"
  product-window:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.panel}"
    padding: "15px"
  code-block:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.paper}"
    rounded: "{rounded.panel}"
    padding: "24px"
---

# Design System: Chaching Register & Receipt

## Overview

**Creative North Star: "Register & Receipt"**

The public site extends Chaching’s established Register & Receipt identity: warm ink, brass controls, off-white type and cream thermal receipts. Strong display type carries the gallows humour; quiet borders and generous spacing give real product evidence room to speak.

The existing Chaching! lockup stays unchanged. Space Grotesk and JetBrains Mono are self-hosted from the bundled product fonts. Production dashboard and receipt imagery retains its renderer’s palette and uses fictional fixture data.

**Key Characteristics:**
- Warm register surfaces and brass interaction cues.
- Large, tightly set headlines with readable supporting copy.
- Real product captures and tactile receipt paper.

## Colors

The palette is warm and low-key, with brass making commands and links easy to find.

### Primary

Brass is the interaction accent and occasional headline emphasis. Hover and copied command states fill with brass and switch to ink text.

### Neutral

Ink is the page and product-frame background. Paper carries primary text; muted carries supporting prose, captions and metadata. Line defines fine dividers and frames. Surface provides a subtle raised tone for local-data sections and documentation code blocks. Cream receipt colours belong to the production image renderer, not a marketing override.

The normative source is `packages/shared/src/brand/tokens.ts`; `public/brand.css` exposes the site’s shared-brand subset. Receipt styling comes from `packages/receipt/src/receipt/assets.ts`. Frontmatter records the implemented values from `public/brand.css`; update it when the source changes.

## Typography

Space Grotesk supplies display, body and navigation text with bundled regular and bold faces. JetBrains Mono supplies commands and code with its bundled regular face. Both load locally with `font-display: swap`.

Display headings use tight tracking and near-solid leading. Section headings retain the same voice at a smaller scale. General paragraphs stop at 70ch; feature prose is 20px and stops at 48ch on wide screens. Command text stays prominent enough to be the main action. Documentation uses smaller monospace text in scrollable blocks.

## Layout

The shared container caps at 1536px with wide, medium and small gutters from the spacing tokens. Breakpoints are 900px and 600px. Wide layouts use paired columns, reducing gaps at the middle breakpoint and stacking at the narrow breakpoint. Touch navigation and text links have a minimum 44px height.

The approved homepage statement composition is recorded in `.impeccable/surfaces/index-html.md`, with its approved reference in `.impeccable/mocks/statement.png`. Its terminal and browser dashboard occupy equal columns on desktop and stack on mobile. This is a surface decision, not a required composition for every page. Documentation uses a narrower 1040px container and horizontally scrollable code and tables.

## Elevation & Depth

Most depth comes from surface tone and thin warm borders. Product frames remain flat. Receipt images use a slight rotation and a soft black drop shadow to suggest paper: the hero uses `drop-shadow(0 10px 18px #0004)` and Wrapped uses `drop-shadow(0 12px 24px #0005)`.

The hero receipt rises 28px and changes from 3 to 1 degree on hover or keyboard focus, using a 0.55s `cubic-bezier(.16,1,.3,1)` transform. Reduced motion disables transitions and leaves the receipt at its resting angle; the terminal video is replaced by its screenshot. Command colour transitions take 0.18s.

## Shapes

Product frames and code blocks use the panel radius; install controls use the slightly softer control radius. Fine one-pixel borders and section rules define grouping. Keep receipt silhouettes inside the real rendered imagery.

## Components

The install control combines a muted shell prompt, a monospace command and an inline copy icon. Its brass outline becomes a brass fill on hover and after copying; a visible status message reports the outcome. The hero control is at least 62px tall on wide screens and 60px on small screens.

Navigation is plain text with generous hit areas and optional small inline icons. Feature links use brass, a trailing arrow and an underline on hover. All keyboard focus indicators use a 2px brass outline offset by 5px.

Product windows pair a bold caption with actual dashboard or terminal media, preserving the full image with `object-fit: contain`. The monthly Wrapped recap uses the real receipt renderer. Documentation code blocks use the secondary surface, warm border and overflow scrolling. No input or chip primitive is implemented on this surface.

## Do's and Don'ts

- Do inherit the shared Register & Receipt tokens and bundled fonts.
- Do use actual production renderers with fictional data for product evidence.
- Do retain visible keyboard focus, readable text and reduced-motion alternatives.
- Don't redraw the dashboard or terminal as marketing evidence.
- Don't recolour the existing wordmark or production receipts.
- Don't describe the implemented monthly Wrapped recap as yearly.
