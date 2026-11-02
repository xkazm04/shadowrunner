// The character brief (cast-forge requirement 4, design.md "Brief and handshake"): the exact
// BRIEF_PROMPT, `parseBrief` (an already-decoded model answer -> CharacterBrief, every field and
// range checked; it never JSON.parses, validate.ts does), the portrait prompt built from an
// approved brief, and the adapter that reads the eight recorded contest briefs
// (assets/characters/cast/<slug>/brief.json) as CharacterBriefs for the replay plane.
// Pure and browser-safe: the creator imports it as "@sr/forge/brief" to check the streamer's edits.
// Error messages name the path and the rule, never the offending value.
import { PART_NAME_PATTERN, PART_ROLES, RESERVED_PART_NAMES } from "./parts.js";
import { HOUSE_STYLE } from "./prompts.js";
import type { PartRole } from "./types.js";
import type { BriefPart, CharacterBrief } from "./wire.js";

/** The roles a brief part may take (the creator's role picker). */
export const BRIEF_ROLES: readonly PartRole[] = PART_ROLES;

/** At most this many characters of the streamer's request reach the brief model. */
export const MAX_BRIEF_REQUEST = 400;
export const BRIEF_MIN_PARTS = 6;
export const BRIEF_MAX_PARTS = 16;
export const MAX_PORTRAIT_PROMPT = 900;

/** Length caps per text field (characters, after trimming; every field also needs one character). */
export const BRIEF_LIMITS = {
  name: 60,
  one_line_request: MAX_BRIEF_REQUEST,
  archetype: 120,
  persona_hook: 400,
  silhouette: 300,
  what: 200,
  motion: 160,
  styleName: 60,
  styleWhy: 300,
  portrait_prompt: MAX_PORTRAIT_PROMPT,
} as const;

/** design.md "Brief and handshake", exact; the design's line breaks are joined with single spaces. */
export function BRIEF_PROMPT(request: string): string {
  return `You design an original character to be a live 2.5D streaming co-host. It will be drawn as one portrait and cut into animation layers. From the streamer's request below, return JSON only with the fields name, one_line_request, archetype, persona_hook, accent_hex, secondary_hex, silhouette, parts, style, portrait_prompt. Rules: original fiction, never a real person or an existing character, no text or logos, horror not gore. The portrait is a frontal, centred, symmetrical head-and-shoulders bust on an empty near-black background with the jaw and both eyes visible. parts lists 6 to 16 parts, each a separate shape that does not overlap another, each with a role from head, jaw, eye_l, eye_r, eye, monocle, crown, hat, hair, accessory, torso, float, pulse; always include head, jaw, eyes and torso, and give the character one or two signature parts that float or pulse on their own, saying how they move. Choose a hard-edged graphic art style such as leaded stained glass, low-poly planes, flat poster fills with ink outlines, pixel art or a faceted painting, never soft painterly realism: its edges become the cut lines. portrait_prompt is under 900 characters, describes the character and every part in that style, and ends with the framing rules. Request: ${request.trim().slice(0, MAX_BRIEF_REQUEST)}`;
}

/**
 * Structured-output schema for the brief call (shape only; `parseBrief` checks every range).
 * Sent as `output_config.format`, so the model answers one JSON object.
 */
export const BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "one_line_request", "archetype", "persona_hook", "accent_hex", "silhouette", "parts", "style", "portrait_prompt"],
  properties: {
    name: { type: "string" },
    one_line_request: { type: "string" },
    archetype: { type: "string" },
    persona_hook: { type: "string" },
    accent_hex: { type: "string", description: "#rrggbb" },
    secondary_hex: { type: "string", description: "#rrggbb" },
    silhouette: { type: "string" },
    parts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "role", "what"],
        properties: {
          name: { type: "string", description: "lower case letters, digits and underscores" },
          role: { type: "string", enum: [...PART_ROLES] },
          what: { type: "string" },
          motion: { type: "string" },
          follow: { type: "string", description: "another part's name" },
        },
      },
    },
    style: {
      type: "object",
      additionalProperties: false,
      required: ["name", "why"],
      properties: { name: { type: "string" }, why: { type: "string" } },
    },
    portrait_prompt: { type: "string" },
  },
} as const;

