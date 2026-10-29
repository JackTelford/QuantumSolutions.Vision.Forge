# Camera moves

Every move is a parametric camera path over the shot's normalized time, evaluated per frame by the shared camera module, so the html, three and blender lanes produce identical motion. Restraint is the signature of direction: the caps below are hard limits in the validator, and one shot has one dominant move.

## The catalogue

Amplitude is the move's size relative to its cap: `amplitude: 1` is the cap, `0.5` is half. `easing` defaults per move as listed; `sine-in-out` for drifts, `emphasized` for pushes, `linear` only for the turntable.

| Preset | What the camera does | Cap at amplitude 1 | Default easing | Lanes | Use cases |
| --- | --- | --- | --- | --- | --- |
| `static-hold` | nothing | — | — | all | any; the default for reading text |
| `breathe` | a slow drift toward the subject and back | 0.5 % of the distance | `sine-in-out` | all | holds that must not feel frozen |
| `push-in` | dolly toward the subject | 15 % of the distance | `emphasized` | all | reveals, emphasis |
| `pull-out` | dolly away from the subject | 15 % of the distance | `emphasized` | all | endings, context |
| `truck-left` / `truck-right` | lateral slide, subject stays framed | 10 % of the subject width | `sine-in-out` | all | parallax over layered stages |
| `pedestal-up` / `pedestal-down` | vertical slide | 10 % of the subject height | `sine-in-out` | all | reveals of tall subjects |
| `pan-left` / `pan-right` | rotate about the vertical axis | 10 degrees | `sine-in-out` | three, blender | surveying a setting |
| `tilt-up` / `tilt-down` | rotate about the horizontal axis | 10 degrees | `sine-in-out` | three, blender | reveals from the ground up |
| `arc-left` / `arc-right` | orbit around the subject at constant distance | 60 degrees | `sine-in-out` | three, blender | hero shots |
| `turntable` | the subject rotates, the camera holds | 40 degrees of subject rotation | `linear` | three, blender | product detail passes |
| `crane-reveal` | pedestal up while tilting down to keep the subject | 12 % of the subject height; the tilt is whatever keeps the subject on its anchor | `emphasized-decelerate` | three, blender | openings |
| `rack-focus` | focus distance travels from one point to another; no movement | the distance between the two focus points | `emphasized` | three, blender | detail to label, foreground to subject |
| `zoom-in` / `zoom-out` | focal length changes, camera holds | 1.5 times the focal length | `emphasized` | all | slow emphasis only |
| `crash-zoom` | a fast zoom with a hard stop | 2 times the focal length over at most 8 frames | `emphasized-accelerate` | html, three | titles and stingers only |
| `dolly-zoom` | focal length and distance change together so the subject keeps its size | 1.5 times the focal length | `sine-in-out` | three, blender | one per film, hero only |
| `whip-pan` | a fast pan that blurs into the next shot | 45 degrees over 6 to 10 frames | `emphasized-accelerate` | html, three | transitions only |
| `handheld` | seeded noise on position and rotation | 0.4 % of the distance, 0.5 degrees | — | three, blender | never on a product hero; atmosphere only |
| `parallax-drift` | layers slide at depth-dependent speeds | 6 % of the stage width | `sine-in-out` | html | 2.5D explainers and titles |
| `light-sweep` | the camera holds; the key light orbits | 90 degrees of light orbit | `sine-in-out` | three, blender | title reveals, material shows |
| `top-down-reveal` | pedestal down from overhead to eye level | 90 degrees of tilt | `emphasized-decelerate` | three, blender | openings over a flat-lay |

## Rules

1. One dominant move per shot. A secondary move (for example `breathe` under a `rack-focus`) must have amplitude 0.25 or less; the validator rejects more.
2. Moves start and end with zero velocity except `turntable` (constant) and the transition moves (`whip-pan`, `crash-zoom`), which end at the cut.
3. `arc` moves that cover 360 degrees loop without a pop: the camera module guarantees the first and last frames coincide. (With the 60-degree cap a full loop is not expressible through a shot spec today; the bake is time-exact, so a looping window would close seamlessly once a loop count exists.)
4. `handheld` is deterministic: the noise is seeded by the shot's `seed`; the same seed gives the same shake on every render.
5. `dolly-zoom` once per film, `crash-zoom` and `whip-pan` only in title sequences and stingers, `dutch` roll only with `static-hold` or `breathe`.
6. The move's `startFrame` and `endFrame` bound it inside the shot; a move shorter than the shot holds still before and after, so a 3-second push can sit inside a 5-second shot.

## Mapping Higgsfield names (the user may use them)

| Said | Means | Preset |
| --- | --- | --- |
| dolly in, push in | move toward | `push-in` |
| dolly out, pull back | move away | `pull-out` |
| arc, orbit, 360 orbit | circle the subject | `arc-left` or `arc-right` (360 only on a turntable subject) |
| crash zoom | fast zoom with a hard stop | `crash-zoom` |
| dolly zoom, vertigo | background stretches while the subject holds | `dolly-zoom` |
| crane, jib, boom | vertical move with a tilt | `crane-reveal` |
| whip pan | fast pan into the cut | `whip-pan` |
| focus change, rack focus | focus travels | `rack-focus` |
| FPV, drone, hyperlapse, bullet time, snorricam, robo arm | moves that need a world or a body | not supported; say so and offer `arc`, `crane-reveal` or `parallax-drift` over an abstract environment |
