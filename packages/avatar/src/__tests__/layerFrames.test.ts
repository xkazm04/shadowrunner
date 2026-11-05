// @vitest-environment happy-dom
// player.layerFrames() (spark llm-avatar-lab, lip arms): where each layer was drawn by the last
// frame, read-only. It must equal the renderer's own placement for the poses it was handed, follow
// the jaw as it opens, and change nothing about what is drawn.
import { defaultLook, type LayerPose, type Look } from "@sr/rig";
import { afterEach, describe, expect, it } from "vitest";
import { runPlayer, type RendererFactory } from "../player/run.js";
import { fitView, layerAffine, lookLight } from "../render/frame.js";
import type { Renderer } from "../render/types.js";
import { fakeAssets, malakorRig } from "./malakor.js";

const rig = malakorRig();
const assets = fakeAssets(rig);
const look: Look = defaultLook(rig);

function recordingRenderer(): { factory: RendererFactory; draws: { poses: LayerPose[]; look: Look }[] } {
  const draws: { poses: LayerPose[]; look: Look }[] = [];
  const renderer: Renderer = {
    setRig: () => undefined,
    setLook: () => undefined,
    draw: (poses, l) => {
      draws.push({ poses, look: l });
    },
    resize: () => undefined,
    info: () => ({ mode: "2d", drawCalls: 0, textureUploads: 0 }),
    dispose: () => undefined,
  };
  return { factory: () => renderer, draws };
}

function canvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 640;
  c.height = 360;
  return c;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("player.layerFrames", () => {
  it("is empty before the first frame and after dispose", () => {
    const { factory } = recordingRenderer();
    const player = runPlayer(canvas(), { rig, look, assets, autoSize: false, reducedMotion: false }, factory);
    expect(player.layerFrames?.()).toEqual([]);
    player.renderFrame(0.016);
    expect(player.layerFrames?.().length).toBeGreaterThan(0);
    player.dispose();
    expect(player.layerFrames?.()).toEqual([]);
  });

  it("equals the renderer's placement of every pose it was handed", () => {
    const { factory, draws } = recordingRenderer();
    const c = canvas();
    const player = runPlayer(c, { rig, look, assets, autoSize: false, reducedMotion: false }, factory);
    player.renderFrame(0.25);
    const frames = player.layerFrames?.() ?? [];
    const last = draws.at(-1);
    expect(last).toBeDefined();
    const view = fitView(rig, c.width, c.height);
    const { browY } = lookLight(rig, last?.look ?? look);
    expect(frames.map((f) => f.layer.name)).toEqual(last?.poses.map((p) => p.name));
    for (const [i, pose] of (last?.poses ?? []).entries()) {
      const layer = rig.layers.find((l) => l.name === pose.name);
      expect(layer).toBeDefined();
      if (layer === undefined) continue;
      expect(frames[i]?.affine).toEqual(layerAffine(layer, pose, view, browY));
      expect(frames[i]?.opacity).toBe(pose.opacity);
    }
  });

  it("moves the jaw down as the level opens it, and reading it draws nothing", () => {
    const { factory, draws } = recordingRenderer();
    const player = runPlayer(canvas(), { rig, look, assets, autoSize: false, reducedMotion: false }, factory);
    // The jaw relative to the layer it follows, so the idle bob does not count.
    const jawY = (): number => {
      const frames = player.layerFrames?.() ?? [];
      const jaw = frames.find((f) => f.layer.kind === "jaw");
      const parent = frames.find((f) => f.layer.name === jaw?.layer.follow);
      expect(jaw).toBeDefined();
      return (jaw?.affine[5] ?? 0) - (parent?.affine[5] ?? 0);
    };
    player.setLevel(0);
    for (let i = 0; i < 20; i += 1) player.renderFrame(0.05);
    const closed = jawY();
    player.setLevel(1);
    for (let i = 0; i < 20; i += 1) player.renderFrame(0.05);
    const drawsBefore = draws.length;
    const open = jawY();
    player.layerFrames?.();
    expect(draws.length).toBe(drawsBefore);
    expect(open).toBeGreaterThan(closed);
  });
});