export interface BriefError {
  path: string;
  message: string;
}

export type BriefResult = { ok: true; value: CharacterBrief } | { ok: false; errors: BriefError[] };

type Fields = Record<string, unknown>;
const isRecord = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);
const HEX = /^#[0-9a-fA-F]{6}$/;
const isRole = (v: unknown): v is PartRole => typeof v === "string" && (PART_ROLES as readonly string[]).includes(v);
const EYE_ROLES: readonly PartRole[] = ["eye_l", "eye_r", "eye"];

/**
 * A decoded brief answer -> CharacterBrief, or every rule it breaks. Text is trimmed; hex colours
 * are lower-cased; optional fields are omitted when absent (an empty optional string is an error,
 * never silently dropped). Rules: every text field present and within BRIEF_LIMITS; accent and
 * secondary `#rrggbb`; 6..16 parts with roles from PART_ROLES and unique `[a-z0-9_]` names (not
 * reserved); exactly one head and one jaw, at least one eye and one torso; a follow names another
 * part and the follow chain has no cycle; unknown fields are ignored.
 */
export function parseBrief(value: unknown): BriefResult {
  const errors: BriefError[] = [];
  const err = (path: string, message: string): undefined => {
    errors.push({ path, message });
    return undefined;
  };
  if (!isRecord(value)) return { ok: false, errors: [{ path: "$", message: "is not an object" }] };
  const text = (v: unknown, path: string, max: number): string | undefined => {
    if (typeof v !== "string") return err(path, "must be a string");
    const t = v.trim();
    if (t === "") return err(path, "must not be empty");
    if (t.length > max) return err(path, `must be at most ${max} characters`);
    return t;
  };
  const hex = (v: unknown, path: string): string | undefined =>
    typeof v === "string" && HEX.test(v.trim()) ? v.trim().toLowerCase() : err(path, "must be a #rrggbb colour");

  const name = text(value.name, "$.name", BRIEF_LIMITS.name);
  const oneLine = text(value.one_line_request, "$.one_line_request", BRIEF_LIMITS.one_line_request);
  const archetype = text(value.archetype, "$.archetype", BRIEF_LIMITS.archetype);
  const hook = text(value.persona_hook, "$.persona_hook", BRIEF_LIMITS.persona_hook);
  const accent = hex(value.accent_hex, "$.accent_hex");
  const secondary = value.secondary_hex === undefined ? undefined : hex(value.secondary_hex, "$.secondary_hex");
  const silhouette = text(value.silhouette, "$.silhouette", BRIEF_LIMITS.silhouette);
  const prompt = text(value.portrait_prompt, "$.portrait_prompt", BRIEF_LIMITS.portrait_prompt);

  let style: CharacterBrief["style"] | undefined;
  if (!isRecord(value.style)) err("$.style", "must be an object with name and why");
  else {
    const sName = text(value.style.name, "$.style.name", BRIEF_LIMITS.styleName);
    const why = text(value.style.why, "$.style.why", BRIEF_LIMITS.styleWhy);
    if (sName !== undefined && why !== undefined) style = { name: sName, why };
  }

  const parts = parseBriefParts(value.parts, errors, text);
  if (errors.length > 0 || [name, oneLine, archetype, hook, accent, silhouette, prompt, style, parts].includes(undefined)) {
    return { ok: false, errors };
  }
  const brief: CharacterBrief = {
    name: name ?? "",
    one_line_request: oneLine ?? "",
    archetype: archetype ?? "",
    persona_hook: hook ?? "",
    accent_hex: accent ?? "",
    ...(secondary === undefined ? {} : { secondary_hex: secondary }),
    silhouette: silhouette ?? "",
    parts: parts ?? [],
    style: style ?? { name: "", why: "" },
    portrait_prompt: prompt ?? "",
  };
  return { ok: true, value: brief };
}

