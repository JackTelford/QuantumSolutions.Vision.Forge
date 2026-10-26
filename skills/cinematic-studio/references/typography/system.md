# Typography system

Type is the one thing a code-rendered film does better than a generated one, so it is set like print. Four bundled families (OFL, shipped with the skill), one modular scale, numeric sizes, and six animations with fixed timing.

## Families and pairings

| `FontFamily` | Role | Character | Weights used |
| --- | --- | --- | --- |
| `inter` | body, captions, UI, corporate titles | neutral grotesque, excellent at small sizes | 300, 400, 600, 800 |
| `space-grotesk` | tech and product display | geometric, slightly quirky | 500, 700 |
| `playfair-display` | editorial and luxury display | high-contrast serif | 400, 700 |
| `jetbrains-mono` | labels, statistics, counters | tabular figures, code feel | 400, 700 |

| Genre | Display | Body |
| --- | --- | --- |
| tech, product | `space-grotesk` | `inter` |
| editorial, luxury, fragrance | `playfair-display` | `inter` |
| corporate, explainer | `inter` 800 | `inter` 400 |
| data, dashboards | `inter` | `jetbrains-mono` for numbers |

Never Segoe UI, Arial or a system default: they differ per machine and read as unstyled.

## Scale and sizes at 1080p

Modular scale ratio `scaleRatio` from the look bible: 1.25 (explainers, calm) or 1.333 (titles, dynamic). Base body size 32 px.

| Role | Size (1.25) | Size (1.333) | Tracking | Case |
| --- | --- | --- | --- | --- |
| `title` | 120 to 160 px | 140 to 180 px | −0.02 em | as written |
| `subtitle` | 56 px | 64 px | 0 | as written |
| `body` | 32 px | 32 px | 0 | as written |
| `caption` | 26 to 30 px | 26 to 30 px | 0 | as written |
| `label` | 24 to 28 px | 24 to 28 px | +0.08 em when all caps | all caps allowed |
| `lower-third-name` | 44 px | 48 px | −0.01 em | as written |
| `lower-third-title` | 28 px | 30 px | +0.06 em | all caps |
| `counter` | 96 to 140 px | 96 to 140 px | tabular figures | digits |

At 4K multiply by 2. Line height 1.1 for titles, 1.35 for body, 1.25 for captions. Maximum 42 characters per line for titles and subtitles, 60 for captions, 3 lines per card; one idea per card.

## Colour and contrast

- Text colour is the look's `palette.text`; on a surface card, `palette.text` on `palette.surface`. Both pairs are validated at 4.5:1 or better in the look bible.
- Over picture, text sits on a scrim: a 60 percent `palette.background` box with 24 px padding, or a vertical gradient from transparent to 70 percent at the bottom for lower thirds. The contrast check measures the finished frame behind the box, not the scrim's theory.

## Animations

Each preset has a fixed duration and easing; `staggerMs` applies per word or line where noted. Timing is in frames at 30 fps in the templates and scales with the fps.

| `TextAnimation` | Motion | Duration | Easing | Notes |
| --- | --- | --- | --- | --- |
| `none` | appears on `inFrame` | — | — | for captions timed to narration |
| `fade-rise` | opacity 0 to 1, translateY 24 px to 0 | 450 ms | `emphasized-decelerate` | the default for titles and subtitles |
| `blur-in` | opacity 0 to 1, blur 8 px to 0 | 500 ms | `standard-decelerate` | atmospheric titles |
| `mask-wipe` | clip-path reveals along the reading direction | 600 ms | `emphasized` | logos and single lines |
| `tracking-in` | letter-spacing 0.3 em to final | 800 ms | `emphasized-decelerate` | title sequences, all caps |
| `stagger-words` | each word `fade-rise`, `staggerMs` 60 to 80 apart | 450 ms per word | `emphasized-decelerate` | taglines, lists |
| `counter` | tabular digits count from 0 to the value | 1200 ms | `standard-decelerate` | statistics; hold 2 s after |

Exit animations mirror the entrance at two thirds of the duration with `standard-accelerate`. Text leaves before the cut, never through it, unless the transition is a dissolve.

## Rules

1. One typographic voice per film: one display family, one body family.
2. Hierarchy by size and weight, not by colour; the accent colour marks at most one word per card.
3. No text animates while the camera makes its dominant move; text enters on a hold or during `breathe`.
4. Numbers use tabular figures (`jetbrains-mono` or `inter` with `font-variant-numeric: tabular-nums`) so counters do not jitter.
5. Every text element has an `inFrame` and an `outFrame` (or null for "until the cut") and the reading hold from composition/rules.md between them.
