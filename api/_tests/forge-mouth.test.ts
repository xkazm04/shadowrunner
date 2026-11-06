// llm-avatar-lab round 3 (the rig owns the mouth): a character forged on the live plane, through the
// real handlers, with a fake image model and the live store's own hops (job JSON through KV and
// `parseForgeJob`, images through a fake Blob and fetch), ends `done` with `rig.mouth` and with every
// expression face's mouth reset to the neutral portrait mouth, even though the fake edit repainted
// the mouth as well as the eyes. No network, no key.
import { readFileSync } from "node:fs";
import { cutVariants, decodeImage, encodePng, isBrowLayer, mouthWeight, parseForgeJob, type ForgeJob, type JobView, type Rgba } from "@sr/forge";
import { EXPRESSION_FAMILIES, parseRigJson, serializeRig, type Layer, type Rig } from "@sr/rig";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleForgeGet, handleForgePost, type ForgeDeps } from "../_lib/forge-api.js";
import type { GeminiClient, GeminiImage } from "../_lib/gemini.js";
import { RedisBlobJobStore, type BlobClient } from "../_lib/jobstore.js";
import type { KvClient } from "../_lib/kv.js";
import { MemoryQuotaStore, createQuota } from "../_lib/quota.js";

const ROOT = new URL("../../", import.meta.url);
const PORTRAIT: GeminiImage = { mimeType: "image/png", data: new Uint8Array(readFileSync(new URL("assets/characters/malakor/rig/portrait.png", ROOT))) };
const M8_PARTS = readFileSync(new URL("packages/forge/test/fixtures/m8-parts.json", ROOT), "utf8");
const BOXES = (JSON.parse(M8_PARTS) as { name: string; box_2d: [number, number, number, number] }[]).filter((p) => p.name.startsWith("eye_")).map((p) => p.box_2d);
/**
 * Where the fake edit repaints the mouth (0..1000, [ymin, xmin, ymax, xmax]): a grin round the lip
 * line the forge measures on the m8 jaw (y 524), wider than the reset region (cheek folds), so the
 * head/jaw faces exist and reach over the mouth.
 */
const MOUTH_BOX: [number, number, number, number] = [490, 330, 560, 670];

function decoded(bytes: Uint8Array): Rgba {
  const image = decodeImage(bytes);
  if (!image.ok) throw new Error("undecodable image");
  return image.value;
}

/** The portrait with `shift` added inside the middle of each eye box and inside MOUTH_BOX (a grin painted over the lips). */
function editedFace(shift: number): GeminiImage {
  const image = decoded(PORTRAIT.data);
  const { width, data } = image;
  const inside = ([y0, x0, y1, x1]: number[], x: number, y: number, inset: number) =>
    x > (x0 ?? 0) + ((x1 ?? 0) - (x0 ?? 0)) * inset && x < (x1 ?? 0) - ((x1 ?? 0) - (x0 ?? 0)) * inset && y > (y0 ?? 0) + ((y1 ?? 0) - (y0 ?? 0)) * inset && y < (y1 ?? 0) - ((y1 ?? 0) - (y0 ?? 0)) * inset;
  for (let i = 0; i < data.length / 4; i++) {
    const x = ((i % width) * 1000) / width;
    const y = (Math.floor(i / width) * 1000) / width;
    if (BOXES.some((b) => inside(b, x, y, 0.2)) || inside(MOUTH_BOX, x, y, 0)) for (let c = 0; c < 3; c++) data[i * 4 + c] = (data[i * 4 + c] ?? 0) + shift;
  }
  return { mimeType: "image/png", data: encodePng(image) };
}

