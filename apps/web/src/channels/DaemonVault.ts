// CH 6, the root vault (costume task 5.1, r2/daemon-c.html): the pure half. The plate's geometry
// (cover fit, the grate, the roots the carrier climbs, the tendrils that reach for the empty
// socket), the growth of those tendrils as a function of dead-air seconds, the bulb's swing and
// filament, and the readings and events bound to the real health and daemon state. No DOM, no
// clock: DaemonRoom.ts paints from these, Daemon.tsx renders them.
import type { Health, Plane } from "../app/plane";
import type { Motion } from "../app/theme";
import type { DaemonState } from "../landing/daemon";
import { hms, ON_AIR_SINCE } from "../landing/StatusBar";

export type Point = readonly [number, number];

/** assets/plates/root-vault.webp, in its own pixels. */
export const VAULT_PLATE = { width: 1376, height: 768 } as const;
/** The grate in the vault's ceiling: the bulb hangs from it and the moon comes through it. */
export const GRATE: Point = [684, 46];
/** Where the moon's shaft lands on the wet floor. */
export const MOON_POOL: Point = [690, 640];
/** The bulb's wire, from the grate to the glass's centre, at full size (scaled by the rig). */
export const WIRE_LENGTH = 148;

/** The roots in plate pixels: the carrier rises through them into the grate. */
export const ROOTS: readonly (readonly Point[])[] = [
  [[410, 540], [370, 450], [350, 360], [380, 260], [430, 170], [520, 90], [600, 40]],
  [[290, 520], [300, 420], [330, 300], [400, 200], [470, 120], [560, 60]],
  [[960, 550], [985, 480], [1000, 400], [980, 290], [930, 190], [850, 100], [770, 40]],
  [[1060, 520], [1050, 380], [1010, 250], [900, 150], [800, 60]],
  [[60, 520], [40, 330], [80, 150], [40, 0]],
  [[1320, 600], [1350, 400], [1330, 200], [1290, 0]],
];

/** A tendril's root on the plate and the side it reaches from (-1 left of the socket, 1 right). */
export interface Tendril {
  at: Point;
  side: -1 | 1;
}

export const TENDRILS: readonly Tendril[] = [
  { at: [470, 130], side: -1 },
  { at: [380, 120], side: -1 },
  { at: [560, 22], side: -1 },
  { at: [905, 150], side: 1 },
  { at: [990, 120], side: 1 },
  { at: [820, 22], side: 1 },
  { at: [640, 70], side: -1 },
  { at: [730, 70], side: 1 },
];

/** "one measured centimetre per ten seconds of dead air" (the prototype's CM_PER_S). */
export const CM_PER_SECOND = 0.1;
/** The growth's time constant: after this many seconds of dead air the tendrils are 63% grown. */
export const GROWTH_TAU_S = 14;

const finiteSeconds = (s: number): number => (Number.isFinite(s) && s > 0 ? s : 0);

/**
 * Pure: how far the tendrils have grown toward the empty socket after `deadSeconds` of dead air,
 * 0..1. Zero while there is no dead air; rises with every second; never reaches the socket.
 */
export function rootGrowth(deadSeconds: number): number {
  const s = finiteSeconds(deadSeconds);
  return Math.min(1 - Number.EPSILON, 1 - Math.exp(-s / GROWTH_TAU_S));
}

/** Pure: the reach shown in text, in centimetres, one decimal. */
export function rootReachCm(deadSeconds: number): string {
  return (Math.floor(finiteSeconds(deadSeconds)) * CM_PER_SECOND).toFixed(1);
}

/** Pure: how much of its own path tendril `index` has grown (each one has its own pace, all < 1). */
export function tendrilReach(growth: number, index: number): number {
  const g = Number.isFinite(growth) ? Math.max(0, Math.min(1, growth)) : 0;
  const pace = 0.7 + (((index * 37) % 10) + 10) % 10 / 30;
  return Math.min(1, g * pace);
}

/** The cover fit of the plate in a viewport: scale and offset, as CSS background-size: cover. */
export interface Cover {
  scale: number;
  ox: number;
  oy: number;
}

