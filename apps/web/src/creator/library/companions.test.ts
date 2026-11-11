// companion-lanes requirement 6.3: the creator offers the packs in /packs/index.json that are not in
// the Halloween cast, and reads a companion's pack exactly as Import pack reads a file.
import { writePack } from "@sr/pack";
import { defaultLook } from "@sr/rig";
import { describe, expect, it } from "vitest";
import { testRig } from "../testFixtures";
import { companionRecord, loadCompanions, PACK_INDEX } from "./companions";

const INDEX = [
  { id: "bun", name: "Bun", file: "bun.srpack", bytes: 10 },
  { id: "iris", name: "Iris", file: "iris.srpack", bytes: 10 },
  { id: "replay-the-tallyman", name: "The Tallyman", file: "the-tallyman.srpack", bytes: 10 },
  { id: "odd", name: "Odd", file: "../etc/passwd", bytes: 10 },
  { id: 3 },
];

const serve =
  (routes: Record<string, () => Response>): typeof fetch =>
  (input) => {
    const route = routes[String(input)];
    return Promise.resolve(route === undefined ? new Response("missing", { status: 404 }) : route());
  };

describe("loadCompanions", () => {
  it("lists the index entries the cast does not hold, in index order, dropping malformed ones", async () => {
    const found = await loadCompanions(new Set(["replay-the-tallyman", "malakor"]), serve({ [PACK_INDEX]: () => Response.json(INDEX) }));
    expect(found).toEqual([
      { id: "bun", name: "Bun", file: "bun.srpack" },
      { id: "iris", name: "Iris", file: "iris.srpack" },
    ]);
  });

  it("is empty when the index cannot be read", async () => {
    expect(await loadCompanions(new Set(), serve({}))).toEqual([]);
    expect(await loadCompanions(new Set(), serve({ [PACK_INDEX]: () => new Response("<html>") }))).toEqual([]);
    expect(await loadCompanions(new Set(), () => Promise.reject(new Error("offline")))).toEqual([]);
  });
});

describe("companionRecord", () => {
  it("reads the pack like an import: the rig's id, or a copy when the id is taken", async () => {
    const rig = testRig("iris", "Iris");
    const files = Object.fromEntries(rig.layers.map((l) => [l.file, new Uint8Array([1, 2, 3])]));
    const bytes = await writePack({ rig, look: defaultLook(rig), voice: "velvet", files, licence: "all-rights-reserved", createdAt: "2026-11-11T00:00:00.000Z", exportedAt: "2026-11-11T00:00:00.000Z" });
    const get = serve({ "/packs/iris.srpack": () => new Response(bytes.slice()) });
    const entry = { id: "iris", name: "Iris", file: "iris.srpack" };
    const fresh = await companionRecord(entry, new Set(), get);
    expect([fresh.id, fresh.rig.name, fresh.voice]).toEqual(["iris", "Iris", "velvet"]);
    const copy = await companionRecord(entry, new Set(["iris"]), get);
    expect(copy.id).not.toBe("iris");
    expect(copy.rig.name).toBe("Iris (copy)");
  });

  it("throws the import sentence when the pack is missing", async () => {
    await expect(companionRecord({ id: "iris", name: "Iris", file: "iris.srpack" }, new Set(), serve({}))).rejects.toThrow(/.+/);
  });
});
