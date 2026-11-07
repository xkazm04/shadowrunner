// forge-creator L2, casting from three drafts: the pure rules both planes share. After the brief is
// approved the forge first draws CAST_SIZE draft portraits with the cheap draft image model, each
// with its own framing sentence (`draftPrompt`), and cuts each into a provisional rig; the streamer
// casts one and only then does the forge pay for fill, eyes and faces. "None of these" re-rolls at
// most MAX_REROLLS times per chain of batches. On the replay plane the three candidates are recorded
// jobs: the one recorded from the brief's request (a cast member) first, then others in an order
// fixed by the request (`castOrder`), so the server's replay and the browser's show the same three.
// Browser-safe: no node imports (the creator imports it as "@sr/forge/cast").
import type { Rig } from "@sr/rig";
import { portraitPromptFromBrief } from "./brief.js";
import { assetsWithFaces, rigWithFaces } from "./replayFaces.js";
import type { CastCandidateView, CastStatus, CastView, CharacterBrief } from "./wire.js";

/** Candidates per batch. */
export const CAST_SIZE = 3;
/** Re-rolls ("None of these") per chain of batches: a fresh batch, then at most this many more. */
export const MAX_REROLLS = 2;

/**
 * One framing sentence per candidate, appended to the brief's portrait prompt, so three drafts of
 * one brief differ in pose and light while the brief (parts, style) stays the same.
 */
export const CAST_VARIATIONS: readonly [string, string, string] = [
  "Draft A: frame the head straight on, centred, lit from above.",
  "Draft B: turn the head a few degrees to the viewer's left, with a stronger rim light on one side.",
  "Draft C: frame the head a little lower and closer, the features bolder and simpler.",
];

/** The draft portrait prompt of candidate `index` (0..CAST_SIZE-1). */
export function draftPrompt(brief: CharacterBrief, index: number): string {
  const variation = CAST_VARIATIONS[((index % CAST_SIZE) + CAST_SIZE) % CAST_SIZE] ?? CAST_VARIATIONS[0];
  return `${portraitPromptFromBrief(brief)} ${variation}`;
}

/** The planned names not among the found ones, in plan order, each once. */
export function missingParts(planned: readonly string[], found: readonly string[]): string[] {
  const have = new Set(found);
  return [...new Set(planned)].filter((name) => !have.has(name));
}

/** FNV-1a over a string's code points: a stable 32-bit number, the same in node and the browser. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (const ch of text) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Every slug once, ordered for the request `key`: `primary` (when it is among them) first, the rest
 * by the hash of key and slug (ties by slug). The same key always gives the same order.
 */
export function castOrder(key: string, slugs: readonly string[], primary?: string): string[] {
  const k = key.trim().toLowerCase();
  const rest = [...new Set(slugs)].filter((s) => s !== primary);
  rest.sort((a, b) => fnv1a(`${k}\u0000${a}`) - fnv1a(`${k}\u0000${b}`) || a.localeCompare(b));
  return primary !== undefined && slugs.includes(primary) ? [primary, ...rest] : rest;
}

/** Replay: the recorded candidates of re-roll `round` (0 fresh): the next CAST_SIZE of `castOrder`, wrapping. */
export function castTrio(key: string, slugs: readonly string[], primary: string | undefined, round: number): string[] {
  const order = castOrder(key, slugs, primary);
  const n = Math.min(CAST_SIZE, order.length);
  const start = Math.max(0, Math.floor(round)) * CAST_SIZE;
  return Array.from({ length: n }, (_, i) => order[(start + i) % order.length] ?? "");
}

const SLUG = /^[a-z0-9-]{1,48}$/;
const REPLAY_BATCH = /^replaycast_([0-9])(p?)_([0-9a-z]{1,12})_([a-z0-9~-]{1,160})$/;

export interface ReplayBatch {
  round: number;
  startedAt: number;
  slugs: string[];
  /** The first slug is the job recorded from the brief's own request. */
  primary: boolean;
}

/** A replay batch id: stateless, like a replay job id, it carries the round, the start and the slugs. */
export function replayBatchId(batch: ReplayBatch): string {
  return `replaycast_${batch.round}${batch.primary ? "p" : ""}_${Math.max(0, Math.floor(batch.startedAt)).toString(36)}_${batch.slugs.join("~")}`;
}

/** The replay batch an id names, or undefined when it is not one. */
export function parseReplayBatchId(id: string): ReplayBatch | undefined {
  const m = REPLAY_BATCH.exec(id);
  if (m?.[1] === undefined || m[3] === undefined || m[4] === undefined) return undefined;
  const slugs = m[4].split("~");
  if (slugs.length === 0 || slugs.length > CAST_SIZE || slugs.some((s) => !SLUG.test(s))) return undefined;
  return { round: Number(m[1]), startedAt: Number.parseInt(m[3], 36), slugs, primary: m[2] === "p" };
}

/** Re-rolls a batch of `round` may still make. */
export const rerollsLeft = (round: number): number => Math.max(0, MAX_REROLLS - round);

/** The note on a recorded candidate that was not drawn from the brief (replay). */
export const RECORDED_OTHER_NOTE = "A recorded cast member, not drawn from this brief.";

/** The note on the recorded candidate recorded from the brief's own request (replay). */
export const RECORDED_PRIMARY_NOTE = "Recorded from this brief's request.";

/** Replay: how long the recorded batch seems to draw, then to cut, before it is ready (ms). */
export const REPLAY_CAST_HOLDS = { drafting: 1500, cutting: 1500 } as const;

/** Replay: the batch status `elapsedMs` after its start. */
export function replayCastStatus(elapsedMs: number): CastStatus {
  if (elapsedMs < REPLAY_CAST_HOLDS.drafting) return "drafting";
  return elapsedMs < REPLAY_CAST_HOLDS.drafting + REPLAY_CAST_HOLDS.cutting ? "cutting" : "ready";
}

/** What the replay cast view needs of a recorded job (both planes' ReplayJob fit). */
export interface RecordedCandidate {
  slug: string;
  portraitUrl: string;
  rig: Rig;
  assets: Readonly<Record<string, string>>;
}

/**
 * Replay: the view of a recorded batch `elapsedMs` after its start. Each candidate is its recorded
 * job's rig without its faces (a provisional rig has none), its portrait shown from "cutting" on;
 * no diagnostics are computed for recordings, the note says what each one is. Undefined when a
 * slug has no recording.
 */
export function replayCastView(batchId: string, batch: ReplayBatch, jobs: ReadonlyMap<string, RecordedCandidate>, elapsedMs: number): CastView | undefined {
  const status = replayCastStatus(elapsedMs);
  const candidates: CastCandidateView[] = [];
  for (const [index, slug] of batch.slugs.entries()) {
    const job = jobs.get(slug);
    if (job === undefined) return undefined;
    const note = batch.primary && index === 0 ? RECORDED_PRIMARY_NOTE : RECORDED_OTHER_NOTE;
    const base = { index, missing: [], empty: [], warnings: [], note };
    if (status === "drafting") {
      candidates.push({ ...base, state: "drafting" });
      continue;
    }
    if (status === "cutting") {
      candidates.push({ ...base, state: "drafting", portraitUrl: job.portraitUrl });
      continue;
    }
    const rig = rigWithFaces(job.rig, 0);
    candidates.push({ ...base, state: "cut", portraitUrl: job.portraitUrl, rig, assets: assetsWithFaces(job.rig, rig, job.assets) });
  }
  return { batchId, status, plane: "replay", rerollsLeft: rerollsLeft(batch.round), candidates };
}
