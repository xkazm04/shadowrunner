// L2's mouth generator without a key and without ffmpeg: the Gemini request shape against a fake
// fetch, the clear stop without GEMINI_API_KEY, a whole set generated from a fake model answer and
// fake image ops (manifest, cost.json, a failed shape left to L1), and the placeholder path.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writePack } from "@sr/pack";
import { defaultLook, RIG_VERSION, type Rig } from "@sr/rig";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readManifest } from "../../page/lip/mouth/manifest.js";
import { mouthsCommand, parseMouthsArgs } from "../command.js";
import { geminiEditor, imageOfReply, NO_KEY_SENTENCE, USD_PER_EDIT, type FetchLike } from "../gemini.js";
import type { ImageOps } from "../images.js";
import { shapePrompt } from "../prompts.js";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function rig(): Rig {
  return {
    version: RIG_VERSION,
    id: "test-ghoul",
    name: "Test Ghoul",
    width: 512,
    height: 512,
    source: "forge",
    fictional: true,
    palette: { glow: "#112233", eye: "#445566", rim: "#778899", mouth: "#000000" },
    layers: [
      { name: "torso", z: 1, kind: "body", file: "torso.png", bbox: [100, 300, 300, 200], anchor: [250, 400] },
      { name: "head", z: 2, kind: "head", file: "head.png", bbox: [160, 40, 200, 280], anchor: [256, 300] },
      { name: "jaw", z: 3, kind: "jaw", file: "jaw.png", bbox: [216, 250, 80, 16], anchor: [256, 250], follow: "head" },
    ],
  };
}

async function packBytes(): Promise<Uint8Array> {
  const r = rig();
  return writePack({ rig: r, look: defaultLook(r), voice: "v", files: { "torso.png": PNG, "head.png": PNG, "jaw.png": PNG }, licence: "CC0-1.0", exportedAt: "2026-01-01T00:00:00.000Z" });
}

/** Fake image ops: write a marker file per call, remember the calls. */
function fakeImages() {
  const calls: string[] = [];
  const ops: ImageOps = {
    async composeRest(layers, side, out) {
      calls.push(`rest ${side} ${layers.map((l) => `${l.x},${l.y}`).join(" ")}`);
      await writeFile(out, PNG);
    },
    async flatten(_rest, size) {
      calls.push(`flatten ${size}`);
      return PNG;
    },
    async fit(_image, side, out) {
      calls.push(`fit ${side}`);
      await writeFile(out, PNG);
    },
    async placeholder(_rest, mouth, params, out) {
      calls.push(`placeholder ${mouth.cx.toFixed(1)} ${params.open}`);
      await writeFile(out, PNG);
    },
  };
  return { ops, calls };
}

const answer = (image = "iVBORw0KGgo=") => ({ candidates: [{ content: { parts: [{ text: "here" }, { inlineData: { mimeType: "image/png", data: image } }] }, finishReason: "STOP" }] });

let dir: string;
let packs: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "sr-mouths-"));
  packs = join(dir, "packs");
  await mkdir(packs);
  await writeFile(join(packs, "test-ghoul.srpack"), await packBytes());
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("gemini mouth editor", () => {
  it("stops with a sentence when GEMINI_API_KEY is absent, before any request", () => {
    expect(() => geminiEditor({ apiKey: undefined })).toThrow(NO_KEY_SENTENCE);
    expect(() => geminiEditor({ apiKey: "  " })).toThrow(/GEMINI_API_KEY is not set/);
  });

  it("sends the forge's request shape with the key in a header only", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetch: FetchLike = async (url, init) => {
      seen.push({ url, init });
      return new Response(JSON.stringify(answer()), { status: 200 });
    };
    const editor = geminiEditor({ apiKey: "k-123", fetch });
    const out = await editor.edit({ mimeType: "image/png", data: PNG }, "make it round");
    expect(out.mimeType).toBe("image/png");
    expect(seen[0]?.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent");
    expect(seen[0]?.url).not.toContain("k-123");
    expect((seen[0]?.init.headers as Record<string, string>)["x-goog-api-key"]).toBe("k-123");
    const body = JSON.parse(String(seen[0]?.init.body));
    expect(body.contents[0].parts[0].inlineData.mimeType).toBe("image/png");
    expect(body.contents[0].parts[1].text).toBe("make it round");
    expect(body.generationConfig).toEqual({ responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "1:1", imageSize: "1K" } });
  });

  it("turns refusals, HTTP errors and imageless answers into sentences without the body", async () => {
    expect(imageOfReply({ promptFeedback: { blockReason: "SAFETY" } })).toBe("Gemini refused this request.");
    expect(imageOfReply({ candidates: [{ content: { parts: [{ text: "no" }] }, finishReason: "IMAGE_SAFETY" }] })).toMatch(/IMAGE_SAFETY/);
    const editor = geminiEditor({ apiKey: "k", fetch: async () => new Response("secret upstream body", { status: 500 }) });
    await expect(editor.edit({ mimeType: "image/png", data: PNG }, "x")).rejects.toThrow(/^Gemini answered HTTP 500\.$/);
  });
});