export function coverFit(width: number, height: number): Cover {
  const scale = Math.max(width / VAULT_PLATE.width, height / VAULT_PLATE.height);
  return { scale, ox: (width - VAULT_PLATE.width * scale) / 2, oy: (height - VAULT_PLATE.height * scale) / 2 };
}

export function toView(cover: Cover, [x, y]: Point): Point {
  return [x * cover.scale + cover.ox, y * cover.scale + cover.oy];
}

/**
 * Pure: the point at `u` (0 at the root, 1 beside the socket) along tendril `index`'s one fixed
 * path, in view pixels: a quadratic bow from its root toward `socket` (the empty socket, beside
 * which it ends) that sags below both ends, with a fixed wobble along it. `swayPx` is the
 * painter's live breath at that point (0 in tests and under reduced motion).
 */
export function tendrilPoint(tendril: Tendril, index: number, u: number, cover: Cover, socket: Point, rigScale: number, swayPx = 0): Point {
  const [ax, ay] = toView(cover, tendril.at);
  const S = cover.scale;
  const tx = socket[0] - tendril.side * 46 * rigScale;
  const ty = socket[1];
  const cx = (ax + tx) / 2 - tendril.side * 30 * S;
  const cy = Math.max(ay, ty) + (70 + (index % 3) * 30) * S;
  const x = (1 - u) * (1 - u) * ax + 2 * (1 - u) * u * cx + u * u * tx;
  const y = (1 - u) * (1 - u) * ay + 2 * (1 - u) * u * cy + u * u * ty;
  const wobble = (Math.sin(u * 9 + index * 1.7) * 16 + Math.sin(u * 23 + index) * 5) * S * Math.sin(u * Math.PI) + swayPx;
  return [x + wobble * 0.4, y + wobble];
}

/**
 * Pure: tendril `index`'s grown part after `growth`, `steps + 1` points: the prefix [0, reach] of
 * its fixed path (tendrilPoint), so a tendril only ever lengthens as the dead air goes on.
 */
export function tendrilPath(
  tendril: Tendril,
  index: number,
  growth: number,
  cover: Cover,
  socket: Point,
  rigScale: number,
  steps = 24,
  sway: (u: number) => number = () => 0,
): Point[] {
  const reach = tendrilReach(growth, index);
  return Array.from({ length: steps + 1 }, (_, k) => {
    const u = (k / steps) * reach;
    return tendrilPoint(tendril, index, u, cover, socket, rigScale, sway(u));
  });
}

/** Pure: the bulb's swing in degrees at `ms`; `amp` 0..1 is how alive it is. Reduced motion: still. */
export function swingDeg(ms: number, amp: number, motion: Motion): number {
  if (motion === "reduced") return 0;
  return Math.sin(ms / 1500) * 6 * (0.2 + 0.8 * Math.max(0, Math.min(1, amp)));
}

/** Pure: where the bulb's glass hangs, from the grate at `grate` and the swing. */
export function bulbAt(grate: Point, deg: number, rigScale: number): Point {
  const rad = (deg * Math.PI) / 180;
  const len = WIRE_LENGTH * rigScale;
  return [grate[0] - Math.sin(rad) * len, grate[1] + Math.cos(rad) * len];
}

/**
 * Pure: the filament (the carrier trace) in the bulb's 92 x 116 box: a sine across the posts whose
 * amplitude is the carrier. `noise` is the painter's flicker (0 in tests). Dead: a straight wire.
 */
export function filamentPath(ms: number, amp: number, lost: boolean, noise: () => number = () => 0): string {
  const parts: string[] = [];
  for (let i = 0; i <= 40; i++) {
    const x = 22 + i * 1.2;
    const y = lost ? 60 : 60 + amp * Math.sin((i / 40) * Math.PI * 5 + ms / 120) * 11 + noise() * 1.2;
    parts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return parts.join("");
}

/** The cut's flicker: the bulb's light by seconds since the fold began (the glass's `bout`). */
const FLICKER: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.1, 0.15],
  [0.18, 0.9],
  [0.3, 0.05],
  [0.44, 0.6],
  [0.62, 0],
];

