// CH 4, the wall of sets (costume requirement 5): pure. Turns tonight's cast into the sets on the
// wall, in schedule order: the house character's big set on now, one small set per later hour,
// the vacant hour after the cast, and channel 9 taped over. Each set carries what the page draws
// (its labels, cabinet skin, the colour it casts) and when it powers on: the small sets wake in
// schedule order, the big set last, then the ON AIR sign lights (`bootTimeline`).

/** What a set needs of a cast member. */
export interface WallMember {
  id: string;
  slug: string;
  name: string;
}

export type SetKind = "live" | "cast" | "vacant" | "sealed";
export type Skin = "wood" | "black" | "cream" | "teal";

export interface WallSet<M extends WallMember = WallMember> {
  key: string;
  kind: SetKind;
  /** "03:00"; the sealed set's is empty (it has no hour). */
  hour: string;
  name: string;
  /** The line on the cabinet's plate, e.g. "05:00 · CH 3". */
  plate: string;
  /** The listing's time line, e.g. "05:00 · LATER · CH 3". */
  slot: string;
  /** Screen readers: "05:00, The Lantern Warden, later tonight". */
  label: string;
  skin: Skin;
  /** The theme role (without `--sr-`) of the colour the set casts when warm. */
  accent: string;
  /** How strongly that colour spills over the brick, 0..1. */
  spill: number;
  /** Seconds after the wall appears that the tube powers on. */
  bootDelay: number;
  member?: M;
}

export interface WallChannels {
  /** The house character's channel (the set). */
  live: number;
  /** Where the later hours wait (the Forge). */
  later: number;
  sealed: number;
}

/** The hour the house character is on; the cast follows on the hour. */
export const ON_NOW_HOUR = 3;

/** `HH:00`, `n` hours after the house character's. */
export const hourAfter = (n: number): string => `${String((ON_NOW_HOUR + n) % 24).padStart(2, "0")}:00`;

/** The cast's own colours, by slug (the presets' accents); anyone else casts the theme accent. */
const ACCENTS: Readonly<Record<string, string>> = {
  malakor: "wall-cast-malakor",
  "announcer-of-dead-air": "wall-cast-announcer",
  "lantern-warden": "wall-cast-warden",
  "moth-widow": "wall-cast-moth",
  "sister-vesper": "wall-cast-vesper",
  understudy: "wall-cast-understudy",
};

/** The junk-shop mix of cabinets the later hours stand in, in hour order (prototype a..e). */
const CAST_SKINS: readonly Skin[] = ["black", "wood", "cream", "teal", "wood"];

/** The first small set wakes at this, each next one a step later; the big set waits for them. */
const FIRST_BOOT = 0.31;
const BOOT_STEP = 0.16;
const LIVE_BOOT = 1.35;
/** The ON AIR sign lights this long after the big set starts; the boot ends after the flicker. */
const LIT_AFTER = 0.95;
const IDLE_AFTER = 0.9;

export function accentOf(slug: string): string {
  return Object.hasOwn(ACCENTS, slug) ? (ACCENTS[slug] ?? "accent") : "accent";
}

/**
 * The wall, in schedule order: `liveId`'s big set first (from the cast, else `fallback`, else
 * none), then
 * every other member one hour apart, the vacant hour, the sealed channel.
 */
export function wallSets<M extends WallMember>(
  cast: readonly M[],
  liveId: string,
  channels: WallChannels,
  fallback?: M,
): WallSet<M>[] {
  const house = cast.find((m) => m.id === liveId) ?? fallback;
  const later = cast.filter((m) => m.id !== liveId);
  const smalls: WallSet<M>[] = later.map((member, i) => {
    const hour = hourAfter(i + 1);
    return {
      key: `cast-${member.id}`,
      kind: "cast",
      hour,
      name: member.name,
      plate: `${hour} · CH ${channels.later}`,
      slot: `${hour} · LATER · CH ${channels.later}`,
      label: `${hour}, ${member.name}, later tonight`,
      skin: CAST_SKINS[i % CAST_SKINS.length] ?? "wood",
      accent: accentOf(member.slug),
      spill: 0.42,
      bootDelay: 0,
      member,
    };
  });
  const vacantHour = hourAfter(later.length + 1);
  smalls.push({
    key: "vacant",
    kind: "vacant",
    hour: vacantHour,
    name: "Before the boiler wakes",
    plate: `${vacantHour} · VACANT`,
    slot: `${vacantHour} · VACANT`,
    label: `${vacantHour}, before the boiler wakes, vacant`,
    skin: "black",
    accent: "wall-cast-vacant",
    spill: 0.12,
    bootDelay: 0,
  });
  smalls.push({
    key: "sealed",
    kind: "sealed",
    hour: "",
    name: "Not built yet",
    plate: `CH ${channels.sealed} · SEALED`,
    slot: `CH ${channels.sealed} · SEALED`,
    label: `Channel ${channels.sealed}, not built yet, sealed`,
    skin: "cream",
    accent: "wall-cast-sealed",
    spill: 0.12,
    bootDelay: 0,
  });
  smalls.forEach((set, i) => {
    set.bootDelay = round(FIRST_BOOT + i * BOOT_STEP);
  });
  if (house === undefined) return smalls;
  const hour = hourAfter(0);
  const lastSmall = smalls[smalls.length - 1]?.bootDelay ?? 0;
  const big: WallSet<M> = {
    key: `live-${house.id}`,
    kind: "live",
    hour,
    name: house.name,
    plate: `${hour} · ON AIR NOW · CH ${channels.live}`,
    slot: `${hour} · ON AIR NOW · CH ${channels.live}`,
    label: `${hour}, ${house.name}, on air now`,
    skin: "wood",
    accent: accentOf(house.slug),
    spill: 0.34,
    bootDelay: round(Math.max(LIVE_BOOT, lastSmall + BOOT_STEP)),
    member: house,
  };
  return [big, ...smalls];
}

/** When the ON AIR sign lights and when the boot is over, in ms after the wall appears. */
export function bootTimeline(sets: readonly WallSet[]): { litMs: number; idleMs: number } {
  const last = Math.max(0, ...sets.map((s) => s.bootDelay));
  const lit = Math.round((last + LIT_AFTER) * 1000);
  return { litMs: lit, idleMs: lit + Math.round(IDLE_AFTER * 1000) };
}

const round = (n: number): number => Math.round(n * 100) / 100;