describe("mouths command", () => {
  it("parses its arguments and rejects bad ones with a sentence", () => {
    expect(parseMouthsArgs(["the-tallyman", "--placeholder"])).toEqual({ character: "the-tallyman", placeholder: true, draft: false });
    expect(parseMouthsArgs(["x", "--only", "round,closed"]).only).toEqual(["round", "closed"]);
    expect(() => parseMouthsArgs([])).toThrow(/Name a character/);
    expect(() => parseMouthsArgs(["x", "--only", "smile"])).toThrow(/"smile" is not a mouth shape/);
    expect(() => parseMouthsArgs(["../evil"])).toThrow(/not a pack id/);
  });

  it("without the key it stops before reading or writing anything", async () => {
    const { ops, calls } = fakeImages();
    await expect(mouthsCommand(["test-ghoul"], () => undefined, { env: {}, images: ops, packsDir: packs, outRoot: join(dir, "out") })).rejects.toThrow(NO_KEY_SENTENCE);
    expect(calls).toEqual([]);
  });

  it("generates a set from fake model answers: rest is the crop, one call per other shape, cost.json", async () => {
    const { ops, calls } = fakeImages();
    let n = 0;
    const fetch: FetchLike = async () => {
      n += 1;
      // The fourth call (closed) is refused: that shape is left to L1.
      return new Response(JSON.stringify(n === 4 ? { promptFeedback: { blockReason: "OTHER" } } : answer()), { status: 200 });
    };
    const lines: string[] = [];
    await mouthsCommand(["test-ghoul"], (l) => lines.push(l), { env: { GEMINI_API_KEY: "k" }, fetch, images: ops, packsDir: packs, outRoot: join(dir, "out") });
    const out = join(dir, "out", "test-ghoul");
    const manifest = JSON.parse(await readFile(join(out, "manifest.json"), "utf8"));
    const checked = readManifest(manifest);
    expect(typeof checked).not.toBe("string");
    expect(manifest.source).toBe("gemini");
    expect(manifest.model).toBe("gemini-3-pro-image");
    expect(manifest.shapes.rest).toBe("rest.png");
    expect(manifest.shapes.closed).toBeUndefined();
    expect(manifest.failed.closed).toBe("Gemini refused this request.");
    expect(Object.keys(manifest.shapes)).toHaveLength(7);
    // The square: the mouth is min(jaw 80 * 0.85, head 200 * 0.32) = 64 wide, side round(64 * 1.8) = 115.
    expect(manifest.crop[2]).toBe(115);
    const cost = JSON.parse(await readFile(join(out, "cost.json"), "utf8"));
    expect(cost).toMatchObject({ character: "test-ghoul", source: "gemini", calls: 7, usdPerCall: USD_PER_EDIT, usd: 0.98 });
    expect(n).toBe(7);
    // The torso is not on the head's chain: only head and jaw are composed.
    expect(calls[0]).toMatch(/^rest 115 \S+ \S+$/);
    expect(calls.filter((c) => c.startsWith("fit"))).toHaveLength(6);
    expect(lines.at(-1)).toMatch(/7 shape\(s\), gemini/);
  });

  it("draws a deterministic placeholder set with no model call and a zero cost", async () => {
    const { ops, calls } = fakeImages();
    await mouthsCommand(["test-ghoul", "--placeholder"], () => undefined, { env: {}, images: ops, packsDir: packs, outRoot: join(dir, "out") });
    const out = join(dir, "out", "test-ghoul");
    const manifest = JSON.parse(await readFile(join(out, "manifest.json"), "utf8"));
    expect(manifest.source).toBe("placeholder");
    expect(Object.keys(manifest.shapes)).toHaveLength(8);
    expect(calls.filter((c) => c.startsWith("placeholder"))).toHaveLength(7);
    const cost = JSON.parse(await readFile(join(out, "cost.json"), "utf8"));
    expect(cost).toMatchObject({ source: "placeholder", calls: 0, usd: 0 });
    expect(cost.model).toBeUndefined();
  });

  it("names a missing pack", async () => {
    await expect(mouthsCommand(["nobody-here", "--placeholder"], () => undefined, { env: {}, images: fakeImages().ops, packsDir: packs, outRoot: join(dir, "out") })).rejects.toThrow(/No pack at .*nobody-here\.srpack/);
  });

  it("asks the model to change only the mouth", () => {
    const p = shapePrompt("Test Ghoul", "round");
    expect(p).toMatch(/Change ONLY the mouth/);
    expect(p).toMatch(/oo/);
  });
});
