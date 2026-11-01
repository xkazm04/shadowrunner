// The chat on the replay plane (landing requirement 6.2): the reference's lines, verbatim
// (assets/_incoming/landing-winner/index.html, "chat (simulated)"), and a pure, timer-free state
// machine that plays them. ChatStrip owns the clock: it calls `stepChat` after `delayOf` ms.
// Viewer lines land whole; the host's lines are typed in, TYPE_STEP characters per tick.
// The reference's random "operator" lines are left out: they are decoration with no state behind
// them (product.md), and randomness would make the first frame unstable.

/** The host's name tag on the paper (the character's last name, upper case, as the reference). */
export const HOST_TAG = "MALAKOR";

export type ChatLine =
  | { kind: "viewer"; user: string; rank: string; text: string }
  | { kind: "host"; text: string };

const viewer = (user: string, rank: string, text: string): ChatLine => ({ kind: "viewer", user, rank, text });
const host = (text: string): ChatLine => ({ kind: "host", text });

/** Already on the paper when the visitor arrives. */
export const HISTORY: readonly ChatLine[] = [
  viewer("velvet_ossuary", "Acolyte", "back again. does the ledger remember me"),
  host("It does. Page four. You were early, which I respect."),
  viewer("grave_clerk_77", "Cultist", "!summon the Coin Prophet"),
  host("Denied. The Coin Prophet still owes the Spire three candles."),
];

/** Played in order after the history, then from the top again. */
export const SCRIPT: readonly ChatLine[] = [
  viewer("moth_in_a_jar", "Thrall", "first time here. why is it 3am in here"),
  host("A newcomer, at this hour. Sit anywhere. The cellar keeps its own clock and it runs slow."),
  viewer("grave_clerk_77", "Cultist", "!summon the Life Coach"),
  host("The circle stirs. The Life Coach approaches with a clipboard. I have already filed a grievance."),
  viewer("velvet_ossuary", "Acolyte", "!vote 2"),
  host("Counted. The Plebiscite is sacred, even when it is wrong."),
  viewer("lanternjaw", "Warlock", "is the Lord watching tonight?"),
  host("Not in chat, and nobody tells me more. I will sit up straighter regardless."),
  viewer("the_ninth_drip", "Thrall", "my lamp just flickered lol"),
  host("Your lamp flickered because someone cut the lamp budget. We have that in common."),
  viewer("sister_cinder", "Lesser Lich", "!propose a midnight audit of the moon"),
  host("Ambitious. Filed under schemes, pending a moon."),
  viewer("humble_bone", "Thrall", "!hint"),
  host("The card on the left has been face down for an hour. It is starting to sulk."),
  viewer("wick_and_wire", "Acolyte", "can he actually hear us"),
  host("Every word. I keep a ledger. You are in the good column, for now."),
  viewer("grave_clerk_77", "Cultist", "!grade REP"),
  host("Reportedly. Say it with me. A lich who overstates evidence gets audited."),
  viewer("moth_in_a_jar", "Thrall", "only 1 viewer??"),
  host("One. I have annexed provinces with fewer. Probably."),
];

/** Lines kept on the paper; older ones have long faded under the top mask. */
export const MAX_LINES = 12;
/** Characters typed per tick, and the tick (the reference's typewriter). */
export const TYPE_STEP = 2;
export const TYPE_MS = 45;
/** From arrival to the first scripted line. */
export const START_MS = 1200;
/** After a viewer line, before the next line (the reference's 2.2 to 3.8 s, fixed at its mean). */
export const VIEWER_GAP_MS = 3000;

export interface ShownLine {
  /** Unique and increasing in arrival order; the React key. */
  id: number;
  line: ChatLine;
  /** Characters of `line.text` shown so far; equal to its length once the line is complete. */
  typed: number;
}

export interface ChatState {
  lines: readonly ShownLine[];
  /** Index of the next script line (unbounded; read modulo the script length). */
  next: number;
  /** The id the next line will get. */
  serial: number;
}

function shown(lines: readonly ChatLine[]): ShownLine[] {
  return lines.map((line, id) => ({ id, line, typed: line.text.length }));
}

/** Arrival with motion: the history, complete, and the script about to start. */
export function initialChat(): ChatState {
  return { lines: shown(HISTORY), next: 0, serial: HISTORY.length };
}

/**
 * The reduced-motion twin (requirement 9.2): the history and the first exchange, complete, with
 * nothing to type and no clock (the reference's load frame, R4-1-1600x900-load.png).
 */
export function staticChat(): ChatState {
  const lines = shown([...HISTORY, ...SCRIPT.slice(0, 2)]);
  return { lines: lines.slice(-MAX_LINES), next: 2, serial: lines.length };
}

/** Pure: whether a shown line is still being typed. */
export function isTyping(shownLine: ShownLine | undefined): boolean {
  return shownLine !== undefined && shownLine.typed < shownLine.line.text.length;
}

/**
 * Pure: one tick. A host line being typed gains TYPE_STEP characters; otherwise the next script
 * line arrives (a host line empty, to be typed; a viewer line whole) and the oldest lines beyond
 * MAX_LINES leave the paper.
 */
export function stepChat(state: ChatState, script: readonly ChatLine[] = SCRIPT): ChatState {
  const last = state.lines.at(-1);
  if (last && isTyping(last)) {
    const typed = Math.min(last.line.text.length, last.typed + TYPE_STEP);
    return { ...state, lines: [...state.lines.slice(0, -1), { ...last, typed }] };
  }
  const line = script[state.next % script.length];
  if (!line) return state;
  const arrived: ShownLine = { id: state.serial, line, typed: line.kind === "host" ? 0 : line.text.length };
  return { lines: [...state.lines, arrived].slice(-MAX_LINES), next: state.next + 1, serial: state.serial + 1 };
}

/** Pure: how long a host line takes to type. */
export function typingMs(text: string): number {
  return Math.ceil(text.length / TYPE_STEP) * TYPE_MS;
}

/**
 * Pure: how long the paper holds a typed host line before the next one. The reference schedules
 * the next line max(4.2 s, 60 ms per character + 1.8 s) after the host starts typing.
 */
export function readMs(text: string): number {
  return Math.max(4200, text.length * 60 + 1800) - typingMs(text);
}

/** Pure: the wait before the next `stepChat`. */
export function delayOf(state: ChatState): number {
  const last = state.lines.at(-1);
  if (!last) return START_MS;
  if (isTyping(last)) return TYPE_MS;
  return last.line.kind === "host" ? readMs(last.line.text) : VIEWER_GAP_MS;
}
