// The character on the stage: a built cast pack (/packs/<id>.srpack from apps/web/public) read by
// @sr/pack and drawn by @sr/avatar/core's React-free player, at 1920x1080 and DPR 1. The page
// drives its frames (renderFrame), so the recording composites exactly what was drawn.
import { createAvatarPlayer, type AvatarPlayer } from "@sr/avatar/core";
import { decodePackImages, loadPack, packErrorSentence } from "@sr/pack";

export const STAGE_W = 1920;
export const STAGE_H = 1080;

export async function loadCharacter(canvas: HTMLCanvasElement, id: string, seed: number, forceMotion: boolean): Promise<AvatarPlayer> {
  const result = await loadPack(`/packs/${encodeURIComponent(id)}.srpack`);
  if (!result.ok) throw new Error(`Character "${id}": ${packErrorSentence(result.error)}`);
  const assets = await decodePackImages(result.pack.files);
  const { rig, look } = result.pack;
  const player = createAvatarPlayer(canvas, {
    rig,
    look,
    assets,
    seed,
    autoSize: false,
    reducedMotion: forceMotion ? false : "auto",
  });
  player.resize(STAGE_W, STAGE_H, 1);
  return player;
}

/** Which backend renders WebGL here: "gpu", "swiftshader", or "canvas2d" when WebGL2 is absent. */
export function detectBackend(): string {
  const probe = document.createElement("canvas");
  const gl = probe.getContext("webgl2");
  if (gl === null) return "canvas2d";
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = info === null ? String(gl.getParameter(gl.RENDERER)) : String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return /swiftshader|software|llvmpipe/i.test(renderer) ? "swiftshader" : "gpu";
}
