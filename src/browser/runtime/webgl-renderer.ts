/**
 * Reads the GPU renderer string the page runs on, for the InitReport and
 * the fingerprint (ADR 0006 decisions 4 and 5). The html lane has no
 * context of its own, so it probes a throwaway canvas that is never
 * attached to the document, WebGL2 first, then WebGL, and releases the
 * context afterwards; a lane that draws with WebGL (three, M4) hands its
 * own context to `rendererStringOf` instead, so the report names the
 * context that actually renders.
 */

/** The unmasked renderer string of a context (UNMASKED_RENDERER_WEBGL), or the masked RENDERER when the extension is missing. */
export function rendererStringOf(context: WebGLRenderingContext | WebGL2RenderingContext): string {
  const info = context.getExtension('WEBGL_debug_renderer_info');
  const parameter = info === null ? context.RENDERER : info.UNMASKED_RENDERER_WEBGL;
  const renderer: unknown = context.getParameter(parameter);
  return typeof renderer === 'string' ? renderer : String(renderer);
}

/** The unmasked WebGL renderer string from a probe canvas, or null when the page has no WebGL context at all. */
export function readWebglRenderer(root: Document): string | null {
  const canvas = root.createElement('canvas');
  const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (context === null) return null;
  const renderer = rendererStringOf(context);
  // Chromium caps live contexts per page and only frees a dropped one at GC, so a repeated init must not accumulate them.
  context.getExtension('WEBGL_lose_context')?.loseContext();
  return renderer;
}
