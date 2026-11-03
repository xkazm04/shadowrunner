// Live decomposition from an approved brief (cast-forge requirement 4.4, task 11; design.md
// "Live decomposition from the brief"). The parts model answers `partsPromptFromBrief`; before the
// answer meets `parseParts` it is settled against the brief (`settleBriefParts`): the brief's
// names, roles and follows win, every motion number is clamped into the rig's validated ranges,
// fields a role may not carry are dropped, and a part whose brief words say it moves but whose
// answer gave no readable motion gets motion from its words (`motionFromWords`). Polygons are never
// repaired: a bad outline fails the answer and the step re-asks. Pure, no I/O, never JSON.parses.
import {
  type FloatMotion,
  FLOAT_ROT_MAX_DEG,
  JAW_DROP_MAX,
  JAW_DROP_MIN,
  type Motion,
  MOTION_FREQ_MAX,
  MOTION_FREQ_MIN,
  PULSE_AMP_MAX,
  type PulseMotion,
  phaseFromName,
} from "@sr/rig";
import { PLATE_ROLES, isLifted } from "./named.js";
import { COORD_MAX } from "./parts.js";
import { fillPrompt } from "./prompts.js";
import type { NamedPart, PartRole } from "./types.js";
import type { CharacterBrief } from "./wire.js";

/** Float amplitude cap for a live answer, MOTION_CANVAS px (the rig allows 0.05 x 1024 = 51.2). */
export const LIVE_AMP_MAX = 50;

type Fields = Record<string, unknown>;
const isRecord = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
/** A phase as a fraction of a cycle in [0, 1); 1.25 cycles is 0.25. */
const cycle = (v: number): number => {
  const f = v - Math.floor(v);
  return f >= 1 ? 0 : f;
};
const EYE_ROLES: readonly PartRole[] = ["eye", "eye_l", "eye_r"];
const HEX = /^#[0-9a-fA-F]{6}$/;

function phaseOf(fields: Fields): { phase?: number } {
  const phase = num(fields.phase);
  return phase === undefined ? {} : { phase: cycle(phase) };
}

/** One float curve clamped into range, or undefined when it has no readable amp and freq. */
function settleFloat(v: unknown): FloatMotion | undefined {
  if (!isRecord(v) || !Array.isArray(v.amp) || v.amp.length !== 2) return undefined;
  const ax = num(v.amp[0]);
  const ay = num(v.amp[1]);
  const freq = num(v.freq);
  if (ax === undefined || ay === undefined || freq === undefined) return undefined;
  const rot = num(v.rot_deg);
  return {
    amp: [clamp(Math.abs(ax), 0, LIVE_AMP_MAX), clamp(Math.abs(ay), 0, LIVE_AMP_MAX)],
    freq: clamp(freq, MOTION_FREQ_MIN, MOTION_FREQ_MAX),
    ...(rot === undefined ? {} : { rot_deg: clamp(Math.abs(rot), 0, FLOAT_ROT_MAX_DEG) }),
    ...phaseOf(v),
  };
}

function settlePulse(v: unknown): PulseMotion | undefined {
  if (!isRecord(v)) return undefined;
  const amp = num(v.amp);
  const freq = num(v.freq);
  if (amp === undefined || freq === undefined) return undefined;
  return { amp: clamp(Math.abs(amp), 0, PULSE_AMP_MAX), freq: clamp(freq, MOTION_FREQ_MIN, MOTION_FREQ_MAX), ...phaseOf(v) };
}

/** A decoded motion clamped into the rig's ranges; a blink kept on an eye role only. */
export function settleMotion(v: unknown, role: PartRole): Motion | undefined {
  if (!isRecord(v)) return undefined;
  const float = settleFloat(v.float);
  const pulse = settlePulse(v.pulse);
  const blinkFreq = isRecord(v.blink) ? num(v.blink.freq) : undefined;
  const blink = isRecord(v.blink) && blinkFreq !== undefined && EYE_ROLES.includes(role) ? { freq: clamp(blinkFreq, MOTION_FREQ_MIN, MOTION_FREQ_MAX), ...phaseOf(v.blink) } : undefined;
  if (float === undefined && pulse === undefined && blink === undefined) return undefined;
  return { ...(float === undefined ? {} : { float }), ...(pulse === undefined ? {} : { pulse }), ...(blink === undefined ? {} : { blink }) };
}

