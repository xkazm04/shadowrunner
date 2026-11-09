// Depth turn and lighting (perfection-pass V2, gl/turn.ts) against the counting GL stub: facing
// front, with no turn in the clock, or with warp 0 and light 0 at any yaw, the frame's GL call log is
// exactly the one without a turn (today's frame, call for call); turned, every layer on the head is
// drawn as the shared grid with its shift and the body as the plain quad, eyes and irises take no
// light, an iris bends as its eye's point under it; the next front frame zeroes the shift once and
// then issues nothing. The frame body hands the pose's turn to the renderer.
import { defaultLook, poseLayers, turnHead, YAW_LIMIT_DEG, type Drive, type Look, type Rig } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { createRenderer } from "../gl/renderer.js";
import { TURN_GRID_VERTICES, TURN_SHIFT_X } from "../gl/turn.js";
import { createFrameBody } from "../player/frame.js";
import type { FrameClock, RigAssets } from "../render/types.js";
import { faceRig } from "./faceRig.js";
import { createCanvasStub, createGlStub, type GlStub } from "./glStub.js";
import { fakeAssets, malakorRig } from "./malakor.js";

const SOCKETS = new Map([
  ["eye_l", { hx: 10, hy: 6 }],
  ["eye_r", { hx: 10, hy: 6 }],
]);
const DRIVE: Drive = { t: 1, headYaw: 0, headPitch: 0, jawOpen: 0.3, blink: 0, gaze: { x: 0.8, y: 0 } };

const bitmap = (width: number, height: number): ImageBitmap => ({ width, height, close: () => undefined });
function standIns(r: Rig): RigAssets {
  const out: RigAssets = {};
  for (const l of r.layers) {
    out[l.file] = bitmap(l.bbox[2], l.bbox[3]);
    if (l.socket !== undefined) out[l.socket] = bitmap(l.bbox[2], l.bbox[3]);
    if (l.closed !== undefined) out[l.closed] = bitmap(l.bbox[2], l.bbox[3]);
  }
  return out;
}

/** Draws `frames` (each a drive, a look and a clock turn) on one renderer; the GL log of each. */
function draw(rig: Rig, assets: RigAssets, frames: { drive?: Partial<Drive>; look?: Look; turn?: FrameClock["turn"] }[]): { logs: GlStub["log"][]; stubs: GlStub[] } {
  const stub = createGlStub();
  const renderer = createRenderer(createCanvasStub({ webgl2: stub, width: 256, height: 256 }).canvas, rig, assets);
  const logs: GlStub["log"][] = [];
  for (const f of frames) {
    const look = f.look ?? defaultLook(rig);
    const poses = poseLayers(rig, look, { ...DRIVE, ...f.drive }, { sockets: SOCKETS });
    stub.reset();
    renderer.draw(poses, look, { t: 1, reducedMotion: false, ...(f.turn === undefined ? {} : { turn: f.turn }) });
    logs.push(stub.log.map(([n, a]) => [n, [...a]]));
  }
  return { logs, stubs: [stub] };
}

