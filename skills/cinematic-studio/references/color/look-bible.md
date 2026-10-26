# Look bible

A look is a set of tokens every lane reads: palette, typography, a default lighting rig, a motion family, a tone-mapping choice, a grade and a QA exposure range. Seven looks ship; `custom` starts from one of them and changes tokens. One look per film.

## The seven looks

| `LookPreset` | Palette (background / surface / primary / accent / text / highlight) | Type (display + body, scale) | Lighting | Motion | Tone map | Grade | QA YAVG |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `studio-clean` | #f4f4f2 / #ffffff / #1a1a1a / #2a6df4 / #1a1a1a / #ffffff | inter 800 + inter, 1.25 | `product-studio` | calm | standard | neutral, contrast 1.02, vignette 0.08, grain 0 | 170 to 200 |
| `obsidian` | #0b0b0d / #15161a / #e8e4dc / #c9a24a / #f2efe8 / #ffffff | space-grotesk + inter, 1.333 | `low-key` | cinematic | agx | warm lift +0.02 r, cool gain, saturation 0.95, vignette 0.3, grain 0.15, halation 0.2 | 30 to 60 |
| `warm-editorial` | #f3ead9 / #faf5ea / #2b2118 / #b5532a / #2b2118 / #fff8ec | playfair-display + inter, 1.25 | `window` | calm | agx | warm gain, saturation 1.05, contrast 1.05, vignette 0.15, grain 0.08 | 140 to 170 |
| `neon-tech` | #070b1a / #0f1630 / #e6f0ff / #39e6ff / #e6f0ff / #ff3ec9 | space-grotesk + inter, 1.333 | `neon-rim` | snappy | agx | cool shadows, split tone cyan/magenta 0.3, saturation 1.15, bloom via emission 0.3, vignette 0.2, grain 0.1 | 40 to 80 |
| `paper-flat` | #fbfaf6 / #ffffff / #1f2937 / #ef7d3b / #1f2937 / #ffffff | inter 800 + inter, 1.25 | `soft-cross` | snappy | standard | none: lift 0, gamma 1, gain 1, saturation 1, grain 0, vignette 0 | 150 to 190 |
| `noir-title` | #000000 / #0a0a0a / #f5f5f5 / #c8c8c8 / #f5f5f5 / #ffffff | playfair-display + inter, 1.333 | `split` or `contre-jour` | cinematic | agx | contrast 1.15 around 0.4, saturation 0.6, vignette 0.35, grain 0.25, halation 0.25 | 20 to 50 |
| `sunset-gradient` | #2b1d3a / #3a2650 / #ffe9d6 / #ff9a5c / #fff3e8 / #ffd7b0 | space-grotesk + inter, 1.25 | `golden-hour` | calm | agx | warm highlights, split tone orange/violet 0.35, saturation 1.1, vignette 0.2, grain 0.1 | 100 to 140 |

Every palette pair used for text (text on background, text on surface) passes WCAG 4.5:1; the validator checks it.

## Grade tokens

| Token | Range | Meaning |
| --- | --- | --- |
| `lift.r/g/b` | −1 to 1 | offset of the shadows per channel (ASC CDL offset) |
| `gamma.r/g/b` | 0 to 4 | midtone power per channel (CDL power) |
| `gain.r/g/b` | 0 to 4 | multiplier per channel (CDL slope) |
| `saturation` | 0 to 2 | around Rec.709 luma; 1 is neutral |
| `contrast`, `contrastPivot` | 0 to 2, 0 to 1 | contrast around a pivot luma; 1 and 0.5 are neutral |
| `splitTone.*` | hue 0 to 360, amount 0 to 1 | a tint for shadows and another for highlights |
| `vignetteAmount`, `vignetteSoftness` | 0 to 1 | darkening toward the corners and how gradually it starts |
| `grainAmount`, `grainSeed` | 0 to 1, integer | seeded film grain, applied only at assembly |
| `halationAmount` | 0 to 1 | a soft bloom around bright edges (3D lanes) |

The grade is baked into a 33³ `.cube` file by the finishing module and applied identically to every lane's frames; the html text plates are overlaid after it (ADR 0008).

## Tone mapping

- `agx` for photographic looks in both 3D lanes: compresses highlights gracefully, desaturates saturated colours. Brand-critical surfaces (a logo colour) use the unlit "graphic" material path so they are not shifted.
- `standard` for graphic looks and everything the html lane composites: display-referred, colours as written.
- Never mix tone maps between shots of one film.

## Choosing and customising

1. Pick the look by use case and emotion: products on dark premium → `obsidian`; bright and clean → `studio-clean`; editorial → `warm-editorial`; tech → `neon-tech`; explainers → `paper-flat`; documentary titles → `noir-title`; warmth and nostalgia → `sunset-gradient`.
2. A `custom` look changes the palette to the brand's colours first, then at most two other tokens. Re-validate contrast.
3. The look's exposure (`exposureEv`) and the rig's calibration scalars together decide the YAVG range; the QA check measures every shot against it.
4. Fonts and colours from the user override the preset; say which tokens changed in the treatment.
