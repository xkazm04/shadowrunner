import { readPack, writePack, type AvatarPack, type PackErrorCode } from "@sr/pack";
import { defaultLook } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { testRig } from "../testFixtures";
import type { CharacterRecord } from "./libraryStore";
import { canExport, importError, packInputOf, recordOfPack } from "./packing";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function record(id = "ghost", seeded = false): CharacterRecord {
  const rig = testRig(id, "Test Ghost");
  const assets: Record<string, Blob> = {};
  for (const layer of rig.layers) assets[layer.file] = new Blob([PNG], { type: "image/png" });
  const r: CharacterRecord = { id, rig, assets, look: defaultLook(rig), voice: "velvet", createdAt: "2026-11-01T00:00:00.000Z" };
  if (seeded) r.seeded = true;
  return r;
}

function pack(id = "ghost", voice = "velvet"): AvatarPack {
  const r = record(id);
  return {
    manifest: {
      format: "srpack",
      version: 1,
      app: "shadowrunner",
      exportedAt: "2026-11-04T00:00:00.000Z",
      id,
      name: r.rig.name,
      look: r.look,
      voice,
      licence: "CC0-1.0",
      source: r.rig.source,
      files: Object.keys(r.assets).sort(),
    },
    rig: r.rig,
    look: r.look,
    voice,
    files: r.assets,
  };
}

const NOW = new Date("2026-11-04T12:00:00.000Z");

describe("canExport", () => {
  it("refuses only the seeded house character", () => {
    expect(canExport(record("malakor", true))).toBe(false);
    expect(canExport(record("ghost"))).toBe(true);
  });
});

describe("packInputOf", () => {
  it("carries the saved look, voice, images and creation time; an empty author is left out", () => {
    const r = record();
    const input = packInputOf(r, { licence: "CC-BY-4.0", author: "   " });
    expect(input).toEqual({ rig: r.rig, look: r.look, voice: "velvet", files: r.assets, licence: "CC-BY-4.0", createdAt: r.createdAt });
    expect("author" in input).toBe(false);
    expect(packInputOf(r, { licence: "CC0-1.0", author: "  Ada " }).author).toBe("Ada");
  });

  it("round-trips through writePack and readPack into an equal record", async () => {
    const r = record();
    const read = await readPack(await writePack(packInputOf(r, { licence: "CC0-1.0", author: "Ada" })));
    if (!read.ok) throw new Error(read.error.detail);
    expect(read.pack.manifest.author).toBe("Ada");
    const back = recordOfPack(read.pack, new Set(), NOW);
    expect(back.rig).toEqual(r.rig);
    expect(back.look).toEqual(r.look);
    expect(back.voice).toBe("velvet");
    expect(Object.keys(back.assets).sort()).toEqual(Object.keys(r.assets).sort());
  });

  it("llm-avatar-lab: a forged rig's mouth survives export, import and a copy on an id clash; a rig without one stays without", async () => {
    const r = record();
    const mouth = { cx: 20.5, lineY: 30, width: 12.75 };
    const forged = { ...r, rig: { ...r.rig, mouth } };
    const read = await readPack(await writePack(packInputOf(forged, { licence: "CC0-1.0", author: "" })));
    if (!read.ok) throw new Error(read.error.detail);
    expect(recordOfPack(read.pack, new Set(), NOW).rig.mouth).toEqual(mouth);
    expect(recordOfPack(read.pack, new Set(["ghost"]), NOW).rig.mouth).toEqual(mouth);
    const plain = await readPack(await writePack(packInputOf(r, { licence: "CC0-1.0", author: "" })));
    if (!plain.ok) throw new Error(plain.error.detail);
    expect("mouth" in recordOfPack(plain.pack, new Set(), NOW).rig).toBe(false);
  });

  it("face-control: Look.face survives export and import (and a copy on an id clash); a look without one stays without", async () => {
    const r = record();
    const face = { gaze: { range: 0.85, habits: { chat: 0.25 } }, motion: { breath: 0.6 }, mouth: { emotion: 1.3 } };
    const tuned = { ...r, rig: { ...r.rig, face: { expression: { strength: 0.7 } } }, look: { ...r.look, face } };
    const read = await readPack(await writePack(packInputOf(tuned, { licence: "CC0-1.0", author: "" })));
    if (!read.ok) throw new Error(read.error.detail);
    expect(read.pack.look.face).toEqual(face);
    expect(recordOfPack(read.pack, new Set(), NOW).look.face).toEqual(face);
    expect(recordOfPack(read.pack, new Set(["ghost"]), NOW).look.face).toEqual(face);
    expect(recordOfPack(read.pack, new Set(), NOW).rig.face).toEqual({ expression: { strength: 0.7 } });
    const plain = await readPack(await writePack(packInputOf(r, { licence: "CC0-1.0", author: "" })));
    if (!plain.ok) throw new Error(plain.error.detail);
    expect("face" in recordOfPack(plain.pack, new Set(), NOW).look).toBe(false);
  });
});

describe("recordOfPack", () => {
  it("keeps the pack's id when it is free, created now, never seeded", () => {
    const r = recordOfPack(pack(), new Set(["other"]), NOW);
    expect(r.id).toBe("ghost");
    expect(r.rig.id).toBe("ghost");
    expect(r.rig.name).toBe("Test Ghost");
    expect(r.createdAt).toBe(NOW.toISOString());
    expect(r.seeded).toBeUndefined();
  });

  it("adds a copy on an id clash: -2, then -3, the rig renamed with (copy)", () => {
    const second = recordOfPack(pack(), new Set(["ghost"]), NOW);
    expect([second.id, second.rig.id, second.rig.name]).toEqual(["ghost-2", "ghost-2", "Test Ghost (copy)"]);
    const third = recordOfPack(pack(), new Set(["ghost", "ghost-2"]), NOW);
    expect([third.id, third.rig.id]).toEqual(["ghost-3", "ghost-3"]);
  });

  it("falls back to the default voice for a voice it does not know", () => {
    expect(recordOfPack(pack("ghost", "kazoo"), new Set(), NOW).voice).toBe("crypt");
    expect(recordOfPack(pack("ghost", "clerk"), new Set(), NOW).voice).toBe("clerk");
  });
});

describe("importError", () => {
  it("says each failure in plain words", () => {
    const codes: PackErrorCode[] = ["not_a_pack", "newer_version", "bad_manifest", "bad_rig", "bad_look", "missing_file", "too_large", "fetch_failed"];
    const sentences = codes.map((code) => importError({ code, detail: "head.png" }));
    expect(new Set(sentences).size).toBe(codes.length);
    for (const s of sentences) expect(s).toMatch(/^That .*\.$/);
    expect(importError({ code: "not_a_pack", detail: "not a zip file" })).toBe("That file is not a Shadowrunner pack.");
    expect(importError({ code: "missing_file", detail: "head.png" })).toBe("That pack is missing head.png.");
    expect(importError({ code: "too_large", detail: "" })).toBe("That pack is over 50 MB.");
  });
});
