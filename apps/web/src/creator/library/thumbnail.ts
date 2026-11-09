// The library strip's still of a character (perfection-pass task 9, requirement 9.1), kept on the
// record (`CharacterRecord.thumb`, keyed by library/thumbKey.ts) so a reload draws nothing.
// - Drawn as the app draws a still: the face at rest (pick.ts REST_DRIVE, the glass pick's pose)
//   posed by `poseLayers` with the look's face profile, through the canvas2D renderer, which
//   applies the look's lights and region colours, its hidden parts and its reshape. The GL-only
//   rim light and glow pass are not in a still (the canvas2D fallback skips them too).
// - Each image is decoded at the size it is drawn in the still (a few dozen px, not the art's
//   1024), maps and masks nearest-neighbour so their indices stay exact. Only what the still draws
//   is decoded: the shown layers first; a region map, socket mask or face patch the renderer asks
//   for is decoded on its ask and the still drawn again (at most three passes).
// - `thumbQueue` makes them one at a time, off the input path: a record with no still soon (a
//   timer), a record whose look changed (a save) in an idle callback, so a drag never waits on one.
//   A key that could not be drawn (no canvas, as in tests) is not tried again.
// - Undefined where the browser cannot decode or draw; the strip then shows the initial.
import { createCanvas2dRenderer, createMouthState, mouthMode, type FrameClock, type RigAssets } from "@sr/avatar";
import { faceOf, poseLayers, type Rig } from "@sr/rig";
import { REST_DRIVE } from "../glass/pick";
import type { CharacterRecord } from "./libraryStore";
import { thumbIsCurrent, thumbKey, type Thumb } from "./thumbKey";

export const THUMB_PX = 160;

type Decoded = ImageBitmap | HTMLImageElement;

export interface ThumbDeps {
  /** `blob` decoded at w x h px (nearest-neighbour when `exact`). */
  decode(blob: Blob, w: number, h: number, exact: boolean): Promise<Decoded>;
  /** A square canvas `size` px a side, or undefined. */
  canvas(size: number): HTMLCanvasElement | undefined;
  encode(canvas: HTMLCanvasElement): Promise<Blob | undefined>;
}

export const browserThumbDeps: ThumbDeps = {
  decode: (blob, w, h, exact) => createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: exact ? "pixelated" : "high", premultiplyAlpha: "premultiply" }),
  canvas: (size) => {
    if (typeof document === "undefined" || typeof createImageBitmap !== "function") return undefined;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    return canvas;
  },
  encode: (canvas) => new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? undefined), "image/webp", 0.85)),
};

/** The box `file` is drawn over (rig px) and whether it holds indices or a mask (decoded exactly). */
function boxOf(rig: Rig, file: string): { bbox: readonly number[]; exact: boolean } | undefined {
  for (const layer of rig.layers) {
    if (layer.file === file || layer.closed === file) return { bbox: layer.bbox, exact: false };
    if (layer.regions?.map === file || layer.socket === file) return { bbox: layer.bbox, exact: true };
    for (const patch of Object.values(layer.variants ?? {})) {
      if (patch.file === file) return { bbox: patch.bbox, exact: false };
      if (patch.socket === file) return { bbox: patch.bbox, exact: true };
    }
  }
  return undefined;
}

