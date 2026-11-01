// WebGL2 context creation and loss handling (avatar-renderer req 1.2, 2.1, 2.3).
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

/** Calls `onLost` once, on the first `webglcontextlost`; returns the unsubscribe. */
export function watchContextLoss(canvas: CanvasHost, onLost: () => void): () => void {
  let done = false;
  const listener = (): void => {
    if (done) return;
    done = true;
    canvas.removeEventListener("webglcontextlost", listener);
    onLost();
  };
  canvas.addEventListener("webglcontextlost", listener);
  return () => {
    done = true;
    canvas.removeEventListener("webglcontextlost", listener);
  };
}
