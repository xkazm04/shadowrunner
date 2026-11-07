// forge-creator C1, faces paint in: the rule for folding a later forge view into the character the
// rite already woke. Once awake the rig's structure is final; later views may only add expression
// patches (`Layer.variants`) and their files. Pure, no DOM.
//
// - `isAdditive(a, b)`: b keeps every rig field and every layer of a, in order and unchanged except
//   `variants`; every patch a has is in b unchanged; each new patch names files a never named.
// - `mergeFaces(a, b)`: b (with a's asset URLs kept for a's files) when b is an additive extension
//   of a, passes `validateRig` and has a URL for every layer file; otherwise a, untouched.
import { validateRig, type Layer, type Rig } from "@sr/rig";
import { rigFiles } from "../library/assets";

export interface Woken {
  rig: Rig;
  assets: Readonly<Record<string, string>>;
}

type Fields = Record<string, unknown>;
const isRecord = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);

/** Structural equality of JSON-shaped values (key order ignored; an `undefined` field counts as absent). */
export function same(x: unknown, y: unknown): boolean {
  if (x === y) return true;
  if (Array.isArray(x) || Array.isArray(y)) {
    return Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((v, i) => same(v, y[i]));
  }
  if (!isRecord(x) || !isRecord(y)) return false;
  const keys = (o: Fields): string[] => Object.keys(o).filter((k) => o[k] !== undefined);
  const kx = keys(x);
  return kx.length === keys(y).length && kx.every((k) => same(x[k], y[k]));
}

function withoutVariants(layer: Layer): Fields {
  return Object.fromEntries(Object.entries(layer).filter(([key]) => key !== "variants"));
}

/** True when `b` is `a` plus expression patches only (see the header). */
export function isAdditive(a: Rig, b: Rig): boolean {
  const { layers: la, ...ra } = a;
  const { layers: lb, ...rb } = b;
  if (!same(ra, rb) || la.length !== lb.length) return false;
  const known = new Set(rigFiles(a));
  for (let i = 0; i < la.length; i += 1) {
    const x = la[i];
    const y = lb[i];
    if (x === undefined || y === undefined || !same(withoutVariants(x), withoutVariants(y))) return false;
    const vx = x.variants ?? {};
    const vy = y.variants ?? {};
    for (const [family, patch] of Object.entries(vx)) {
      if (!same(patch, vy[family as keyof typeof vy])) return false;
    }
    for (const [family, patch] of Object.entries(vy)) {
      if (vx[family as keyof typeof vx] !== undefined) continue;
      if (known.has(patch.file) || (patch.socket !== undefined && known.has(patch.socket))) return false;
    }
  }
  return true;
}

/** The character after a later view (see the header): `b` when it only adds faces, else `a`. */
export function mergeFaces(a: Woken, b: Woken): Woken {
  if (a.rig === b.rig && a.assets === b.assets) return a;
  if (!isAdditive(a.rig, b.rig)) return a;
  const checked = validateRig(b.rig);
  if (!checked.ok || checked.value.layers.some((l) => b.assets[l.file] === undefined)) return a;
  if (same(a.rig, checked.value)) return a;
  return { rig: checked.value, assets: { ...b.assets, ...a.assets } };
}

/** The files `next` names that `prev` did not: the only ones to fetch after a merge. */
export function newFiles(prev: Rig, next: Rig): string[] {
  const known = new Set(rigFiles(prev));
  return rigFiles(next).filter((f) => !known.has(f));
}
