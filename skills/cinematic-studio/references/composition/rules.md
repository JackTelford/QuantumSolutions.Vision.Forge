# Composition rules

Composition is arithmetic before it is taste. The solver places the camera so the subject lands on the chosen anchor at the chosen size, keeps text inside the title-safe area and reports every violation before any vision review. The rules below are the numbers it uses.

## Grids and anchors

| `composition.anchor` | Where the subject's anchor point lands (fractions of width, height) | Use |
| --- | --- | --- |
| `center` | 0.5, 0.5 | symmetry, heroes with the name below, charts |
| `thirds-left` | 0.333, 0.5 | subject left, text right |
| `thirds-right` | 0.667, 0.5 | subject right, text left |
| `thirds-top` | 0.5, 0.333 | low horizons, text below |
| `thirds-bottom` | 0.5, 0.667 | sky and atmosphere above |
| `golden-left` | 0.382, 0.5 | a softer offset than thirds |
| `golden-right` | 0.618, 0.5 | the same, mirrored |

The subject's anchor point is the centre of its bounding box for products and diagrams, the baseline centre for a text subject. Tolerance: the projected anchor must land within 4 percent of the frame width of the grid point.

## Safe areas

| Area | Fraction of the frame | Holds |
| --- | --- | --- |
| Action safe | central 93 percent (3.5 percent margin) | the subject, every meaningful picture element |
| Title safe | central 90 percent (5 percent margin) | every text box, logos, lower thirds |

Source: EBU R95 / SMPTE ST 2046-1 for 16:9 HD. A text box is `{ x, y, w, h }` in fractions of the frame; the validator rejects a box outside 0.05 to 0.95 on either axis.

## Headroom, lead room, balance

- Headroom: 8 to 12 percent of the frame height above the subject for `MS` and `CU`; `ECU` has none.
- Lead room: 15 to 30 percent of the frame width on the side the subject faces or moves toward.
- Text side: text sits opposite the subject's anchor (`textSide` right when the anchor is `thirds-left`). Text never overlaps the subject's action-safe box; the solver reports overlap as a failure.
- Visual weight: one dominant element per frame. A second element is at most a third of the dominant one's area, or it becomes a competing subject.

## Size to distance

Given the subject's height `h` in metres, the target fraction `f` from the shot size table (shot-grammar.md) and the vertical field of view `vfov` of the lens:

```
distance = h / (f · 2 · tan(vfov / 2))
```

The camera sits on a sphere of that radius around the subject's anchor at the angle's azimuth and elevation, looks at the anchor, then shifts its look-at target so the anchor projects onto the grid point. Focus distance equals `distance` unless a rack focus sets two points.

## Text

| Rule | Value |
| --- | --- |
| Minimum text height at 1080p | 24 px (captions and labels); 32 px for body; 72 px and up for titles |
| Maximum characters per line | 42 for titles and subtitles, 60 for captions |
| Maximum lines per card | 3 |
| Contrast behind every text box | WCAG ratio 4.5:1 or higher, measured on the finished frame |
| Reading hold | words × 0.3 s + 0.8 s; statistics and numbers at least 2 s |
| Orphans | no single word on the last line; balance line breaks |

## Checks the solver runs on every still

1. Subject bounding box inside action safe.
2. Anchor within tolerance of the grid point.
3. Every text box inside title safe and not overlapping the subject box.
4. Headroom in range for the size.
5. Text height at or above the floor for its role.
6. Contrast ratio behind each text box at or above 4.5:1 (from the finished frame, after the grade, before grain).
7. Average luma inside the look's QA range.

A still that fails any of these is not shown to the vision review; it is fixed first.