const EVENT_WORDS = /\b(when|whenever|each time|every time|toward|towards|as soon as|until)\b/;
const PULSE_WORDS = /\b(puls|glow|throb|beat|flicker|flare|shimmer|gleam|bright|light|blaz|smoulder|smolder)/;
const SWAY_WORDS = /\b(sway|swing|pendul|wag|nod|tilt|rock|spin|turn|tick|twitch|wave|wiggle|writh|coil|lash)/;
const FLOAT_WORDS = /\b(float|bob|drift|hover|orbit|bounc|breath|rise|lift|levitat|wobbl|jitter|rattl|quiver)/;
const BLINK_WORDS = /\b(blink|wink|narrow|squint)/;

/** A frequency spread 0.85x-1.15x by the part's name, so siblings with the same words differ. */
const spread = (name: string, hz: number): number => Math.round(hz * (0.85 + 0.3 * phaseFromName(`${name}#freq`)) * 1000) / 1000;

/**
 * Safe default motion for a lifted part from its brief words (design.md: a deterministic mapping,
 * used only when the parts model gave no readable motion). Pulse words give a pulse (a flicker
 * faster), sway words a rotation about the pivot, float words a gentle bob, blink words an own blink
 * on an eye. Plate roles (head, torso) get none: the stage moves them. A clause about an event
 * ("when chat ...", "toward the speaker") is not motion. Phases come from the name (`motionOf`), so none is set here.
 */
export function motionFromWords(name: string, role: PartRole, words: string | undefined): Motion | undefined {
  if (words === undefined || role === "head" || role === "torso") return undefined;
  // A clause about an event ("turns toward the speaker", "floods when a vow is kept") is not motion.
  const w = words.toLowerCase().split(/[;,.]/).filter((clause) => !EVENT_WORDS.test(clause)).join(" ");
  const out: Motion = {};
  if (PULSE_WORDS.test(w)) out.pulse = { amp: 0.5, freq: spread(name, /flicker|jitter/.test(w) ? 1.3 : /beat|throb/.test(w) ? 1.1 : 0.5) };
  if (SWAY_WORDS.test(w)) out.float = { amp: [0, 0], freq: spread(name, 0.3), rot_deg: 4 };
  else if (FLOAT_WORDS.test(w)) out.float = { amp: [1.5, 4], freq: spread(name, 0.3), rot_deg: 1.5 };
  if (BLINK_WORDS.test(w) && EYE_ROLES.includes(role)) out.blink = { freq: spread(name, 0.2) };
  return Object.keys(out).length === 0 ? undefined : out;
}

export interface SettledParts {
  /** The answer, settled: hand it to `parseParts`. */
  value: unknown;
  /** What was changed, for the job log: counts and rules, never upstream text. */
  notes: string[];
}

/** The role-gated fields of one answered part, kept only where the role allows and the value reads. */
function roleFields(raw: Fields, role: PartRole): Fields {
  const out: Fields = {};
  const jaw = role === "jaw";
  const lifted = !PLATE_ROLES.includes(role);
  if (typeof raw.key === "boolean") out.key = raw.key;
  if (typeof raw.emissive === "boolean") out.emissive = raw.emissive;
  const drop = num(raw.drop);
  if (jaw && drop !== undefined) out.drop = clamp(drop, JAW_DROP_MIN, JAW_DROP_MAX);
  const cavity = raw.cavity === "paint" || raw.cavity === "fill" || raw.cavity === "gap" ? raw.cavity : undefined;
  if (jaw && cavity !== undefined) out.cavity = cavity;
  if (jaw && typeof raw.glow === "string" && HEX.test(raw.glow) && cavity !== "fill") out.glow = raw.glow.toLowerCase();
  if (lifted && (raw.fill === "edit" || raw.fill === "extend")) out.fill = raw.fill;
  if (lifted && raw.matte === "plate") out.matte = "plate";
  if (lifted && Array.isArray(raw.pivot) && raw.pivot.length === 2) {
    const [y, x] = [num(raw.pivot[0]), num(raw.pivot[1])];
    if (y !== undefined && x !== undefined) out.pivot = [Math.round(clamp(y, 0, COORD_MAX)), Math.round(clamp(x, 0, COORD_MAX))];
  }
  return out;
}