/** The record's still at rest in its look, or undefined when it cannot be drawn here. */
export async function renderThumb(record: CharacterRecord, deps: ThumbDeps = browserThumbDeps, size = THUMB_PX): Promise<Thumb | undefined> {
  const { rig, look } = record;
  const canvas = deps.canvas(size);
  const ctx = canvas?.getContext("2d") ?? null;
  if (canvas === undefined || ctx === null) return undefined;
  const scale = size / Math.max(rig.width, rig.height);
  const decoded: Decoded[] = [];
  const decode = async (file: string): Promise<Decoded> => {
    const blob = record.assets[file];
    const box = boxOf(rig, file);
    if (blob === undefined || box === undefined) throw new Error(`no image for ${file}`);
    const px = (v: number | undefined): number => Math.max(1, Math.ceil((v ?? 1) * scale));
    const image = await deps.decode(blob, px(box.bbox[2]), px(box.bbox[3]), box.exact);
    decoded.push(image);
    return image;
  };
  const face = faceOf(rig, look);
  const poses = poseLayers(rig, look, REST_DRIVE, { face });
  const shown = new Set(poses.map((p) => p.name));
  const assets: RigAssets = {};
  try {
    const files = [...new Set(rig.layers.filter((l) => shown.has(l.name)).map((l) => l.file))];
    await Promise.all(files.map(async (file) => (assets[file] = await decode(file))));
    const asked: Promise<unknown>[] = [];
    const loadAsset = (file: string): Promise<Decoded> => {
      const image = decode(file);
      asked.push(image);
      return image;
    };
    const renderer = createCanvas2dRenderer(canvas, ctx, rig, assets, { loadAsset });
    const mouth = mouthMode(rig.mouth) === "drawn" ? createMouthState()({ emotion: look.emotion, level: 0, reducedMotion: true, dt: 0, emotionStrength: face.mouth.emotion }).pose : undefined;
    const clock: FrameClock = { t: 0, reducedMotion: true, ...(mouth === undefined ? {} : { mouth }) };
    for (let pass = 0; pass < 3; pass += 1) {
      renderer.draw(poses, look, clock);
      if (asked.length === 0) break;
      await Promise.allSettled(asked.splice(0));
    }
    renderer.dispose();
    const blob = await deps.encode(canvas);
    return blob === undefined ? undefined : { blob, key: thumbKey(record) };
  } catch {
    return undefined;
  } finally {
    for (const image of decoded) if ("close" in image) image.close();
  }
}

const urls = new Map<string, { blob: Blob; url: string }>();

/** An object URL of a record's still, one per Blob; the record's previous one is revoked. */
export function thumbUrl(id: string, blob: Blob): string | undefined {
  const known = urls.get(id);
  if (known?.blob === blob) return known.url;
  if (typeof URL.createObjectURL !== "function") return undefined;
  if (known !== undefined) URL.revokeObjectURL(known.url);
  const url = URL.createObjectURL(blob);
  urls.set(id, { blob, url });
  return url;
}

export type Scheduler = (run: () => void, soon: boolean) => void;

/** Soon: a timer; otherwise when the main thread is idle (a timer where there is no idle callback). */
export const whenIdle: Scheduler = (run, soon) => {
  if (!soon && typeof requestIdleCallback === "function") requestIdleCallback(() => run(), { timeout: 2000 });
  else setTimeout(run, soon ? 0 : 200);
};

export interface ThumbQueue {
  /** Makes the record's still unless it has a current one; the latest record per id wins. */
  want(record: CharacterRecord): void;
  /** Drops what is queued; a still being made is not reported. */
  stop(): void;
}

export function thumbQueue(
  onThumb: (id: string, thumb: Thumb) => Promise<void> | void,
  { make = (r: CharacterRecord) => renderThumb(r), schedule = whenIdle }: { make?: (record: CharacterRecord) => Promise<Thumb | undefined>; schedule?: Scheduler } = {},
): ThumbQueue {
  const pending = new Map<string, CharacterRecord>();
  const failed = new Set<string>();
  let making: string | undefined;
  let scheduled = false;
  let alive = true;

  const kick = (): void => {
    if (scheduled || making !== undefined || pending.size === 0 || !alive) return;
    scheduled = true;
    const soon = [...pending.values()].some((r) => r.thumb === undefined);
    schedule(() => void run(), soon);
  };

  const run = async (): Promise<void> => {
    scheduled = false;
    const next = [...pending.values()].find((r) => r.thumb === undefined) ?? pending.values().next().value;
    if (next === undefined || !alive) return;
    pending.delete(next.id);
    const key = thumbKey(next);
    making = key;
    try {
      const thumb = await make(next);
      if (thumb === undefined) failed.add(key);
      else if (alive) await onThumb(next.id, thumb);
    } catch {
      failed.add(key);
    } finally {
      making = undefined;
      kick();
    }
  };

  return {
    want(record) {
      const key = thumbKey(record);
      if (thumbIsCurrent(record) || failed.has(key) || making === key) {
        pending.delete(record.id);
        return;
      }
      pending.set(record.id, record);
      kick();
    },
    stop() {
      alive = false;
      pending.clear();
    },
  };
}
