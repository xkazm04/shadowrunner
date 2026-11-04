// Test fixtures for @sr/pack: a small valid rig with a PNG and a WebP layer, a region map and an
// expression patch, and the input that packs it.
import { defaultLook, type Rig } from "@sr/rig";
import { unzipSync, zipSync, type Unzipped } from "fflate";
import type { PackInput } from "../types.js";

export function packRig(): Rig {
  return {
    version: 1,
    id: "test-ghost",
    name: "Test Ghost",
    width: 64,
    height: 64,
    source: "forge",
    fictional: true,
    palette: { glow: "#112233", eye: "#445566", rim: "#778899", mouth: "#aabbcc" },
    layers: [
      { name: "torso", z: 1, kind: "body", file: "torso.png", bbox: [8, 40, 48, 24], anchor: [32, 52] },
      {
        name: "head",
        z: 2,
        kind: "head",
        file: "head.webp",
        bbox: [16, 8, 32, 36],
        anchor: [32, 40],
        regions: { map: "head.regions.png", slots: [{ id: "r1", name: "hood", hex: "#334455" }] },
        variants: { joy: { file: "head.joy.webp", bbox: [16, 8, 8, 8], mode: "over" } },
      },
      { name: "jaw", z: 3, kind: "jaw", file: "jaw.png", bbox: [24, 30, 16, 8], anchor: [32, 30], follow: "head" },
    ],
  };
}

/** Distinct bytes per name, so a mix-up shows. */
export const bytesFor = (name: string): Uint8Array => new TextEncoder().encode(`image:${name}`);

export function packInput(overrides: Partial<PackInput> = {}): PackInput {
  const rig = packRig();
  return {
    rig,
    look: { ...defaultLook(rig), emotion: "smug", gesture: "nod", regions: { "head/r1": "#ff0000" } },
    voice: "crypt",
    files: {
      "torso.png": new Blob([bytesFor("torso.png") as BlobPart]),
      "head.webp": bytesFor("head.webp"),
      "head.regions.png": bytesFor("head.regions.png"),
      "head.joy.webp": new Blob([bytesFor("head.joy.webp") as BlobPart]),
      "jaw.png": bytesFor("jaw.png"),
      "stray.png": bytesFor("stray.png"),
    },
    licence: "CC-BY-4.0",
    author: "  Ada  ",
    createdAt: "2026-10-01T00:00:00.000Z",
    exportedAt: "2026-11-04T00:00:00.000Z",
    ...overrides,
  };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Re-zips a pack after `edit` changes its entries (crafted packs for the error codes). */
export function craft(pack: Uint8Array, edit: (entries: Unzipped) => void): Uint8Array {
  const entries = unzipSync(pack);
  edit(entries);
  return zipSync(entries, { level: 0 });
}

export const readJson = (bytes: Uint8Array | undefined): Record<string, unknown> => JSON.parse(decoder.decode(bytes)) as Record<string, unknown>;
export const writeJson = (value: unknown): Uint8Array<ArrayBuffer> => encoder.encode(JSON.stringify(value));
