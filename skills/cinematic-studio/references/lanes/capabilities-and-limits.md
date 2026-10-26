# Lanes: capabilities and limits

Three ways to make a frame. Pick per shot; mix plates across lanes when each does one thing best (type from html over an environment from three or blender). Costs are the owner's RTX 2060 machine as measured; CI uses software rendering with relaxed thresholds.

| | `html` | `three` | `blender` |
| --- | --- | --- | --- |
| Renders | typography, lower thirds, kinetic type, charts, 2.5D explainer stages, flat illustration | stylized and procedural 3D: abstract environments, light grids, bokeh fields, simple products with PBR materials, data in 3D | near-photoreal objects: products with glass, liquid, brushed metal; studio sets with soft shadows and HDRI reflections |
| Camera | 2.5D: CSS perspective from the shared lens, parallax layers, no true orbit | the full shared camera: every move in camera-moves.md | the full shared camera, with true depth of field and motion blur |
| Light | gradients and shadows that follow the rig's key direction | RectAreaLight softboxes, a shadow-casting key, PMREM or HDRI environment | area lights with soft shadows, HDRI world, EEVEE or Cycles |
| Materials | CSS surfaces: flat, gradient, glass-like blur | MeshPhysicalMaterial: clearcoat, transmission, anisotropy; believable at a distance | Principled BSDF: glass, liquid, metal, plastic, paper at macro distance |
| Text | native, crisp, the best of the three | textured text; avoid, composite html instead | extruded text for logos; composite html for everything else |
| Determinism | byte-identical on the same machine and fingerprint | same, hardware renderer; software renderer differs slightly | per engine and backend; pinned at the still gate |
| Cost per 1080p frame | about 50 ms (screenshot) | about 50 ms plus render; expect 100 to 300 ms with SSAA and bloom on the RTX 2060 | EEVEE 1 to 3 s; Cycles OptiX 5 to 15 s; Cycles CPU minutes |
| Needs | Edge or Chrome, ffmpeg | the same plus WebGL2 on a GPU (software works, slower) | Blender 5.2 LTS, an interactive session for EEVEE, ffmpeg |
| Still gate iteration | seconds | seconds | minutes; use low-resolution previews first |

## Choosing a lane

- Text as the subject: `html`.
- An explainer: `html` (2.5D stage) with optional `three` atmosphere behind it.
- A product shot: `blender` for the hero and macro details; `three` when Blender is absent or for a quick look pass; the product name and labels from `html` on top.
- A title sequence: `three` for the environment and the light sweep, `html` for the type, composited at assembly.
- A chart or a data story: `html`.
- Anything that needs people, animals, fluids, cloth, fire, or a real place: none; see direction/steering-table.md.

## Compositing across lanes

A shot may declare plates: background (three or blender), midground (three atmosphere) and text (html with alpha). Picture plates are graded together; the text plate is overlaid after the grade so contrast and legibility are measured on the real pixels (ADR 0008).

## Limits to state up front

- No photoreal people, faces or animals; no live-action look.
- Byte identity holds on one machine with one browser, driver and settings; across machines the gate is SSIM.
- The three lane on a software renderer is slower and slightly different; `doctor` reports which one is in use.
- EEVEE needs an interactive desktop session; otherwise the blender lane falls back to Cycles at the still gate and stays there.
- 4K video is a long render on a 6 GB GPU; 4K is for stills unless the time estimate is accepted.
