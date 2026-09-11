# Design system

## Logo colour

In the chaching lockup, only the Till Stack emblem uses the theme accent. The outlined “Chaching!” wordmark uses the theme's main text colour, `--text`, in every light and dark palette. A `BrandMark` colour override applies only to the emblem; it must not recolour the wordmark.

The standalone emblem uses the accent. Keep the existing paths, proportions and spacing. Fixed-brand exports choose colours from their fixed default theme, with the same emblem/wordmark separation.

This rule was specified by Rai during the palette prototype review. The implementation reference is `src/lib/components/ds/BrandMark.svelte`.
