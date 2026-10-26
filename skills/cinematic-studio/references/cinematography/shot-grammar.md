# Shot grammar

How a shot is described in a shot spec: size, angle, and what each choice says. Every value here is a real parameter the lanes consume; nothing is a prompt hint. Sizes are measured against the subject's height as a fraction of the frame height (the composition solver turns the fraction into a camera distance for the chosen lens).

## Shot sizes

| Size | Subject height as a fraction of frame height | What it says | Product alias | Typical lens |
| --- | --- | --- | --- | --- |
| `ECU` | 1.5 to 2.5 (the frame is inside the subject) | texture, material, a single detail | macro | 100 mm, f/2.8 |
| `CU` | 0.7 to 0.9 | the subject fills the frame; intimacy | detail | 85 mm, f/2.8 |
| `MCU` | 0.55 to 0.7 | subject plus a little context | feature | 85 mm, f/4 |
| `MS` | 0.4 to 0.55 | the subject in its setting; the default hero | hero | 85 mm, f/4 |
| `MLS` | 0.3 to 0.4 | subject and surroundings in balance | staged | 50 mm, f/5.6 |
| `FS` | 0.25 to 0.3 | the whole subject with air around it | full | 50 mm, f/5.6 |
| `LS` | 0.15 to 0.25 | the setting dominates | context | 35 mm, f/8 |
| `ELS` | under 0.15 | the setting is the subject; establishing | establishing | 24 mm, f/8 |

Rules of thumb:

- A film of 12 to 20 seconds uses three sizes at most. Jumping between adjacent sizes (MS to MCU) reads as a continuity error; skip a size when cutting on the same subject (MS to CU).
- A product film opens on `LS` or `FS`, spends its middle on `ECU` and `CU`, and ends on `MS` for the hero with the name on screen.
- A title sequence lives in `ELS` and `LS` of an abstract environment, with text as the subject.
- An explainer is a 2.5D stage: sizes describe the diagram, not a physical object; `MS` for a diagram with labels, `CU` for one element being explained.

## Camera angles

| Angle | Camera height and tilt | What it says | Use |
| --- | --- | --- | --- |
| `eye` | at the subject's centre, level | neutral, honest | the default for products and diagrams |
| `low` | below the subject's centre, tilted up 10 to 20 degrees | stature, monumentality | hero reveals, titles |
| `high` | above the subject's centre, tilted down 15 to 30 degrees | overview, inspection | detail passes, explainer layouts |
| `overhead` | straight down | pattern, layout, flat-lay | product arrangements, charts |
| `ground` | at the ground plane, level | drama, scale | atmosphere plates behind titles |
| `dutch` | eye level with roll of 5 to 15 degrees (`dutchDegrees`) | unease, energy | one shot per film at most, never on a product hero |

## Headroom and lead room

- Headroom (space above the subject) is 8 to 12 percent of the frame height for `MS` and `CU`; `ECU` has none; `LS` and wider have as much as the composition anchor needs.
- Lead room (space in the direction the subject faces or moves) is 15 to 30 percent of the frame width when the subject has a direction; products on a turntable have none.
- Both are solver inputs (`composition.headroomPct`, `composition.leadRoomPct`), not aesthetic suggestions.

## Writing a shot

A shot line in a treatment reads: size, subject, angle, lens, move, light, duration. Example:

> `CU` of the bottle's cap, `high` 20 degrees, 100 mm f/2.8, `rack-focus` from the label to the cap over 2 s, `product-studio` with a cool rim, 75 frames.

Every word in that line maps to a field of the shot spec. If a word has no field, it is not a direction, it is a wish.
