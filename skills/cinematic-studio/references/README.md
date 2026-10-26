# Knowledge base outline

The creative knowledge base behind `skills/cinematic-studio/SKILL.md`. Each file is read only when a step needs it; `SKILL.md` names the file to open. Every value in these files must come from a cited source or a measured calibration (see `docs/research.md` and `docs/evidence/`), never from taste alone. Nothing below exists yet; the milestone column says when each file is written.

| File | Content | Filled in |
| --- | --- | --- |
| `cinematography/shot-grammar.md` | Shot sizes (ECU to ELS), angles (eye, low, high, dutch, overhead) and what each says; the vocabulary `plan` uses in a shot list | M2 |
| `cinematography/camera-moves.md` | Named moves (dolly, truck, pedestal, crane, arc, zoom, dolly zoom, whip pan, rack focus): path, speed, easing and when each is used; parameters of the baked camera | M2 |
| `cinematography/lens-and-exposure.md` | Focal length, f-stop, focus distance, shutter angle and exposure offset on the shared 36 mm camera model; how each lane maps them (ADR 0008) | M4 |
| `lighting/cookbook.md` | Named setups (three-point, Rembrandt, butterfly, split, high and low key, studio product): positions, ratios, color temperature; per-lane intensity scalars from the calibration scene | M4 |
| `composition/rules.md` | Framing, balance, headroom, lead room, EBU R95 safe areas, the composition solver's inputs and outputs | M3 |
| `typography/system.md` | Type scale, the bundled OFL fonts, WCAG 2.2 contrast minimums, line length, kerning and the html lane's text rules | M3 |
| `motion/easing-grammar.md` | Easing tokens (CSS and Material 3 curves), duration ranges, stagger and overlap rules, the shared timeline vocabulary | M3 |
| `editing/pacing-and-transitions.md` | Shot duration by purpose, cut rhythm, the 58 xfade transitions and when to use none, narration as the clock of an explainer | M6 |
| `color/look-bible.md` | Named looks, tone-mapping tokens (`agx`, `standard`), the 33-point LUT per look, grain and vignette budgets, BT.709 delivery | M4 |
| `direction/treatment-template.md` | The treatment document every job starts from: intent, audience, duration, lanes, look, risks, the one clarifying question | M2 |
| `direction/steering-table.md` | How user adjectives (genre, era, tempo, emotion, palette) map to camera, light, motion and grade parameters; calibrated against the blind test | M7 |
| `direction/review-rubric.md` | What to check on a still and a contact sheet before approving: exposure, focus, framing, legibility, continuity, artifacts; revised against the blind test in M7 | M3 |
| `lanes/capabilities-and-limits.md` | What `html`, `three` and `blender` can and cannot render, cost per frame, and how to pick a lane for a shot; extended as each lane lands | M3 |
| `lanes/blender-notes.md` | Engines and the attempt ladder (EEVEE OpenGL, EEVEE Vulkan, Cycles OptiX, CUDA, CPU), exit codes, the crash log, the applier's `scene.json` contract (ADR 0004) | M5 |
