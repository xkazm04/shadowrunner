// companion-lanes requirement 1.3: a morph rig's atlas, motion image and sway map are rig files: the
// pack writes them, reads them back byte for byte, and moves inline data: ones to named files.
import { defaultLook, type Rig } from "@sr/rig";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { inlineToFiles } from "../files.js";
import { readPack, rigFiles, writePack } from "../index.js";
import type { PackInput } from "../types.js";
import { bytesFor } from "./fixtures.js";

function morphRig(): Rig {
  return {
    version: 1,
    id: "test-portrait",
    name: "Test Portrait",
    width: 64,
    height: 64,
    source: "replay",
    fictional: true,
    palette: { glow: "#000000", eye: "#ffffff", rim: "#000000", mouth: "#802020" },
    layers: [
      { name: "body", z: 1, kind: "body", file: "body.webp", bbox: [8, 40, 48, 24], anchor: [32, 52] },
      { name: "head", z: 2, kind: "head", file: "head.webp", bbox: [16, 8, 32, 36], anchor: [32, 40] },
    ],
    morph: {
      layer: "head",
      atlas: "morph.atlas.webp",
      flow: "morph.flow.png",
      keys: [
        { id: "blink", track: "blink", bbox: [20, 16, 24, 6], cell: [0, 0, 24, 6], flowCell: [0, 0, 6, 2], flowMax: 2 },
        { id: "open", track: "openMid", bbox: [24, 30, 16, 8], cell: [0, 10, 16, 8] },
      ],
      eyes: [[26, 19], [38, 19]],
      sway: { map: "morph.sway.png", amp: 2 },
    },
  };
}

const NAMES = ["body.webp", "head.webp", "morph.atlas.webp", "morph.flow.png", "morph.sway.png"];

function input(rig: Rig = morphRig()): PackInput {
  return {
    rig,
    look: defaultLook(rig),
    voice: "crypt",
    files: Object.fromEntries(NAMES.map((n) => [n, bytesFor(n)])),
    licence: "CC-BY-4.0",
    exportedAt: "2026-11-11T00:00:00.000Z",
  };
}

describe("a morph rig in a pack", () => {
  it("rigFiles lists the layers, then the atlas, the motion image and the sway map", () => {
    expect(rigFiles(morphRig())).toEqual(NAMES);
  });

  it("round trips: the rig with its morph, and every morph file's bytes", async () => {
    const bytes = await writePack(input());
    expect(Object.keys(unzipSync(bytes)).filter((k) => k.startsWith("files/"))).toEqual(NAMES.map((n) => `files/${n}`).sort());
    const result = await readPack(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pack.rig).toEqual(morphRig());
    for (const name of NAMES) expect(new Uint8Array(await (result.pack.files[name] ?? new Blob()).arrayBuffer())).toEqual(bytesFor(name));
    expect(result.pack.files["morph.flow.png"]?.type).toBe("image/png");
  });

  it("a missing morph file is left out (only layer images are required)", async () => {
    const files = { ...input().files };
    delete files["morph.sway.png"];
    const result = await readPack(await writePack({ ...input(), files }));
    expect(result.ok && Object.keys(result.pack.files).sort()).toEqual(NAMES.filter((n) => n !== "morph.sway.png").sort());
  });

  it("moves inline data: morph images to morph.atlas / morph.flow / morph.sway files", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const webp = "data:image/webp;base64,UklGRg==";
    const rig = morphRig();
    const morph = rig.morph;
    if (morph === undefined) throw new Error("fixture");
    const inline: Rig = { ...rig, morph: { ...morph, atlas: webp, flow: png, sway: { map: png, amp: 2 } } };
    const out = inlineToFiles(inline);
    expect(out.rig.morph).toMatchObject({ atlas: "morph.atlas.webp", flow: "morph.flow.png", sway: { map: "morph.flow.png", amp: 2 } });
    expect([...out.moved.keys()].sort()).toEqual(["morph.atlas.webp", "morph.flow.png"]);
  });
});
