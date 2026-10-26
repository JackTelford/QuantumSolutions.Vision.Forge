# Treatment template

Decisions are made on paper before any render. The brief is normalized into a `brief` document, the treatment is written as a `treatment` document, and only then is the shot list (`shot-spec`) built. Each step is reviewable by a reader who never opens a render file.

## Step 1: the director's questionnaire (fills the `brief`)

Answer every line from the user's words; where the prompt is silent, choose the default, write it down, and say it once to the user. Ask at most one clarifying question, and only when two readings would produce materially different films.

| Field | From the prompt or the default |
| --- | --- |
| `useCase` | product-shot, explainer, title-sequence, lower-third, kinetic-type, chart, still, custom |
| `goal` | the one sentence the viewer should take away |
| `audience` | who watches and where (a landing page, a trade show screen, a social feed) |
| `durationSeconds` | the prompt's number; defaults: product 15, explainer 45, title 12, lower-third 6 |
| `aspect`, `fps`, `width`, `height` | 16:9, 30, 1920x1080 unless the prompt says otherwise; 4K for stills |
| `tempo` | calm for premium and luxury, dynamic for tech and explainers, chaotic only for stingers, single-shot when the prompt says "one take" |
| `emotion` | one word: confident, warm, precise, playful, grave |
| `genre`, `era` | when the prompt implies a world (documentary, sci-fi, 1970s print) |
| `paletteHints`, `mustHaveText` | colours and words the user named; brand text is never paraphrased |
| `subject` | what is on screen: kind, primitive, assets the user supplied |
| `narration` | on by default for explainers, off for products and titles; the local voice or the user's recording |
| `music` | none, or the user's own file |
| `limitsAcknowledged` | every line of the steering table that applies, written as the substitution chosen |

## Step 2: the treatment (one page)

```
Logline: <one sentence: what we see and what it says>
Look: <LookPreset> because <reason tied to the emotion and audience>; changed tokens: <none | list>
Lighting: <preset> ; Lens family: <two focal lengths> ; Motion family: <calm | snappy | cinematic>
Beats:
  1. <title> — <intent> — <duration s> — <lane> — shots <ids>
  2. ...
Substitutions: <requested> → <substitute> (<reason>)      (one line per steering-table hit)
Narration: <first | none> ; Music: <none | user file>
Risks: <what may not look right and what we do then>
```

The treatment is approved before stills when the piece is a judged one; otherwise it is written, stated in two sentences to the user, and the work proceeds.

## Step 3: the shot list

One row per shot, straight into `shot-spec.shots`:

| id | beat | size | angle | lens | f-stop | move | light | text | frames |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| s01 | establish | LS | eye | 50 | 5.6 | push-in 0.6 | product-studio | — | 75 |

Checks before `validate`: sizes follow shot-grammar.md, moves obey camera-moves.md caps and legality, one dominant move per shot, text follows typography/system.md and composition/rules.md, transitions follow editing/pacing-and-transitions.md, total length equals the brief within one second.

## Step 4: the still gate

Render one still per shot, tile the contact sheet, run the measurable checks, then the rubric (direction/review-rubric.md). Fix and re-render only the failing shots. Motion renders start when every shot passes.

## Pre-render checklist

- One look, one lighting rig, one display family.
- Every shot has one dominant move and its text enters on a hold.
- Every text box is inside title safe and has a reading hold.
- Every substitution from the steering table is in the treatment and was said to the user.
- The frame count and the time estimate were stated, and a render over 60 seconds was confirmed.
