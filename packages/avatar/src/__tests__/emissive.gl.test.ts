// Layer.emissive in the WebGL2 renderer (cast-forge task 12 follow-up, design.md "Emissive per
// layer"), against the counting GL stub. Golden: Malakor (no emissive field) draws exactly as the
// kind rule did (u_emissive on eye/crown/accessory, the eye colour on eyes) under every gesture.
// A cast rig's dark layers (Lot Ninety's gloves, the Tallyman's abacus and beads, Saint Cardia's
// crown and painted eyes, the socketed eyes) write no glow and take no eye colour; its lights (the
// irises of socketed eyes) still do.
import { defaultLook, poseLayers, validateRig, type Drive, type Gesture, type Look, type Rig } from "@sr/rig";
import { describe, expect, it } from "vitest";
import cardiaJob from "../../../../assets/replay/forge/saint-cardia/job.json";
import lotNinetyJob from "../../../../assets/replay/forge/lot-ninety/job.json";
import tallymanJob from "../../../../assets/replay/forge/the-tallyman/job.json";
import { createRenderer } from "../gl/renderer.js";
import { lookLight } from "../render/frame.js";
import type { RigAssets } from "../render/types.js";
import { createCanvasStub, createGlStub } from "./glStub.js";
import { fakeAssets, malakorRig } from "./malakor.js";

const OLD_EMISSIVE_KINDS = new Set(["eye", "crown", "accessory"]);
const GESTURES: readonly (Gesture | undefined)[] = [undefined, "nod", "tilt", "lean_in", "recoil", "glare", "flare"];

function rigOf(job: unknown): Rig {
  const checked = validateRig((job as { rig: unknown }).rig);
  if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
  return checked.value;
}

/** The assets plus stand-ins for socketed eyes' masks and closed lids (face-control), so every iris draws once. */
function withEyeArt(rig: Rig, assets: RigAssets): RigAssets {
  const out: RigAssets = { ...assets };
  for (const layer of rig.layers) for (const file of [layer.socket, layer.closed]) if (file !== undefined) out[file] = { width: layer.bbox[2], height: layer.bbox[3], close: () => undefined };
  return out;
}

/** One GL frame of `rig` at t = 2 (a gesture at its peak): per drawn layer, u_emissive and u_gain. */
function frame(rig: Rig, look: Look, gesture: Gesture | undefined) {
  const stub = createGlStub();
  const renderer = createRenderer(createCanvasStub({ webgl2: stub, width: 512, height: 512 }).canvas, rig, withEyeArt(rig, fakeAssets(rig)));
  const drive: Drive = { t: 2, headYaw: 0, headPitch: 0, jawOpen: 0, blink: 0, ...(gesture === undefined ? {} : { gesture: { name: gesture, startedAt: 1.8 } }) };
  const poses = poseLayers(rig, look, drive);
  stub.reset();
  renderer.draw(poses, look);
  const calls = (method: string, uniform: string): unknown[][] =>
    stub.log.filter(([name, args]) => name === method && (args[0] as { uniform?: string } | null)?.uniform === uniform).map(([, args]) => args.slice(1));
  const emissive = calls("uniform1f", "u_emissive").map((a) => a[0]);
  const gains = calls("uniform3f", "u_gain");
  return new Map(poses.map((p, i) => [p.name, { pose: p, emissive: emissive[i], gain: gains[i] }]));
}

describe("Layer.emissive in the GL renderer", () => {
  it("Malakor (golden): every layer's glow flag and light gain are the kind rule's, under every gesture", () => {
    const rig = malakorRig();
    const look = defaultLook(rig);
    const eye = lookLight(rig, look).eye;
    expect(rig.layers.every((l) => l.emissive === undefined)).toBe(true);
    for (const gesture of GESTURES) {
      for (const layer of rig.layers) {
        const got = frame(rig, look, gesture).get(layer.name);
        if (got === undefined) continue;
        const tint = got.pose.tint;
        const colour = layer.kind === "eye" ? eye : [1, 1, 1];
        expect(got.emissive, `${gesture} ${layer.name}`).toBe(OLD_EMISSIVE_KINDS.has(layer.kind) ? 1 : 0);
        expect(got.gain, `${gesture} ${layer.name}`).toEqual(colour.map((c) => expect.closeTo(c * tint, 6)));
      }
    }
  });

  it("cast rigs: dark layers write no glow and take no eye colour or flare; lights keep both", () => {
    const cases = [
      // Socketed eyes (cast-face-pass): the eye is dark, its iris carries the light.
      { rig: rigOf(lotNinetyJob), dark: ["hand_l", "hand_r", "eye_l", "eye_r"], lit: ["iris_l", "iris_r", "wisp_l", "wisp_r"] },
      { rig: rigOf(tallymanJob), dark: ["abacus", "beads_1l", "beads_3r", "eye_l1", "eye_r2"], lit: ["iris_l1", "iris_r2"] },
      { rig: rigOf(cardiaJob), dark: ["crown", "eye_l", "eye_r", "spire_3"], lit: ["heart"] },
    ];
    for (const { rig, dark, lit } of cases) {
      const look = defaultLook(rig);
      const eye = lookLight(rig, look).eye;
      const rest = frame(rig, look, undefined);
      const flare = frame(rig, look, "flare");
      for (const name of dark) {
        const got = flare.get(name);
        expect(got?.emissive, `${rig.id} ${name}`).toBe(0);
        expect(got?.pose.tint, `${rig.id} ${name}`).toBe(rest.get(name)?.pose.tint);
        expect(got?.gain, `${rig.id} ${name}`).toEqual([1, 1, 1].map((c) => expect.closeTo(c * (got?.pose.tint ?? NaN), 6)));
      }
      for (const name of lit) {
        const got = flare.get(name);
        const layer = rig.layers.find((l) => l.name === name);
        const colour = layer?.kind === "eye" || layer?.kind === "iris" ? eye : [1, 1, 1];
        expect(got?.emissive, `${rig.id} ${name}`).toBe(1);
        expect(got?.gain, `${rig.id} ${name}`).toEqual(colour.map((c) => expect.closeTo(c * (got?.pose.tint ?? NaN), 6)));
        expect(got?.pose.tint ?? NaN).toBeCloseTo(2 * (rest.get(name)?.pose.tint ?? NaN), 9);
      }
    }
  });
});
