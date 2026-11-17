// forge-pkg B, the cast forecast: what each provisional draft becomes once the streamer pays for it,
// computed for free from the cut. Eyes: `socketEyes` on the provisional rig with no edit (the live eye
// step's fallback, forge-eyes.ts) tells which eyes get an iris layer and follow chat; the iris-free
// edit only adds eyes, so the count is a floor ("at least N eyes follow chat"). Acts: `actsFromParts`
// against the cut's non-empty layers tells which of the brief's signature acts fire and which are
// lost for want of a layer. `recommendDraft` names one cut draft, or none on a tie; the streamer still
// chooses. Replay derives the forecast from a recorded rig's iris layers and acts (`rigForecast`).
// Pure; `castForecast` reads pixels, everything else is browser-safe.
import type { Rig } from "@sr/rig";
import { actsFromParts } from "./briefActs.js";
import { socketEyes } from "./faceEyes.js";
import type { PartRole, Rgba } from "./types.js";
import type { CastCandidateView, CastForecast } from "./wire.js";

/** What the forecast needs of a brief: its parts' names, roles and motion words. */
export interface ForecastBrief {
  parts: readonly { name: string; role: PartRole; motion?: string }[];
}

const hasPixels = (image: Rgba | undefined): boolean => {
  if (image === undefined) return false;
  for (let i = 3; i < image.data.length; i += 4) if ((image.data[i] ?? 0) > 0) return true;
  return false;
};

/** The forecast of a cut draft: its provisional rig, the layers' pixels by file, and its brief. */
export function castForecast(rig: Rig, images: Readonly<Record<string, Rgba>>, brief: ForecastBrief): CastForecast {
  let socketed = new Set<string>();
  try {
    socketed = new Set(socketEyes(rig, images).eyes.map((e) => e.name));
  } catch {
    // An eye the reader trips on is an eye that stays painted.
  }
  const eyes = rig.layers.filter((l) => l.kind === "eye").map((l) => l.name);
  const land: string[] = [];
  const lost: string[] = [];
  const cues: [string, string[]][] = [];
  for (const [name, act] of actsFromParts(brief.parts)) {
    const layer = rig.layers.find((l) => l.name === name);
    if (layer !== undefined && hasPixels(images[layer.file])) {
      land.push(name);
      cues.push([name, [...act.cue]]);
    } else lost.push(name);
  }
  return {
    eyes: { follow: eyes.filter((n) => socketed.has(n)), painted: eyes.filter((n) => !socketed.has(n)) },
    acts: { land, lost, cues: Object.fromEntries(cues) },
  };
}

/** Replay: the forecast a recorded rig carries (no pixels): eyes an iris layer follows, layers with an act. */
export function rigForecast(rig: Rig): CastForecast {
  const followed = new Set(rig.layers.filter((l) => l.kind === "iris" && l.follow !== undefined).map((l) => l.follow));
  const eyes = rig.layers.filter((l) => l.kind === "eye").map((l) => l.name);
  const acted = rig.layers.flatMap((l) => (l.act === undefined ? [] : [[l.name, [...l.act.cue]] as [string, string[]]]));
  return {
    eyes: { follow: eyes.filter((n) => followed.has(n)), painted: eyes.filter((n) => !followed.has(n)) },
    acts: { land: acted.map(([n]) => n), lost: [], cues: Object.fromEntries(acted) },
  };
}

type Fields = Record<string, unknown>;
const isRecord = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

/** A forecast read back (store record or wire); undefined when off-contract (the reader drops it, not the slot). */
export function readCastForecast(v: unknown): CastForecast | undefined {
  if (!isRecord(v) || !isRecord(v.eyes) || !isRecord(v.acts)) return undefined;
  const { follow, painted } = v.eyes;
  const { land, lost, cues } = v.acts;
  if (!strings(follow) || !strings(painted) || !strings(land) || !strings(lost) || !isRecord(cues)) return undefined;
  const read: [string, string[]][] = [];
  for (const [name, words] of Object.entries(cues)) {
    if (!strings(words)) return undefined;
    read.push([name, [...words]]);
  }
  return { eyes: { follow: [...follow], painted: [...painted] }, acts: { land: [...land], lost: [...lost], cues: Object.fromEntries(read) } };
}

const cuesOf = (f: CastForecast, name: string): string[] => (Object.hasOwn(f.acts.cues, name) ? (f.acts.cues[name] ?? []) : []);
const spaced = (names: readonly string[]): string => names.map((n) => n.replaceAll("_", " ")).join(", ");

/** The forecast in words, one line per fact, for the cast sheet. */
export function forecastLines(f: CastForecast): string[] {
  const lines: string[] = [];
  const total = f.eyes.follow.length + f.eyes.painted.length;
  if (f.eyes.follow.length > 0) lines.push(`At least ${f.eyes.follow.length} of ${total} eyes follow chat.`);
  else if (total > 0) lines.push(`No eye is sure to follow chat; ${spaced(f.eyes.painted)} may stay painted.`);
  if (f.acts.land.length > 0) {
    const acts = f.acts.land.map((n) => {
      const cue = cuesOf(f, n);
      return cue.length === 0 ? n : `${n} on ${cue.map((w) => `"${w}"`).join(" or ")}`;
    });
    lines.push(`Acts that land: ${acts.join(", ")}.`);
  }
  if (f.acts.lost.length > 0) lines.push(`Acts with no layer to land on: ${f.acts.lost.join(", ")}.`);
  return lines;
}

/** A draft's standing: more eyes that follow, then fewer lost acts, then more landing acts. */
const score = (f: CastForecast): [number, number, number] => [f.eyes.follow.length, -f.acts.lost.length, f.acts.land.length];
const compare = (a: CastForecast, b: CastForecast): number => {
  const [x, y] = [score(a), score(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

function reasonOf(f: CastForecast): string {
  const parts: string[] = [];
  const eyes = f.eyes.follow.length + f.eyes.painted.length;
  if (f.eyes.follow.length > 0) parts.push(f.eyes.painted.length === 0 ? "eyes follow chat" : `${f.eyes.follow.length} of ${eyes} eyes follow chat`);
  const acts = f.acts.land.length + f.acts.lost.length;
  if (f.acts.land.length > 0) parts.push(f.acts.lost.length === 0 ? "every act lands" : `${f.acts.land.length} of ${acts} acts land`);
  else if (acts === 0 && parts.length === 0) parts.push("the clearest cut");
  return parts.join(", ");
}

/**
 * The draft to recommend: the one forecast strictly ahead of every other, when its slot is cut.
 * Undefined on a tie, with fewer than two forecasts to compare, or when the best is not a cut draft.
 */
export function recommendDraft(forecasts: readonly (CastForecast | undefined)[], slots: readonly Pick<CastCandidateView, "state">[]): { index: number; reason: string } | undefined {
  const known = forecasts.flatMap((f, index) => (f === undefined ? [] : [{ f, index }]));
  if (known.length < 2) return undefined;
  const best = known.reduce((a, b) => (compare(b.f, a.f) > 0 ? b : a));
  if (known.some((k) => k.index !== best.index && compare(k.f, best.f) === 0)) return undefined;
  if (slots[best.index]?.state !== "cut") return undefined;
  return { index: best.index, reason: reasonOf(best.f) };
}