type Text = (v: unknown, path: string, max: number) => string | undefined;

function parseBriefParts(value: unknown, errors: BriefError[], text: Text): BriefPart[] | undefined {
  const err = (path: string, message: string): undefined => {
    errors.push({ path, message });
    return undefined;
  };
  if (!Array.isArray(value)) return err("$.parts", "must be an array");
  if (value.length < BRIEF_MIN_PARTS || value.length > BRIEF_MAX_PARTS) err("$.parts", `must list ${BRIEF_MIN_PARTS} to ${BRIEF_MAX_PARTS} parts`);
  const out: BriefPart[] = [];
  const seen = new Set<string>();
  let failed = false;
  for (const [i, raw] of value.entries()) {
    const at = `$.parts[${i}]`;
    const before = errors.length;
    if (!isRecord(raw)) {
      err(at, "must be an object");
      failed = true;
      continue;
    }
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!PART_NAME_PATTERN.test(name) || RESERVED_PART_NAMES.includes(name)) err(`${at}.name`, "must be 1-40 of [a-z0-9_] and not reserved");
    else if (seen.has(name)) err(`${at}.name`, "must be unique");
    seen.add(name);
    const role = raw.role;
    if (!isRole(role)) err(`${at}.role`, "must be one of the part roles");
    const what = text(raw.what, `${at}.what`, BRIEF_LIMITS.what);
    const motion = raw.motion === undefined ? undefined : text(raw.motion, `${at}.motion`, BRIEF_LIMITS.motion);
    const follow = raw.follow === undefined ? undefined : text(raw.follow, `${at}.follow`, BRIEF_LIMITS.name);
    if (errors.length > before || !isRole(role) || what === undefined) {
      failed = true;
      continue;
    }
    out.push({ name, role, what, ...(motion === undefined ? {} : { motion }), ...(follow === undefined ? {} : { follow }) });
  }
  if (failed) return undefined;
  const count = (roles: readonly PartRole[]) => out.filter((p) => roles.includes(p.role)).length;
  if (count(["head"]) !== 1) err("$.parts", "must have exactly one head");
  if (count(["jaw"]) !== 1) err("$.parts", "must have exactly one jaw");
  if (count(EYE_ROLES) < 1) err("$.parts", "must have at least one eye");
  if (count(["torso"]) < 1) err("$.parts", "must have at least one torso");
  const byName = new Map(out.map((p) => [p.name, p]));
  out.forEach((p, i) => {
    if (p.follow === undefined) return;
    if (p.follow === p.name || !byName.has(p.follow)) {
      err(`$.parts[${i}].follow`, "must name another part");
      return;
    }
    const chain = new Set([p.name]);
    for (let at = byName.get(p.follow); at !== undefined; at = at.follow === undefined ? undefined : byName.get(at.follow)) {
      if (chain.has(at.name)) {
        err(`$.parts[${i}].follow`, "must not form a cycle");
        return;
      }
      chain.add(at.name);
    }
  });
  return out;
}

/** HOUSE_STYLE for a brief: its "painterly realism" gives way to the brief's own art style. */
export const BRIEF_HOUSE_STYLE = HOUSE_STYLE.replace("painterly realism", "in the brief's art style");

/** The owner's hard-edge rule (cast-forge verdict 2026-11-02): the art's edges are the cut lines. */
export const HARD_EDGE_RULE = "Hard edges, never soft painterly realism: the style's own lines (lead lines, planes, ink outlines, pixels) are the cut lines.";

/**
 * The portrait prompt for an approved brief (requirement 4.2): BRIEF_HOUSE_STYLE (frontal centred
 * bust, empty near-black ground, jaw and eyes visible), then the brief's style name and its
 * portrait_prompt, then the hard-edge rule and the planned parts, each a separate shape.
 */
