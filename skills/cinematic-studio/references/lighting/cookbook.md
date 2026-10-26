# Lighting cookbook

Each rig is a set of numbers that every lane maps to its own lights. Azimuth is measured around the subject from the camera (0 degrees is behind the camera, 90 is camera-right, 180 is behind the subject); elevation is above the subject's centre. Size is the light's diameter in metres at one metre of subject height; the solver scales it with the subject. Intensity is relative to the rig's key; the calibration scene (M4) sets the per-lane scalars so an 18 percent gray card reads the same YAVG in every lane.

## The rigs

| Preset | Key (az / el / size / Kelvin) | Fill ratio (key:fill) | Rim (az / el / size / Kelvin / intensity) | Backdrop | What it says | Looks it suits |
| --- | --- | --- | --- | --- | --- | --- |
| `product-studio` | 45 / 35 / 1.2 / 5600 | 1:3 | 135 / 50 / 0.6 / 6500 / 0.6 | seamless cyc, gradient | clean, commercial | studio-clean, warm-editorial |
| `three-point-soft` | 45 / 35 / 1.0 / 5600 | 1:4 | 135 / 50 / 0.5 / 5600 / 0.5 | any | the neutral default | all |
| `rembrandt` | 45 / 45 / 0.6 / 5000 | 1:8 | 150 / 40 / 0.4 / 5600 / 0.4 | dark | sculpted, serious | obsidian, noir-title |
| `butterfly` | 0 / 50 / 1.0 / 5600 | 1:3 (from below) | none | light | glamour, symmetry | studio-clean |
| `split` | 90 / 20 / 0.5 / 5000 | 1:16 | none | dark | drama, halves | noir-title, obsidian |
| `rim-only` | none | — | 135 and 225 / 45 / 0.6 / 6500 / 1.0 | black | silhouette, edge | noir-title, neon-tech |
| `contre-jour` | none | 1:6 ambient | 180 / 30 / 2.0 / 5600 / 1.0 | haze | backlit glow, atmosphere | sunset-gradient, noir-title |
| `window` | 60 / 30 / 2.0 / 4800 | 1:3 warm fill at 3200 | none | warm wall | daylight through glass | warm-editorial |
| `soft-cross` | 60 / 30 / 1.0 / 5600 and 300 / 30 / 1.0 / 5600 at 1:1 | — | none | mid | even, informational | paper-flat, explainers |
| `high-key` | 30 / 40 / 2.0 / 6000 | 1:1.5, plus 1 EV overall | 180 / 60 / 2.0 / 6500 / 0.4 | white cyc | bright, optimistic | studio-clean, paper-flat |
| `low-key` | 60 / 40 / 0.5 / 4500 | 1:12 | 160 / 45 / 0.3 / 5600 / 0.6 | black | moody, premium | obsidian, noir-title |
| `golden-hour` | 100 / 12 / 1.5 / 3200 | 1:4 at 8000 (sky) | 170 / 20 / 1.0 / 3000 / 0.8 | warm gradient | warmth, nostalgia | sunset-gradient, warm-editorial |
| `overcast-soft` | 0 / 70 / 4.0 / 6500 | 1:1.2 | none | gray cyc | neutral, honest | paper-flat, studio-clean |
| `neon-night` | 70 / 25 / 0.3 / 2200 (magenta tint) | 1:6 at 12000 (cyan) | 250 / 30 / 0.3 / 12000 (cyan) / 1.0 | dark, wet-look floor | synthetic, night | neon-tech |
| `practical-glow` | the subject's own emissive surface | 1:10 ambient | none | dark | the product is the light | neon-tech, obsidian |
| `neon-rim` | 30 / 30 / 0.4 / 5600 at 0.5 | 1:8 | 120 / 40 / 0.3 / magenta 1.0 and 240 / 40 / 0.3 / cyan 1.0 | black | edge-lit, graphic | neon-tech |

Per-shot overrides: `keyIntensity` (1 = the rig's own), `fillRatio`, `rimIntensity`, `kelvin` on the key. Change one at a time; the rig stays recognisable.

## Per-lane mapping

| Lane | Key / fill / rim | Environment | Shadows |
| --- | --- | --- | --- |
| blender | area lights, `shape = 'RECTANGLE'`, size and `size_y` from the rig, power in watts = intensity × calibration scalar, colour from Kelvin via blackbody | world HDRI (bundled studio HDRI at the rig's Kelvin) at the rig's ambient strength | soft shadows on, `shadow_soft_size` from the light size |
| three | `RectAreaLight` per softbox (PBR materials only, no shadows) plus one `DirectionalLight` shadow caster aligned with the key, `RectAreaLightUniformsLib.init()` first | PMREM from the bundled HDRI or `RoomEnvironment`, `environmentIntensity` from the rig | PCF shadow map from the key's directional light |
| html | a background gradient whose angle follows the key azimuth, `box-shadow` offset opposite the key, a specular sheen gradient on cards | — | — |

## Choosing a rig

- Products: `product-studio` by default; `low-key` or `rembrandt` for premium dark looks; `neon-rim` for tech.
- Explainers: `soft-cross` or `overcast-soft`; the diagram is the subject, light must not compete.
- Titles: `rim-only`, `contre-jour` or `neon-night` on an abstract environment; the type plate from the html lane is unlit and stays crisp on top.
- Continuity: one rig per film, with per-shot overrides only. A rig change is a chapter change and gets a `fade-black`.
