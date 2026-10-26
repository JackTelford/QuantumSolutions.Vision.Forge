# Steering table

What code-only rendering does badly, what it does well, and the substitution to propose before any render. The treatment names the substitution it chose; the user hears it up front, not after the first contact sheet.

| The brief asks for | Why it fails here | Propose instead | Lane |
| --- | --- | --- | --- |
| a person using the product, hands, faces | no photoreal people (constraint and capability); hands read as uncanny | the product on stage with its use implied by UI overlays, motion lines or a reflected light sweep | three, blender |
| a city at night, a skyline | environments need assets and GI; cheap ones read as a game | a bokeh field, a light grid in haze, an abstract skyline silhouette | three |
| nature, forests, mountains, water | foliage and water need simulation | a gradient backdrop with layered silhouettes, or an abstract terrain in wireframe | three, html |
| liquid pouring, splashes, fizz | fluid simulation is out of scope | the liquid static in glass with a caustic-shaped highlight and a slow `rack-focus` | blender |
| smoke, fire, fog | volumetrics cost minutes per frame and fail on Cycles fallback | a 2D haze plate graded at finishing, or three fog, plus an emissive gradient | three, finishing |
| a photoreal phone, laptop, screen | device bodies need exact models | a rounded slab with the user's screenshot as an emissive screen, macro framing, `rack-focus` | blender, three |
| fabric, hair, fur | no cloth or hair simulation | paper, card, metal or glass as the material; say so | blender |
| hand-drawn, illustrated, sketchy | no brush rendering | a geometric flat style with stroke draw-on animations (`mask-wipe`) | html |
| a drone flying over a landscape | no world, no FPV | a `crane-reveal` or `parallax-drift` over an abstract terrain | three |
| bullet time, orbit around a person | no person | `arc-left` 60 degrees around the product or the title | three, blender |
| a logo animation | needs the vector | the user's SVG extruded (blender) or mask-revealed (html); never a redrawn logo | blender, html |
| live-action footage, b-roll | no footage; nothing is generated | a stylized sequence that states the same idea; ask for the user's footage as a `video` clip in the assembly plan | assemble |
| realistic text in a scene (signage) | fine | the html lane renders the type and composites it over the three or blender plate | html over three |
| music | no allowlisted source | silence, or the user's own track in the plan | assemble |
| narration | fine, English only | the local voice model (installed on request) or the user's recording | audio |

## How to use it

1. Scan the brief for every noun in the left column before writing the treatment.
2. Put each substitution in the treatment's `substitutions` list as `{ requested, substitute, reason }`.
3. Say the limits in one sentence to the user before rendering anything; offer the substitute as a strength ("macro framing on real glass and metal") rather than an apology.
4. If a substitution changes the piece's point, ask the one clarifying question allowed, then proceed.