/** Pure: the bulb's light `seconds` into the fold. */
export function foldLight(seconds: number): number {
  let v = 1;
  for (const [at, level] of FLICKER) if (seconds >= at) v = level;
  return v;
}

/** Pure: parse a computed role colour (#rrggbb or rgb(r, g, b)) into channels; undefined if not one. */
export function parseColour(value: string): readonly [number, number, number] | undefined {
  const v = value.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex?.[1] !== undefined) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(v);
  if (rgb?.[1] !== undefined && rgb[2] !== undefined && rgb[3] !== undefined) {
    const c = (s: string) => Math.min(255, Number(s));
    return [c(rgb[1]), c(rgb[2]), c(rgb[3])];
  }
  return undefined;
}

export type Tone = "bad" | "cold";

export interface Reading {
  key: string;
  value: string;
  note: string;
  /** Tinted while the daemon is lost: ember for what is gone, moonlight for what remains. */
  tone?: Tone;
}

export interface VaultInputs {
  health: Health | undefined;
  plane: Plane;
  lost: boolean;
  /** Broadcast uptime in seconds (UP_AT_OPEN + seconds since the page opened). */
  up: number;
  /** Seconds since the daemon was lost (0 while online). */
  dead: number;
  motion: Motion;
}

/** Pure: the readings column, top to bottom. Every value is the health read or the daemon state. */
export function vaultReadings({ health, plane, lost, up, dead, motion }: VaultInputs): Reading[] {
  const engine = health === undefined ? "no answer" : health.engine;
  const engineNote = health === undefined ? (plane === "replay" ? "replay · tape" : "health unread") : `v${health.version}`;
  return [
    lost ? { key: "carrier", value: "none", note: "lost", tone: "bad" } : { key: "carrier", value: "steady", note: `locked · ${ROOTS.length} roots` },
    lost ? { key: "engine", value: engine, note: engineNote, tone: "bad" } : { key: "engine", value: engine, note: engineNote },
    lost
      ? { key: "roots", value: "reaching", note: `${rootReachCm(dead)} cm grown`, tone: "cold" }
      : { key: "roots", value: "feeding", note: "carrier rising" },
    lost ? { key: "dead air", value: hms(dead), note: "counting", tone: "bad" } : { key: "uptime", value: hms(up), note: `since ${ON_AIR_SINCE}` },
    lost
      ? { key: "light", value: "moon only", note: "through the grate", tone: "cold" }
      : { key: "light", value: "the bulb", note: motion === "reduced" ? "still" : "swinging" },
    { key: "plane", value: plane, note: plane === "replay" ? "recorded" : "on air" },
  ];
}

export interface VaultEvent {
  at: string;
  text: string;
  tone?: Tone;
}

/** Pure: what the cellar remembers when the daemon enters `state` (nothing for a settled online). */
export function stateEvents(state: DaemonState, from: DaemonState, at: string): VaultEvent[] {
  if (state === "folding") {
    return [
      { at, text: "daemon cut · the chain is pulled", tone: "bad" },
      { at, text: "carrier lost · the roots go dark", tone: "bad" },
    ];
  }
  if (state === "dark") return [{ at, text: "bulb out · the roots are still growing", tone: "cold" }];
  if (state === "relighting") return [{ at, text: "daemon re-seated · the bulb stutters" }];
  if (state === "online" && from === "relighting") return [{ at, text: "carrier rising · the roots let go" }];
  return [];
}

/** Pure: the event for a health read (`undefined`: no answer). */
export function healthEvent(health: Health | undefined, plane: Plane, at: string): VaultEvent {
  if (health === undefined) return { at, text: `health read · no answer · ${plane}` };
  const text = `health read · ${health.plane} · ${health.engine} · ${health.version}`;
  return health.engine === "offline" ? { at, text, tone: "bad" } : { at, text };
}

/** Keep the last `max` events (the column fades its oldest). */
export function remember(events: readonly VaultEvent[], add: readonly VaultEvent[], max = 8): VaultEvent[] {
  return [...events, ...add].slice(-max);
}
