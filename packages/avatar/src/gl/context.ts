// WebGL2 context creation, loss and restore handling (avatar-renderer req 1.2, 2.1, 2.3;
// perfection-pass P1).
import type { CanvasHost } from "../render/types.js";

/** Transparent, premultiplied canvas (req 1.2). Antialiasing is off: layers draw into an FBO. */
export const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: false,
  depth: false,
  stencil: false,
};

/** A WebGL2 context for `canvas`, or null when it returns none or throws (req 2.1). */
export function createGlContext(canvas: CanvasHost): WebGL2RenderingContext | null {
  try {
    const gl = canvas.getContext("webgl2", CONTEXT_ATTRIBUTES);
    return gl !== null && !gl.isContextLost() ? gl : null;
  } catch {
    return null;
  }
}

/**
 * Calls `onLost` on each `webglcontextlost` and `onRestored` on the `webglcontextrestored` that
 * follows it (perfection-pass P1), until the returned unsubscribe. The loss event's default is
 * prevented: that is what asks the browser to restore the context at all.
 */
export function watchContext(canvas: CanvasHost, onLost: () => void, onRestored: () => void): () => void {
  let lost = false;
  let done = false;
  const lostListener = (event: Event): void => {
    event.preventDefault();
    if (done || lost) return;
    lost = true;
    onLost();
  };
  const restoredListener = (): void => {
    if (done || !lost) return;
    lost = false;
    onRestored();
  };
  canvas.addEventListener("webglcontextlost", lostListener);
  canvas.addEventListener("webglcontextrestored", restoredListener);
  return () => {
    done = true;
    canvas.removeEventListener("webglcontextlost", lostListener);
    canvas.removeEventListener("webglcontextrestored", restoredListener);
  };
}