/** `cut` with feather rounded into 0..8 and cell into 1..32; unreadable fields dropped. */
function settleCut(v: unknown): Fields | undefined {
  if (!isRecord(v)) return undefined;
  const feather = num(v.feather);
  const cell = num(v.cell);
  const out: Fields = {
    ...(feather === undefined ? {} : { feather: Math.round(clamp(feather, 0, 8)) }),
    ...(cell === undefined ? {} : { cell: Math.round(clamp(cell, 1, 32)) }),
  };
  return Object.keys(out).length === 0 ? undefined : out;
}

/**
 * A decoded parts answer settled against the approved brief (design.md "Live decomposition from the
 * brief"). The answer may be `{ version: 2, parts, cut? }` or a bare parts array. Kept: answered
 * parts whose name the brief plans (others are dropped, counted in a note), each with the brief's
 * role, the brief's follow (else the answer's, when it names another kept part), box_2d and poly as
 * answered, motion clamped (`settleMotion`) or from the brief's words (`motionFromWords`), and the
 * role-gated fields (`roleFields`). Anything unreadable is passed through for `parseParts` to refuse.
 */
export function settleBriefParts(decoded: unknown, brief: CharacterBrief): SettledParts {
  const list = Array.isArray(decoded) ? decoded : isRecord(decoded) ? decoded.parts : undefined;
  if (!Array.isArray(list)) return { value: decoded, notes: [] };
  const plan = new Map(brief.parts.map((p) => [p.name, p]));
  const answered = list.filter((raw: unknown): raw is Fields => isRecord(raw) && typeof raw.name === "string" && plan.has(raw.name));
  const kept = new Set(answered.map((raw) => String(raw.name)));
  const notes: string[] = [];
  const dropped = list.length - answered.length;
  if (dropped > 0) notes.push(`dropped ${dropped} part(s) the brief does not plan`);
  let fromWords = 0;
  let clamped = 0;
  const parts = answered.map((raw) => {
    const name = String(raw.name);
    const planned = plan.get(name);
    const role = planned?.role ?? "accessory";
    const follow = planned?.follow ?? (typeof raw.follow === "string" && raw.follow !== name && kept.has(raw.follow) ? raw.follow : undefined);
    let motion = settleMotion(raw.motion, role);
    if (motion !== undefined && JSON.stringify(motion) !== JSON.stringify(raw.motion)) clamped += 1;
    if (motion === undefined) {
      motion = motionFromWords(name, role, planned?.motion);
      if (motion !== undefined) fromWords += 1;
    }
    return {
      name,
      role,
      box_2d: raw.box_2d,
      poly: raw.poly,
      ...(follow === undefined ? {} : { follow }),
      ...(motion === undefined ? {} : { motion }),
      ...roleFields(raw, role),
    };
  });
  if (clamped > 0) notes.push(`settled the motion of ${clamped} part(s) into range`);
  if (fromWords > 0) notes.push(`motion from the brief's words for ${fromWords} part(s)`);
  const cut = isRecord(decoded) ? settleCut(decoded.cut) : undefined;
  return { value: { version: 2, parts, ...(cut === undefined ? {} : { cut }) }, notes };
}

/** An eye's phrase in the fill edit asks for shut lids, so a squashed eye reads as closing. */
export const CLOSED_EYE = "(paint closed eyelids where they were)";

/**
 * The fill edit for named parts (design.md): `fillPrompt` over the lifted parts the edit paints
 * (not `fill: "extend"`), in file order, each named by the brief's `what` (its name in words when
 * the brief has none), an eye's followed by CLOSED_EYE. Undefined when no part needs the edit.
 */
export function fillPromptFromBrief(parts: readonly NamedPart[], brief: CharacterBrief | undefined): string | undefined {
  const what = new Map((brief?.parts ?? []).map((p) => [p.name, p.what]));
  const phrases = parts
    .filter((p) => isLifted(p) && p.fill !== "extend")
    .map((p) => {
      const words = what.get(p.name) ?? p.name.replaceAll("_", " ");
      return EYE_ROLES.includes(p.role) ? `${words} ${CLOSED_EYE}` : words;
    });
  return phrases.length === 0 ? undefined : fillPrompt(phrases);
}
