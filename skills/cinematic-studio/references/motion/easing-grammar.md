# Motion and easing grammar

Every lane reads the same timeline: a value is a function of the frame number, computed once in shared TypeScript. Easing tokens name curves with fixed definitions; durations come from a table, not from taste per shot. Consistent curves across every element are the invisible signature of a motion designer.

## Easing tokens

| `EasingToken` | Definition | Feels like | Use |
| --- | --- | --- | --- |
| `linear` | t | mechanical | turntables, counters' digits, nothing else |
| `ease` | cubic-bezier(0.25, 0.1, 0.25, 1) | gentle | legacy CSS feel; avoid |
| `ease-in` | cubic-bezier(0.42, 0, 1, 1) | departs slowly | exits |
| `ease-out` | cubic-bezier(0, 0, 0.58, 1) | arrives slowly | entrances |
| `ease-in-out` | cubic-bezier(0.42, 0, 0.58, 1) | symmetric | generic |
| `standard` | cubic-bezier(0.2, 0, 0, 1) | Material 3 standard | UI-like elements, charts |
| `standard-decelerate` | cubic-bezier(0, 0, 0, 1) | arrives and settles | entrances of small elements |
| `standard-accelerate` | cubic-bezier(0.3, 0, 1, 1) | leaves quickly | exits |
| `emphasized` | cubic-bezier(0.2, 0, 0, 1) with a longer duration | Material 3 emphasized | hero moves, full-screen changes |
| `emphasized-decelerate` | cubic-bezier(0.05, 0.7, 0.1, 1) | dramatic arrival | titles, reveals |
| `emphasized-accelerate` | cubic-bezier(0.3, 0, 0.8, 0.15) | dramatic departure | whip pans, crash zooms, exits |
| `sine-in-out` | 0.5 − cos(πt) / 2 | breathing | camera drifts, holds |
| `spring` | mass 1, stiffness 100, damping ratio 0.75, overshoot capped at 4 percent | physical | small UI elements, never cameras or titles |

Sources: CSS Easing Level 1 for the keywords; Material 3 motion tokens for the standard and emphasized families (the emphasized-decelerate values follow the Android token set). The spring is one canonical form (mass, stiffness, damping ratio); overshoot above 4 percent is clamped so nothing wobbles.

## Durations

| Element | Duration | Example |
| --- | --- | --- |
| small (icons, labels, highlights) | 150 to 250 ms | a label fading in |
| medium (cards, lower thirds, diagram nodes) | 300 to 400 ms | a lower third rising |
| full-screen (titles, scene changes, charts building) | 450 to 600 ms | a title's `fade-rise` |
| camera | the whole shot, or the move's `startFrame` to `endFrame` | a 4-second push-in |
| stagger between siblings | 40 to 80 ms | words of a tagline |

Nothing except the camera animates for longer than 600 ms. Overlap entrances by 30 percent of their duration; never queue three things that each wait for the previous to finish.

## Timeline combinators (shared TypeScript)

| Function | Meaning |
| --- | --- |
| `interpolate(frame, [in0, in1], [out0, out1], { easing, extrapolate })` | the core: maps a frame range to a value range through an easing; `extrapolate` is `clamp` (default), `extend` or `identity` |
| `spring(frame, { from, to, startFrame })` | the canonical spring |
| `sequence([a, b, c], gapFrames)` | runs segments one after another |
| `stagger(items, perItemFrames, offsetFrames)` | the same animation on many items, offset in time |
| `delay(frames)` | a hold |
| `loop(segment, times)` | repeats (turntables, breathing) |
| `event(name)` | a named time (a narration sentence boundary) other segments can start from |

The timeline is evaluated per frame; it never knows the wall clock. `render(frame)` in a template asks the timeline for every value it sets.

## Rules

1. One dominant motion per shot (the camera, or the headline); everything else is secondary and at most a quarter of its amplitude.
2. Entrances decelerate, exits accelerate. A thing that arrives at the same speed it left feels like a loop.
3. Camera curves are `sine-in-out` for drifts and `emphasized` for pushes; cameras never spring.
4. Elastic overshoot above 4 percent, bounce, and typewriter reveals are not available; they read as cheap.
5. Motion follows reading direction: left to right, top to bottom; wipes and pushes move with it.
6. Nothing animates during the last 10 frames before a cut except an exit that completes at the cut.