/** The live store with fakes behind it: KV keeps the job as JSON text, Blob keeps bytes behind https URLs that a fake fetch serves. */
function liveStore() {
  const kv = new Map<string, string>();
  const blobs = new Map<string, Uint8Array>();
  const kvClient: KvClient = { get: async (k) => kv.get(k) ?? null, set: async (k, v) => void kv.set(k, v), incrBy: async () => 0 };
  let n = 0;
  const blob: BlobClient = {
    put: async (pathname, body) => {
      const url = `https://store1.public.blob.vercel-storage.com/${pathname.replace(/\.(\w+)$/, `-${++n}.$1`)}`;
      blobs.set(url, body.slice());
      return { url };
    },
    list: async () => ({ blobs: [], hasMore: false }),
    del: async () => undefined,
  };
  const fetchBlob = async (input: string | URL | Request) => {
    const bytes = blobs.get(String(input));
    return bytes === undefined ? new Response(null, { status: 404 }) : new Response(bytes, { status: 200 });
  };
  return { store: new RedisBlobJobStore<ForgeJob>({ kv: kvClient, blob, parse: parseForgeJob, fetch: fetchBlob }), kv, blobs };
}

function setup() {
  const prompts: string[] = [];
  const client: GeminiClient = {
    models: { image: "fake-image", imageDraft: "fake-draft", segment: "fake-segment" },
    generateImage: async () => PORTRAIT,
    editImage: async (_image, prompt) => {
      if (!prompt.startsWith("Edit this portrait")) return PORTRAIT; // the fill edit
      if (/remove the irises|Close both eyes/.test(prompt)) return PORTRAIT; // face-control: the eye step's edits
      prompts.push(prompt);
      return editedFace(70);
    },
    generateJson: async () => M8_PARTS,
  };
  const quota = createQuota({ store: new MemoryQuotaStore(), salt: "s", limits: { perIp: { forge: 3, engine: 60, voice: 60 }, dailyUsd: 30 } });
  const live = liveStore();
  let clock = 1_000_000;
  // face-control: this test pins the mouth reset of the unsocketed cut (an edit painting a grin); the
  // socketed path (eye step, brow+lid band, stability gate) is forge-expressions.test.ts's.
  const deps: ForgeDeps = { env: { SR_PLANE: "live", SR_FORGE_EYES: "off" }, gemini: () => client, quota, store: () => live.store, replay: { post: async () => new Response(), get: async () => new Response() }, now: () => (clock += 61_000) };
  return { deps, prompts, live };
}

async function forge(deps: ForgeDeps): Promise<JobView> {
  const res = await handleForgePost(new Request("https://sr.test/api/forge", { method: "POST", body: JSON.stringify({ mode: "prompt", prompt: "lich" }), headers: { "x-real-ip": "198.51.100.9" } }), deps);
  expect(res.status).toBe(202);
  const { jobId } = (await res.json()) as { jobId: string };
  for (let i = 0; i < 18; i++) {
    const view = (await (await handleForgeGet(new Request(`https://sr.test/api/forge/${jobId}`), deps)).json()) as JobView;
    if (view.status === "done" || view.status === "failed") return view;
  }
  throw new Error("job did not finish");
}

beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("network access in a test");
  });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("live forge: the rig owns the mouth", () => {
  it("a live-forged character (fake image model, KV/Blob hops) ends with mouth and with neutral mouths in every face", { timeout: 120_000 }, async () => {
    const { deps, prompts, live } = setup();
    const view = await forge(deps);
    expect(view.status).toBe("done");
    expect(view.expressions).toEqual(Object.fromEntries(EXPRESSION_FAMILIES.map((f) => [f, "ok"])));
    const rig = view.rig as Rig;
    // The mouth was measured at assembly and survived six KV round-trips (JSON + parseForgeJob) and the JobView.
    expect(rig.mouth).toBeDefined();
    const mouth = rig.mouth ?? { cx: 0, lineY: 0, width: 0 };
    expect(mouth.lineY / rig.height).toBeGreaterThan(0.5);
    expect(mouth.lineY / rig.height).toBeLessThan(0.55);
    expect(mouth.cx / rig.width).toBeCloseTo(0.5, 1);
    const stored = parseForgeJob([...live.kv.values()][0] ?? "");
    expect(stored?.rig?.mouth).toEqual(mouth);
    // ...and the rig file a pack carries (serializeRig -> parseRigJson).
    const reread = parseRigJson(serializeRig(rig));
    expect(reread.ok && reread.value.mouth).toEqual(mouth);
    // The edits asked for the upper face only and kept the mouth.
    expect(prompts).toHaveLength(EXPRESSION_FAMILIES.length);
    // face-control's strict frame keeps the mouth with the face's structure.
    for (const prompt of prompts) expect(prompt).toContain("mouth, lips and jaw, neutral and at rest; do not open, smile, snarl, purse or move the mouth");

    const image = (file: string): Rgba => {
      const url = view.assets?.[file];
      const bytes = url === undefined ? undefined : live.blobs.get(url);
      if (bytes === undefined) throw new Error(`no asset ${file}`);
      return decoded(bytes);
    };
    const at = (img: Rgba, [bx, by]: readonly number[], x: number, y: number): number[] => {
      const i = ((y - (by ?? 0)) * img.width + (x - (bx ?? 0))) * 4;
      return [img.data[i] ?? 0, img.data[i + 1] ?? 0, img.data[i + 2] ?? 0, img.data[i + 3] ?? 0];
    };
    const inBox = ([bx, by, bw, bh]: readonly number[], x: number, y: number) => x >= (bx ?? 0) && y >= (by ?? 0) && x < (bx ?? 0) + (bw ?? 0) && y < (by ?? 0) + (bh ?? 0);
    const [my0, mx0, my1, mx1] = MOUTH_BOX.map((v) => Math.round((v * rig.width) / 1000)) as [number, number, number, number];

    // Every head/jaw face, at every pixel the edit repainted that lies wholly inside the mouth region,
    // shows the base layer's pixel: the grin was taken back out. The eyes still took the edit.
    let checked = 0;
    const mouthLayers = rig.layers.filter((l): l is Layer => l.kind === "head" || l.kind === "jaw");
    expect(mouthLayers.some((l) => l.kind === "jaw")).toBe(true);
    for (const layer of mouthLayers) {
      const base = image(layer.file);
      for (const family of EXPRESSION_FAMILIES) {
        const patch = layer.variants?.[family];
        if (patch === undefined) continue;
        const face = image(patch.file);
        for (let y = my0; y < my1; y++) {
          for (let x = mx0; x < mx1; x++) {
            if (!inBox(patch.bbox, x, y) || !inBox(layer.bbox, x, y) || mouthWeight(mouth, x + 0.5, y + 0.5) < 1) continue;
            const want = at(base, layer.bbox, x, y);
            if ((want[3] ?? 0) === 0) continue;
            expect(at(face, patch.bbox, x, y).slice(0, 3), `${layer.name}.${family} at (${x}, ${y})`).toEqual(want.slice(0, 3));
            checked++;
          }
        }
      }
    }
    for (const eye of rig.layers.filter((l) => l.kind === "eye")) expect(Object.keys(eye.variants ?? {}).sort()).toEqual([...EXPRESSION_FAMILIES].sort());
    expect(checked, "head/jaw face pixels compared inside the mouth region").toBeGreaterThan(100);

    // The control: the same cut on the rig without `mouth` keeps the repainted grin in the head/jaw faces,
    // so the comparison above is a real one (reset on: base pixels; reset off: the grin).
    const bases = new Map(rig.layers.filter((l) => l.kind === "head" || l.kind === "eye" || l.kind === "jaw" || isBrowLayer(l.name)).map((l) => [l.name, image(l.file)]));
    const bare: Rig = { ...rig };
    delete bare.mouth;
    const loose = cutVariants(bare, bases, decoded(PORTRAIT.data), decoded(editedFace(70).data), "joy");
    let grins = 0;
    for (const layer of mouthLayers) {
      const cut = loose.patches[layer.name];
      const base = bases.get(layer.name);
      if (cut === undefined || base === undefined) continue;
      for (let y = my0; y < my1; y++) {
        for (let x = mx0; x < mx1; x++) {
          if (!inBox(cut.patch.bbox, x, y) || !inBox(layer.bbox, x, y) || mouthWeight(mouth, x + 0.5, y + 0.5) < 1) continue;
          const want = at(base, layer.bbox, x, y);
          if ((want[3] ?? 0) !== 0 && at(cut.image, cut.patch.bbox, x, y).slice(0, 3).join() !== want.slice(0, 3).join()) grins++;
        }
      }
    }
    expect(grins, "without mouth the grin reaches the head/jaw faces").toBeGreaterThan(100);
  });
});
