# Pacing and transitions

Rhythm is direction. Shot lengths follow the brief's tempo or the narration's sentence boundaries, transitions follow a grammar, and the validator enforces the arithmetic: the delivery is the sum of the shots minus the sum of the overlaps.

## Tempo to shot length

| `Tempo` | Average shot length | Range | Use |
| --- | --- | --- | --- |
| `calm` | 5 s | 4 to 7 s | product heroes, luxury, atmosphere |
| `dynamic` | 2.75 s | 2 to 3.5 s | product detail passes, explainers |
| `chaotic` | 1.1 s | 0.8 to 1.5 s | title stingers only; never on a product |
| `single-shot` | the whole film | — | one continuous move with internal beats |

## Beat templates

**Product film, 12 to 20 s, calm or dynamic**

| Beat | Size | Move | Length |
| --- | --- | --- | --- |
| establish | `LS` or `FS` | slow `push-in` | 2 to 3 s |
| detail A | `ECU` | `rack-focus` | 2 to 3 s |
| detail B | `CU` | `light-sweep` or `turntable` | 2 to 3 s |
| hero | `MS` | `arc-left` 30 degrees, name on screen | 4 to 6 s |
| end card | `MS` hold | `breathe` | 2 to 3 s |

**Explainer, 30 to 60 s, narrated**

| Beat | Content | Length |
| --- | --- | --- |
| hook | the question in one line | 3 to 5 s |
| problem | what goes wrong, one diagram | 5 to 8 s |
| steps | three to five, one diagram each | 5 to 8 s each |
| payoff | the result, the diagram resolved | 5 s |
| call to action | one line, one card | 3 s |

Shot durations come from the narration: each sentence's audio length plus the reading hold of any on-screen text, snapped to whole frames. Cuts land on sentence boundaries; on-screen text leads the voice by 6 to 10 frames.

**Title sequence, 10 to 15 s**

| Beat | Content | Length |
| --- | --- | --- |
| atmosphere in | the environment alone, `ELS`, slow drift | 2 to 3 s |
| reveal | `light-sweep` across the title, `tracking-in` | 3 to 4 s |
| tagline | `stagger-words` | 2 to 3 s |
| out | `fade-black` | 1 to 2 s |

## Transition grammar

| `TransitionType` | Frames at 30 fps | When |
| --- | --- | --- |
| `cut` | 0 | the default; between any two shots of the same scene |
| `dissolve` | 12 to 20 | between two calm shots of related content; time passing |
| `fade-black` | 20 to 30 | chapter changes, the end |
| `fade-white` | 12 to 20 | a reveal into brightness; once per film at most |
| `wipe-left` / `wipe-right` / `wipe-up` / `wipe-down` | 10 to 15 | explainers only, along the reading or motion direction |
| `slide-left` / `slide-right` | 10 to 15 | explainers only, between sibling cards |

Rules:

1. A transition is no longer than either neighbour; the validator rejects longer ones.
2. No two non-cut transitions in a row on shots shorter than 2 s.
3. A product film has at most one dissolve and ends on a fade-black or a hold; a title sequence ends on a fade-black.
4. Transitions never cross a change of lighting rig without being a fade-black.
5. The total length is `sum(shots) − sum(overlaps)`; the planner adjusts the last hold, never the hero, to hit the brief's duration.

## Timing text to narration

For narrated pieces the audio exists before shot durations are locked (ADR 0007). Each sentence becomes a named time event; a shot starts on an event and lasts until the next one plus any reading hold; captions appear 6 to 10 frames before the sentence and leave 6 frames after it ends. Silence between sentences is a hold on the current shot, never a cut.
