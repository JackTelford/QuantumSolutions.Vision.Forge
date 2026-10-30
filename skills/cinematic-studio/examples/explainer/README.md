# Example: the explainer

The second shipped example: the four documents and the narration script the skill wrote for the explainer brief of `docs/blind-test.md`, exactly as they stood when the delivery was made, and the commands that turned them into the delivery recorded in `docs/evidence/explainer/`.

## The prompt

> A 45-second narrated explainer that teaches what a content hash is and why it makes renders resumable. Clean, friendly, diagram-led. Captions on screen.

## The documents

| File | What it holds |
| --- | --- |
| `narration-script.txt` | seven sentences, one per beat, 42.5 s of speech by the local voice `af_heart`; written first, because the sentence timings are the clock of the piece |
| `brief.json` | the questionnaire filled from the prompt: explainer, 45 s, 1080p30, dynamic, clear, the `card` primitive on a paper stage, narration enabled with the script, no music, the four limits acknowledged (typographic diagrams, burnt-in captions, the local voice, no music) |
| `treatment.json` | the logline, seven beats on the html lane whose lengths come from the sentences, three substitutions (diagram-led, captions on screen, a narrator), four risks, `narrationFirst: true` |
| `shot-spec.json` | seven html shots, one per sentence, each starting eight frames before its sentence (140 + 165 + 186 + 212 + 219 + 191 + 237 = 1350 frames, all cuts); 50 mm f/5.6 at eye level, a `breathe` move, the `soft-cross` rig, `thirds-right` with the text on the left; the words, numbers, hash rows and file names of each card as text elements |
| `look.json` | the `paper-flat` preset unchanged: Inter 800 over Inter, standard tone mapping, no grade, the QA band 170 to 225 |

## The commands

Every command runs through `node scripts/cli.ts <command> --data-dir <data> --out <out>`; `docs/evidence/explainer/README.md` records each one with its timing and result.

```
doctor
audio install --yes                         (once per machine, on the user's yes)
audio synth --script narration-script.txt --voice af_heart --fps 30 --out <scratch>
                                            (to read the sentence timings before the shot spec is written)
plan --brief brief.json --treatment treatment.json --shot-spec shot-spec.json --look look.json
audio synth --script narration-script.txt --voice af_heart --fps 30 --out <out>/<jobId>
still --job <out>/<jobId> --shot s01        (and s02 to s07; at most three rounds each)
sheet --frames <out>/<jobId>/stills
still --job <out>/<jobId> --shot s01 --approve   (and s02 to s07)
render --job <out>/<jobId>
assemble --job <out>/<jobId> --burn-in
qa --job <out>/<jobId>
sheet --video <out>/<jobId>/<jobId>.mp4 --every 15
```

The narration is synthesized twice: once into a scratch folder to learn the sentence frames the shot durations are built from, and once into the job folder after `plan`, where `assemble --job` finds it. The two runs produce the same WAV, SRT and timings (the voice is deterministic on one machine).

The job id is the content hash of the four documents, so a still-loop edit plans into a new job folder. The documents here are those of the fourth planning round: the third produced the delivery, and a review then found two sentences in the treatment's risks that still described earlier rounds (the old exposure band, a white card). Correcting the prose changed no shot, so the fourth `plan` reused every rendered frame and `assemble --job` wrote a byte-identical delivery (job `62fedd4e`, recorded in `docs/evidence/explainer/`).
