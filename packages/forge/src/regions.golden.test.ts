// character-control task 3 golden (requirement 2.2): `regionsOf` on three committed layers gives
// byte-identical maps, pinned by the SHA-256 of their PNG bytes. A change to the classing, merge,
// filter or encoding shows here first; re-pin only with the director's review of the new maps.
import { describe, expect, it } from "vitest";
import reveilleJaw from "../../../assets/replay/forge/reveille/jaw.png?inline";
import cardiaHead from "../../../assets/replay/forge/saint-cardia/head.png?inline";
import malakorTorso from "../../../assets/characters/malakor/rig/torso.png?inline";
import { encodePng } from "./image.js";
import { inlineImage } from "./malakor.fixture.js";
import { regionsOf } from "./regions.js";
import { sha256Hex } from "./sha256.fixture.js";

const CASES = [
  {
    what: "reveille jaw",
    layer: { name: "jaw", kind: "jaw" as const },
    url: reveilleJaw,
    sha: "7a0bf8527b5f9737500339242746b23203c17f6d534e3b391eda124963ebe59a",
    ids: ["r1", "r2"],
  },
  {
    what: "saint-cardia head",
    layer: { name: "head", kind: "head" as const },
    url: cardiaHead,
    sha: "66c4b300f9e04ca90be7fa3a14aa1c04e1f4e4ce755e00748e7518f80d66b23d",
    ids: ["r1", "r2"],
  },
  {
    what: "malakor torso",
    layer: { name: "torso", kind: "body" as const },
    url: malakorTorso,
    sha: "c1a93fdabdfc02cacb389f45c0b15bf050e00a663c53cd144349596b249a42a7",
    ids: ["r1", "r2", "r3"],
  },
];

describe("golden: region maps of committed layers", () => {
  it("sha256 of the fixture helper is FIPS 180-4's", () => {
    const abc = new Uint8Array([0x61, 0x62, 0x63]);
    expect(sha256Hex(abc)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it.each(CASES)("$what: the same map, byte for byte, every run", ({ layer, url, sha, ids }) => {
    const image = inlineImage(url);
    const first = regionsOf(layer, image);
    const second = regionsOf(layer, inlineImage(url));
    if (first === undefined || second === undefined) throw new Error("no regions");
    const png = encodePng(first.map);
    expect(sha256Hex(png)).toBe(sha);
    expect(sha256Hex(encodePng(second.map))).toBe(sha);
    expect(second.regions).toEqual(first.regions);
    expect(first.regions.map).toBe(`${layer.name}.regions.png`);
    expect(first.regions.slots.map((s) => s.id)).toEqual(ids);
    expect([first.map.width, first.map.height]).toEqual([image.width, image.height]);
  });
});
