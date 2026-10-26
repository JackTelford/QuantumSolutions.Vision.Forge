# Blender lane notes

Blender 5.2 LTS only, installed by the user (winget on Windows), discovered by `doctor`, driven by a fully resolved `scene.json` that TypeScript writes and one logic-free Python file applies. Everything below is the operating knowledge Claude needs to plan a Blender shot; ADR 0004 holds the decisions and their evidence.

## Engines and the attempt ladder

| Attempt | Engine | Backend | Needs | Look | Cost per 1080p frame |
| --- | --- | --- | --- | --- | --- |
| 1 | EEVEE | OpenGL | an interactive desktop session and a GPU | real-time: soft shadows, screen-space effects, fast | 1 to 3 s |
| 2 | EEVEE | Vulkan | the same; a second chance when OpenGL fails | the same, with small differences | 1 to 3 s |
| 3 | Cycles | OptiX (NVIDIA RTX) | a CUDA-capable GPU; no window needed | path traced: true glass, caustic-like highlights, physically correct | 5 to 15 s with denoising |
| 4 | Cycles | CUDA | an NVIDIA GPU | the same | a little slower |
| 5 | Cycles | CPU | nothing | the same | minutes; stills only |

The ladder runs once, inside `still`. The winning profile is written into the shot spec and into the shot hash; `render` refuses to change engines mid-shot. A Blender shot that no engine can render is re-planned to the three lane before its still is approved. 4K hero stills go to Cycles OptiX with denoising.

## What scene.json can express

- Primitives: bottle (revolved profile), can, box, slab, card, pill, jar, sphere, cylinder, torus; user glTF models imported with `bpy.ops.import_scene.gltf` (never `.blend`, which can carry scripts).
- Materials: Principled BSDF with base colour, metallic, roughness, specular, clearcoat, transmission (glass), IOR, anisotropy, emission; a "graphic" unlit path for brand-critical colours.
- Lights: area lights with shape, size, power, colour temperature, from the lighting cookbook; the world as a bundled CC0 HDRI with a strength and rotation.
- Sets: seamless cyclorama, gradient backdrop plane, glossy floor.
- Camera: the shared model per frame (position, quaternion, lens, 36 mm sensor, f-stop, focus distance, shutter angle), baked as keyframes with linear interpolation.
- Render: engine, backend, samples, denoiser, resolution, frame range, PNG 8 or 16 bit, AgX or Standard view transform, exposure.

Not in the contract: volumetrics (haze is a 2D plate at finishing), simulations, hair, cloth, custom node trees authored per shot.

## Operating rules

1. `doctor` first; the lane exists only when it reports `lanes.blender: true`, which needs a 5.2.x Blender and ffmpeg.
2. The estimator renders three frames before a long render and projects the total; anything over 60 seconds is confirmed with the user.
3. Success is judged from the files: every expected PNG exists and is not black, and no new crash log appeared. Exit code 0 alone proves nothing.
4. Frames are rendered in resumable batches; a crash resumes at the first missing frame under the same shot hash.
5. Use low-resolution previews (480x270, few samples) to iterate on composition and light, then one full-resolution still, then motion.
6. Never ask the user to change Blender preferences; the runner isolates them with `BLENDER_USER_RESOURCES` and `--factory-startup`.

## Reading failures

| Message | Meaning | Do |
| --- | --- | --- |
| Blender was not found | not installed or not 5.2 | run the setup script or install 5.2.3 by hand; continue with html and three |
| Cannot initialize the GPU | no OpenGL or Vulkan context (no interactive session) | the ladder moves to Cycles; say the render will be slower |
| the still is black | a material, light or world problem, or the GPU context failed silently | the runner retries the ladder; if all fail, re-plan the shot |
| crash log written at teardown after all frames exist | a known 5.2.3 teardown crash | treated as success when every frame is present and newer than the launch |
| the estimate exceeds the budget | the shot is too expensive | lower samples, switch to EEVEE, shorten the shot or move it to three |