export function portraitPromptFromBrief(brief: CharacterBrief): string {
  const parts = brief.parts.map((p) => p.name.replaceAll("_", " ")).join(", ");
  return `${BRIEF_HOUSE_STYLE} Art style: ${brief.style.name}. ${brief.portrait_prompt} ${HARD_EDGE_RULE} Each of these parts is a separate shape with a clear dark gap around it: ${parts}.`;
}

/** Case- and space-insensitive key for matching a request to a recorded brief. */
export const requestKey = (text: string): string => text.trim().toLowerCase().replace(/\s+/g, " ");

/** The recorded brief whose one_line_request matches `request`, else the first one (replay plane). */
export function recordedBriefFor(request: string, briefs: readonly CharacterBrief[]): CharacterBrief | undefined {
  const key = requestKey(request);
  return briefs.find((b) => requestKey(b.one_line_request) === key) ?? briefs[0];
}

/** Contest `parts[].kind` -> PartRole (an `eye` kind keeps a left/right name's side). */
const KIND_ROLE: Readonly<Record<string, PartRole>> = { aperture_lower: "jaw", aperture_glow: "pulse", body: "torso" };

/** `serpent_l1..l3 / r1..r3` -> serpent_l1, serpent_l2, serpent_l3, serpent_r1, serpent_r2, serpent_r3. */
export function expandPartName(name: string): string[] {
  const segments = name.split("/").map((s) => s.trim());
  const base = /^(.*_)/.exec(segments[0] ?? "")?.[1] ?? "";
  return segments.flatMap((segment) => {
    const m = /^(.*?)(\d+)\.\.[a-z_]*?(\d+)$/.exec(segment);
    if (m?.[1] === undefined || m[2] === undefined || m[3] === undefined) return [segment];
    const prefix = m[1].includes("_") || base === "" ? m[1] : base + m[1];
    const out: string[] = [];
    for (let n = Number(m[2]); n <= Number(m[3]) && out.length < BRIEF_MAX_PARTS; n += 1) out.push(`${prefix}${n}`);
    return out;
  });
}

/** `text` cut at the last sentence end that fits in `max` characters (hard cut when none does). */
export function cutAtSentence(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  return end > 0 ? head.slice(0, end + 1) : head.trimEnd();
}

/**
 * A recorded contest brief (cast/<slug>/brief.json) read as a CharacterBrief, through parseBrief.
 * Pure adapter, the files stay as recorded: `parts[].kind` becomes `role` (aperture_lower -> jaw,
 * aperture_glow -> pulse, body -> torso, eye -> eye_l / eye_r / eye by name), range names expand,
 * `portrait_prompt` is `style.prompt` cut at a sentence end to 900 characters (the drawn portrait
 * came from the full text; the framing rules it drops are in BRIEF_HOUSE_STYLE), and `world`,
 * `provenance` and `style.prompt` are dropped. A brief already in the new shape passes as is.
 */
export function briefFromRecorded(value: unknown): BriefResult {
  if (!isRecord(value) || !isRecord(value.style) || !Array.isArray(value.parts)) return parseBrief(value);
  const style = value.style;
  const parts = value.parts.flatMap((p: unknown) => {
    if (!isRecord(p) || typeof p.name !== "string") return [p];
    const kind = p.kind ?? p.role;
    return expandPartName(p.name).map((name) => {
      const role = kind === "eye" ? (name === "eye_l" || name === "eye_r" ? name : "eye") : typeof kind === "string" ? (KIND_ROLE[kind] ?? kind) : kind;
      const rest = Object.fromEntries(Object.entries(p).filter(([k]) => k !== "kind"));
      return { ...rest, name, role };
    });
  });
  const prompt = value.portrait_prompt ?? (typeof style.prompt === "string" ? cutAtSentence(style.prompt, MAX_PORTRAIT_PROMPT) : undefined);
  return parseBrief({ ...value, parts, style: { name: style.name, why: style.why }, portrait_prompt: prompt });
}
