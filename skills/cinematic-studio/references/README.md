# Knowledge base outline

The creative knowledge base behind `skills/cinematic-studio/SKILL.md`. Each file is read only when a step needs it; `SKILL.md` names the file to open. The values in these files are real parameters of the shot spec and the look bible (the vocabulary in `schemas/vocabulary.json`), with sources in `docs/research.md` and calibrations in `docs/evidence/`. A file marked "calibrated in" gets its numeric scalars refined when that milestone measures them; the tables exist now.

| File | Content | Status |
| --- | --- | --- |
| `cinematography/shot-grammar.md` | Shot sizes (ECU to ELS) as fractions of the frame, angles and what each says, headroom and lead room, how a shot line is written | written |
| `cinematography/camera-moves.md` | The 26 named moves with caps, default easing, lanes and use cases; the one-dominant-move rule; Higgsfield names mapped | written; implemented in M2 |
| `cinematography/lens-and-exposure.md` | Focal lengths and fields of view on the 36 mm camera model, f-stops and depth of field, shutter angle, exposure and tone mapping, defaults per use case | written |
| `lighting/cookbook.md` | Sixteen numeric rigs (azimuth, elevation, size, Kelvin, ratios) with per-lane mappings and which looks they suit | written; scalars calibrated in M4 |
| `composition/rules.md` | Anchors, EBU R95 safe areas, headroom and lead room, size-to-distance formula, text rules, the seven solver checks | written; solver in M2 |
| `typography/system.md` | The four bundled OFL families and pairings, the modular scale and sizes at 1080p, contrast and scrims, six animations with timing | written; fonts bundled in M3 |
| `motion/easing-grammar.md` | The thirteen easing tokens with definitions, duration table, timeline combinators, the motion rules | written; timeline in M2 |
| `editing/pacing-and-transitions.md` | Tempo to shot length, beat templates for the three use cases, the transition grammar, narration as the clock | written |
| `color/look-bible.md` | The seven looks with palettes, type, lighting, grade tokens and QA ranges; tone-mapping choice; customising | written; lookdev swatches in M4 |
| `direction/treatment-template.md` | The questionnaire that fills the brief, the one-page treatment, the shot list, the still gate, the pre-render checklist | written |
| `direction/steering-table.md` | What code-only rendering cannot do and the substitution to propose, per request | written |
| `direction/review-rubric.md` | The measurable checks that run first, the ten-item vision rubric with the three-faults rule, how a review is written | written; revised against the blind test in M7 |
| `lanes/capabilities-and-limits.md` | What each lane renders, its camera, light, materials, determinism and cost; choosing and compositing lanes; the limits to state | written; costs measured in M3 to M5 |
| `lanes/blender-notes.md` | The attempt ladder, the scene.json contract, operating rules and how to read failures | written; verified in M5 |
