// The glow skip (perfection-pass P1, req 1.3) against the counting GL stub: a frame with no glow
// source composites the scene alone at zero tint (the same pixels: the blurred glow would be black),
// and a frame with one runs extract, two blurs and the tinted composite exactly as before.
import { defaultLook, isEmissive, poseLayers, type Drive, type Look, type Rig } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { GLOW_GAIN, glowLit } from "../gl/glow.js";
import { createRenderer } from "../gl/renderer.js";
import { hexToRgb } from "../render/frame.js";
import { createCanvasStub, createGlStub, type GlStub } from "./glStub.js";
import { fakeAssets, malakorRig } from "./malakor.js";
import { asRigAssets, pixelAssets, pixelRig } from "./pixels.js";

const DRIVE: Drive = { t: 0, headYaw: 0, headPitch: 0, jawOpen: 0, blink: 0 };

function uniformCalls(stub: GlStub, method: string, uniform: string): unknown[][] {
  return stub.log.filter(([name, args]) => name === method && (args[0] as { uniform?: string } | null)?.uniform === uniform).map(([, args]) => args.slice(1));
}

function frame(rig: Rig, look: Look, assets = fakeAssets(rig)): GlStub {
  const stub = createGlStub();
  const renderer = createRenderer(createCanvasStub({ webgl2: stub, width: 64, height: 64 }).canvas, rig, assets);
  stub.reset();
  renderer.draw(poseLayers(rig, look, DRIVE), look);
  return stub;
}

describe("glow skip", () => {
  it("a rig without emissive layers draws its layers + 1: no extract, no blur, the composite at zero tint", () => {
    const rig = pixelRig();
    const stub = frame(rig, defaultLook(rig), asRigAssets(pixelAssets()));
    expect(stub.count("drawArrays")).toBe(rig.layers.length + 1);
    expect(uniformCalls(stub, "uniform2f", "u_step")).toEqual([]);
    expect(uniformCalls(stub, "uniform3f", "u_tint")).toEqual([[0, 0, 0]]);
    // The composite still reads the scene colour on unit 0 and draws to the canvas (framebuffer null).
    expect(stub.log.filter(([n, a]) => n === "bindFramebuffer" && a[1] === null)).toHaveLength(1);
  });

  it("a look that hides every emissive layer skips it too; showing one brings the full pass back", () => {
    const rig = malakorRig();
    const emissive = rig.layers.filter(isEmissive).map((l) => l.name);
    expect(emissive.length).toBeGreaterThan(0);
    const dark = frame(rig, { ...defaultLook(rig), hidden: emissive });
    expect(uniformCalls(dark, "uniform2f", "u_step")).toEqual([]);
    const lit = frame(rig, { ...defaultLook(rig), hidden: emissive.slice(1) });
    expect(uniformCalls(lit, "uniform2f", "u_step")).toHaveLength(2);
  });

  it("a rig with glow keeps extract, both blurs and the tinted composite (layers + 4)", () => {
    const rig = malakorRig();
    const look = defaultLook(rig);
    const stub = frame(rig, look);
    const poses = poseLayers(rig, look, DRIVE);
    expect(stub.count("drawArrays")).toBe(poses.length + 4);
    expect(uniformCalls(stub, "uniform2f", "u_step")).toHaveLength(2);
    const [r, g, b] = hexToRgb(look.palette.glow);
    expect(uniformCalls(stub, "uniform3f", "u_tint")).toEqual([[r * GLOW_GAIN, g * GLOW_GAIN, b * GLOW_GAIN]]);
  });

  it("a black glow colour skips the blurs (nothing to add)", () => {
    const rig = malakorRig();
    const look = defaultLook(rig);
    const stub = frame(rig, { ...look, palette: { ...look.palette, glow: "#000000" } });
    expect(uniformCalls(stub, "uniform2f", "u_step")).toEqual([]);
  });

  it("glowLit needs a source, a positive gain and a lit channel", () => {
    expect(glowLit(true, [0, 0.1, 0], 1)).toBe(true);
    expect(glowLit(false, [1, 1, 1], 1)).toBe(false);
    expect(glowLit(true, [0, 0, 0], 1)).toBe(false);
    expect(glowLit(true, [1, 1, 1], 0)).toBe(false);
  });
});