describe("depth turn in the GL renderer", () => {
  for (const [label, rig, assets] of [["face rig", faceRig(), standIns(faceRig())], ["Malakor", malakorRig(), fakeAssets(malakorRig())]] as const) {
    it(`${label}: front, no turn, and warp 0 + light 0 at any yaw draw today's frame call for call`, () => {
      const off: Look = { ...defaultLook(rig), turn: { warp: 0, light: 0 } };
      const yaw = { headYaw: 17, headPitch: -6 };
      const { logs } = draw(rig, assets, [{ drive: yaw }, { drive: yaw }, { drive: yaw, turn: { yaw: 0, pitch: 0 } }, { drive: yaw, look: off, turn: { yaw: 17 / 22, pitch: -0.5 } }, { drive: yaw }]);
      // The first frame uploads lazily loaded maps; compare the frames after it.
      const [, plain, zero, disabled, again] = logs;
      expect(zero).toEqual(plain);
      expect(disabled).toEqual(plain);
      expect(again).toEqual(plain);
      // Not one turn uniform or VAO switch: the draw path of a frame without a turn is the old one.
      expect(plain?.filter(([n, a]) => n.startsWith("uniform") && String((a[0] as { uniform?: string } | null)?.uniform).startsWith("u_turn"))).toEqual([]);
      expect(plain?.filter(([n]) => n === "bindVertexArray")).toHaveLength(4);
      expect(plain?.filter(([n, a]) => n === "drawArrays" && a[2] !== 4)).toEqual([]);
    });
  }

  it("a turned head: its layers draw as the grid with the shift, the rest as the quad; eyes and irises unlit; the iris bends as its eye", () => {
    const rig = faceRig();
    const look: Look = { ...defaultLook(rig), turn: { warp: 1, light: 1 } };
    const { logs, stubs } = draw(rig, standIns(rig), [{ drive: { headYaw: 22 }, look, turn: { yaw: 1, pitch: 0 } }, { look }, { look }]);
    const stub = stubs[0];
    const turned = logs[0] ?? [];
    const head = turnHead(rig);
    expect(head?.members.size).toBe(rig.layers.length);
    const counts = turned.filter(([n]) => n === "drawArrays").map(([, a]) => a[2]);
    // Every layer is on the head: all bent; the 1 composite (no glow source) stays a quad.
    expect(counts.filter((c) => c === TURN_GRID_VERTICES).length).toBeGreaterThanOrEqual(rig.layers.length);
    expect(counts.at(-1)).toBe(4);
    const shift = TURN_SHIFT_X * (head?.face.rx ?? 0);
    const ks = turned.filter(([n, a]) => n === "uniform4fv" && (a[0] as { uniform?: string }).uniform === "u_turnK").map(([, a]) => a[1]);
    expect(ks).toContainEqual([shift, 0, 1, 0]);
    expect(ks).toContainEqual([shift, 0, 0, 0]);
    expect(turned.filter(([n, a]) => n === "uniform4f" && (a[0] as { uniform?: string }).uniform === "u_turnEye").map(([, a]) => a.slice(1))).toEqual(
      rig.layers.filter((l) => l.kind === "eye").map((l) => [...l.bbox]),
    );
    // Back to front: one reset of each program's shift, then nothing more.
    const reset = (logs[1] ?? []).filter(([n, a]) => n === "uniform4fv" && (a[0] as { uniform?: string }).uniform === "u_turnK").map(([, a]) => a[1]);
    expect(reset.length).toBeGreaterThan(0);
    for (const k of reset) expect(k).toEqual([0, 0, 0, 0]);
    expect((logs[2] ?? []).filter(([n, a]) => n.startsWith("uniform") && String((a[0] as { uniform?: string }).uniform).startsWith("u_turn"))).toEqual([]);
    expect((logs[2] ?? []).filter(([n, a]) => n === "drawArrays" && a[2] !== 4)).toEqual([]);
    expect(stub?.count("bufferData")).toBe(0);
  });

  it("a layer off the head (body, background) keeps the quad and no shift while the head turns", () => {
    const rig = malakorRig();
    const look: Look = { ...defaultLook(rig), turn: { warp: 1, light: 1 } };
    const { logs } = draw(rig, fakeAssets(rig), [{ drive: { headYaw: 22 }, look, turn: { yaw: 1, pitch: 0 } }]);
    const log = logs[0] ?? [];
    const members = turnHead(rig)?.members ?? new Set();
    const poses = poseLayers(rig, look, { ...DRIVE, headYaw: 22 });
    const counts = log.filter(([n]) => n === "drawArrays").map(([, a]) => a[2]);
    const offHead = poses.filter((p) => !members.has(p.name)).length;
    expect(offHead).toBeGreaterThan(0);
    expect(counts.filter((c) => c === 4).length).toBeGreaterThanOrEqual(offHead);
    expect(members.has("torso")).toBe(false);
    expect(members.has("background")).toBe(false);
    expect(members.has("jaw")).toBe(true);
  });

  it("the frame body hands the pose's turn to the renderer, and none facing front or with both strengths 0", () => {
    const rig = faceRig();
    const run = (drive: Drive, look: Look): FrameClock => createFrameBody(1)({ rig, look, dt: 1 / 60, level: 0, gaze: "host", reducedMotion: false, drive }).clock;
    const look = defaultLook(rig);
    expect(run({ ...DRIVE, headYaw: 11, headPitch: 6 }, look).turn).toEqual({ yaw: 11 / YAW_LIMIT_DEG, pitch: 0.5 });
    expect("turn" in run(DRIVE, look)).toBe(false);
    expect("turn" in run({ ...DRIVE, headYaw: 11 }, { ...look, turn: { warp: 0, light: 0 } })).toBe(false);
    expect(run({ ...DRIVE, headYaw: 11 }, { ...look, turn: { warp: 0 } }).turn?.yaw).toBeCloseTo(0.5, 9);
  });
});
