// The glass pick as React state (character-control "Glass pick"): decodes the record's images on
// the first click (once per file), finds the part and region under the click, and holds that
// region's outline on the glass for `OUTLINE_MS`. Outlines are cached per layer and slot.
import type { Look } from "@sr/rig";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CharacterRecord } from "../library/libraryStore";
import type { GlassOutline } from "./Glass";
import { outlineMatrix, outlineOf, pickAt, restPoses, type Outline, type Picked, type Pixels } from "./pick";
import type { Point } from "./pins";
import type { PixelReader } from "./pixels";

/** How long a picked region stays outlined. */
export const OUTLINE_MS = 1200;

const REDUCE = "(prefers-reduced-motion: reduce)";

/** Reduced motion, by the viewer's setting or the page's motion toggle. */
export function reducedMotion(): boolean {
  if (typeof window.matchMedia === "function" && window.matchMedia(REDUCE).matches) return true;
  return document.querySelector('[data-motion="reduced"]') !== null;
}

export interface GlassPick {
  outline?: GlassOutline;
  /** Picks at `point` (rig px); resolves to what was hit, after outlining it. */
  pick(point: Point): Promise<Picked | undefined>;
}

export function usePick(record: CharacterRecord, look: Look, read: PixelReader): GlassPick {
  const pixels = useRef(new Map<string, Pixels | null>());
  const outlines = useRef(new Map<string, Outline>());
  const [outline, setOutline] = useState<GlassOutline | undefined>(undefined);
  const latest = useRef({ record, look, read });
  useEffect(() => {
    latest.current = { record, look, read };
  });

  useEffect(() => {
    if (outline === undefined) return undefined;
    const timer = setTimeout(() => setOutline(undefined), OUTLINE_MS);
    return () => clearTimeout(timer);
  }, [outline]);

  const pick = useCallback(async (point: Point): Promise<Picked | undefined> => {
    const { record: rec, look: now, read: reader } = latest.current;
    const files = rec.rig.layers.filter((l) => l.kind !== "static").flatMap((l) => [l.file, ...(l.regions === undefined ? [] : [l.regions.map])]);
    await Promise.all(
      files.map(async (file) => {
        if (pixels.current.has(file)) return;
        const blob = rec.assets[file];
        pixels.current.set(file, blob === undefined ? null : ((await reader(file, blob).catch(() => undefined)) ?? null));
      }),
    );
    const of = (file: string): Pixels | undefined => pixels.current.get(file) ?? undefined;
    const poses = restPoses(rec.rig, now);
    const hit = pickAt(rec.rig, poses, point, of);
    if (hit === undefined) return undefined;
    const layer = rec.rig.layers.find((l) => l.name === hit.layer);
    const pose = poses.find((p) => p.name === hit.layer);
    if (layer !== undefined && pose !== undefined) {
      const key = `${hit.layer}/${hit.slot ?? ""}`;
      const traced = outlines.current.get(key) ?? outlineOf(layer, hit.slot, of);
      if (traced !== undefined) {
        outlines.current.set(key, traced);
        setOutline((o) => ({ n: (o?.n ?? 0) + 1, d: traced.d, transform: outlineMatrix(rec.rig, layer, pose, traced), steady: reducedMotion() }));
      }
    }
    return hit;
  }, []);

  return outline === undefined ? { pick } : { outline, pick };
}
