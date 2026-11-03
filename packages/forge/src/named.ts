// Named parts (cast-forge design.md "Named parts", requirement 2): the role rules the cut and the
// assembly share. A v1 part is a named part whose name is its role (`asNamed`), so one code path
// serves both formats. Pure: no I/O.
import { EMISSIVE_KINDS, type FloatMotion, type LayerKind, type Motion, type PulseMotion, phaseFromName } from "@sr/rig";
import type { NamedPart, Part, PartRole } from "./types.js";

/** Cut order, front to back, by role; roles in one group keep file order among themselves. */
export const ROLE_ORDER: readonly (readonly PartRole[])[] = [
  ["float"],
  ["pulse"],
  ["eye_l", "eye_r", "eye"],
  ["monocle"],
  ["accessory"],
  ["hat"],
  ["crown"],
  ["hair"],
  ["jaw"],
  ["head"],
  ["torso"],
];

/** Roles cut from the filled plate; every other role is lifted off it and the plate filled behind. */
export const PLATE_ROLES: readonly PartRole[] = ["head", "torso"];

/** Roles luma-keyed unless the part says otherwise: the v1 KEYED_PARTS plus float. */
export const KEYED_ROLES: readonly PartRole[] = ["crown", "hair", "accessory", "float"];

/** Motion a float or pulse part gets when its file gives none, in MOTION_CANVAS px (requirement 3.3: they move). */
export const DEFAULT_FLOAT: Readonly<FloatMotion> = { amp: [1.5, 3], freq: 0.3, rot_deg: 1.5 };
export const DEFAULT_PULSE: Readonly<PulseMotion> = { amp: 0.5, freq: 0.6 };

export const roleRank = (role: PartRole): number => ROLE_ORDER.findIndex((group) => group.includes(role));

/** `parts` front to back: by ROLE_ORDER, file order within a group (a stable sort). */
export function cutOrderNamed<P extends NamedPart>(parts: readonly P[]): P[] {
  return parts.map((part, i) => ({ part, i })).sort((a, b) => roleRank(a.part.role) - roleRank(b.part.role) || a.i - b.i).map(({ part }) => part);
}

/** A v1 part as a named part: its name is its role; follow, key and motion are the defaults. */
export function asNamed(parts: readonly (Part | NamedPart)[]): NamedPart[] {
  return parts.map((p) => ("role" in p ? p : { name: p.name, role: p.name, box_2d: p.box_2d, poly: p.poly }));
}

export const isLifted = (part: NamedPart): boolean => !PLATE_ROLES.includes(part.role);
export const isKeyed = (part: NamedPart): boolean => part.key ?? KEYED_ROLES.includes(part.role);

/** The name of the first head-role part, which every non-plate part follows by default. */
export const headNameOf = (parts: readonly NamedPart[]): string | undefined => parts.find((p) => p.role === "head")?.name;

/** design.md: torso and head follow nothing, everything else the head, unless the part names another. */
export function followOf(part: NamedPart, headName: string | undefined): string | undefined {
  if (part.follow !== undefined) return part.follow;
  return PLATE_ROLES.includes(part.role) || headName === part.name ? undefined : headName;
}

/**
 * The plate part (head or torso role) at the root of `part`'s follow chain: the layer that carries
 * the filled surface under it, so a lifted part's hole moves with what it hangs on. A plate part
 * carries itself; a broken or cyclic chain falls back to the head.
 */
export function carrierOf(part: NamedPart, parts: readonly NamedPart[]): string | undefined {
  const byName = new Map(parts.map((p) => [p.name, p]));
  const head = headNameOf(parts);
  const seen = new Set<string>();
  for (let at: NamedPart | undefined = part; at !== undefined && !seen.has(at.name); ) {
    if (PLATE_ROLES.includes(at.role)) return at.name;
    seen.add(at.name);
    const next = followOf(at, head);
    at = next === undefined ? undefined : byName.get(next);
  }
  return head;
}

/**
 * The part's motion in MOTION_CANVAS px: its own, else DEFAULT_FLOAT for a float role and
 * DEFAULT_PULSE for a pulse role. A float or pulse with no phase gets `phaseFromName`, so sibling
 * shards never move in lockstep. Undefined for other roles without motion.
 */
export function motionOf(part: NamedPart): Motion | undefined {
  const own: Motion | undefined = part.motion ?? (part.role === "float" ? { float: DEFAULT_FLOAT } : part.role === "pulse" ? { pulse: DEFAULT_PULSE } : undefined);
  if (own === undefined) return undefined;
  const phase = phaseFromName(part.name);
  return {
    ...(own.float === undefined ? {} : { float: { ...own.float, phase: own.float.phase ?? phase } }),
    ...(own.pulse === undefined ? {} : { pulse: { ...own.pulse, phase: own.pulse.phase ?? phase } }),
    // An eye's own blink (cast-forge task 6) keeps its phase as given: its stagger is the point.
    ...(own.blink === undefined ? {} : { blink: { ...own.blink } }),
  };
}

/** Roles of an eye: an eye gives light unless its part says `emissive: false`. */
const EYE_ROLES: readonly PartRole[] = ["eye", "eye_l", "eye_r"];

/**
 * The layer's `emissive` (cast-forge task 12 follow-up; design.md "Emissive per layer"). A part
 * gives light when its file says so (`emissive`), else when it pulses (a pulse role, or a pulse in
 * its motion: a pulse is a light gain) or is an eye. The rule only takes light away: a part of
 * an emissive kind (EMISSIVE_KINDS) that gives none gets `false` (a white glove, abacus beads, a
 * silver crown); a part of another kind gets `true` only when its file says `emissive: true` (a jaw's
 * pulse lights its own pixels, not the glow pass). Undefined when the kind's default holds.
 */
export function emissiveOf(part: NamedPart, kind: LayerKind): boolean | undefined {
  const lit = EMISSIVE_KINDS.has(kind);
  if (part.emissive !== undefined) return part.emissive === lit ? undefined : part.emissive;
  const glows = part.role === "pulse" || part.motion?.pulse !== undefined || EYE_ROLES.includes(part.role);
  return lit && !glows ? false : undefined;
}

/** Motion scaled from MOTION_CANVAS px to a `width` x `height` canvas (float amplitude only). */
export function scaleMotion(motion: Motion, width: number, height: number, canvas: number): Motion {
  if (motion.float === undefined) return motion;
  const [x, y] = motion.float.amp;
  return { ...motion, float: { ...motion.float, amp: [(x * width) / canvas, (y * height) / canvas] } };
}
