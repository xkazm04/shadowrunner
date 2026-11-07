// @sr/forge/wire: the forge wire contract (forge-pipeline design.md "Contracts (wire names)").
// Types only, so it is safe to import in the browser. This is the ONLY declaration of these
// names; the creator imports them from "@sr/forge/wire" and never redeclares them.
import type { ExpressionFamily, Rig } from "@sr/rig";
import type { PartRole } from "./types.js";

/** Job status, in step order. `filling` sits between `cutting` and `done`. */
export type ForgeStatus = "queued" | "portrait" | "segmenting" | "cutting" | "filling" | "expressing" | "done" | "failed";

/** Error codes that may cross the API in `{ error: { code, message } }`. */
export type ForgeErrorCode = "quota" | "refused_likeness" | "refused_content" | "upstream" | "bad_input";

/** Body of `POST /api/forge`; answered with `202 { jobId }`. */
export interface ForgeRequest {
  mode: "prompt" | "image" | "brief";
  prompt?: string;
  imageBase64?: string;
  /** mode "brief" (cast-forge 4.3): the brief the streamer approved, checked again by the server. */
  brief?: CharacterBrief;
  /**
   * mode "brief", forge-creator L2: the casting candidate the streamer chose. The job continues
   * from that draft portrait and its decomposition (no second portrait, no second segmentation).
   */
  candidate?: CastPick;
}

/** forge-creator L2: one candidate of a casting batch, by the batch's id and its index (0..CAST_SIZE-1). */
export interface CastPick {
  batchId: string;
  index: number;
}

/** Body of `POST /api/forge/drafts` (L2); answered with `202 { batchId }`. */
export interface CastRequest {
  brief: CharacterBrief;
  /** A re-roll ("None of these"): the batch it replaces. Omitted: a fresh batch (one forge use). */
  after?: string;
}

/** A casting batch's status, in step order (L2). */
export type CastStatus = "drafting" | "segmenting" | "cutting" | "ready" | "failed";

/**
 * One draft of a casting batch (L2). `state`: "cut" has a provisional rig; "uncut" has a portrait
 * whose planned parts could not be read or cut (casting it asks the parts again); "failed" has no
 * portrait; "drafting" is still on its way. The lists are facts, always present (empty when none).
 */
export interface CastCandidateView {
  index: number;
  state: "drafting" | "cut" | "uncut" | "failed";
  portraitUrl?: string;
  /** Provisional: cut over the deterministic fallback plate; no fill edit, no eyes, no faces. */
  rig?: Rig;
  /** file -> URL, sent with `rig`. */
  assets?: Record<string, string>;
  /** Planned parts (the brief's names) the parts model did not find on this draft. */
  missing: string[];
  /** Found parts whose cut came out empty. */
  empty: string[];
  /** Assembly warnings, in words. */
  warnings: string[];
  /** One line about the candidate (why it failed, or what a recorded one is). */
  note?: string;
}

/** Body of `GET /api/forge/drafts/:batchId` (L2). Optional fields omitted, never null. */
export interface CastView {
  batchId: string;
  status: CastStatus;
  plane: "replay" | "live";
  /** Re-rolls this batch may still make ("None of these"). */
  rerollsLeft: number;
  candidates: CastCandidateView[];
  /** Once cast: the forge job continued from the chosen candidate. */
  jobId?: string;
  error?: { code: ForgeErrorCode; message: string };
}

/** One planned part of a brief (cast-forge design.md "Brief and handshake"). */
export interface BriefPart {
  /** `[a-z0-9_]`, unique in the brief; the layer name task 11 asks the parts model for. */
  name: string;
  role: PartRole;
  /** What the part looks like, in a few words. */
  what: string;
  /** How it moves, in words (the parts step turns it into numbers). */
  motion?: string;
  /** Another part's name. */
  follow?: string;
}

/** The character brief (cast-forge requirement 4.1), always checked by `parseBrief` before use. */
export interface CharacterBrief {
  name: string;
  one_line_request: string;
  archetype: string;
  persona_hook: string;
  /** `#rrggbb`, lower case. */
  accent_hex: string;
  secondary_hex?: string;
  silhouette: string;
  /** 6..24 parts (BRIEF_MAX_PARTS); one jaw, and at most one more jaw-role part that follows it. */
  parts: BriefPart[];
  style: { name: string; why: string };
  /** At most 900 characters. */
  portrait_prompt: string;
  /** Up to 3 short in-character lines (the character sheet's lines on air); omitted when none. */
  example_lines?: string[];
  /**
   * forge-creator C3: what the face is made of, for a face that is not ordinary human (a pumpkin, a
   * skull, a helm, glass). `eyes` is the streamer's one editable line "Its eyes are ..." (at most 200
   * characters, the words after "Its eyes are"); the live eye and expression edits are phrased in it.
   * Omitted for human eyes. An object so a later line (the mouth) can join it compatibly.
   */
  face?: { eyes: string };
}

/** Body of `POST /api/forge/brief`. */
export interface BriefRequest {
  request: string;
}

/** Answer of `POST /api/forge/brief`; `plane: "replay"` is a recorded brief (labelled RECORDED). */
export interface BriefResponse {
  brief: CharacterBrief;
  plane: "replay" | "live";
}

/**
 * How a brief job's portrait was cut (cast-forge task 11): "named" into the brief's own parts;
 * "fallback" into the ten standard parts, because the parts model's answer for the brief's parts
 * failed twice. The creator can say so ("cut as the standard ten parts").
 */
export type Decomposition = "named" | "fallback";

/** Body of `GET /api/forge/:jobId`. Optional fields are omitted, never null. */
export interface JobView {
  jobId: string;
  status: ForgeStatus;
  plane: "replay" | "live";
  /** Available from status "segmenting" on. */
  portraitUrl?: string;
  /**
   * Once the job is awake: at "done", and at "expressing" once the eye step has settled (the rig's
   * structure is final; forge-creator C1). Each `layer.file` is a key in `assets`. While
   * "expressing", later views only add `Layer.variants` patches and their files.
   */
  rig?: Rig;
  /** file -> URL (https Blob URL on live, data: URL on replay/dev); sent with `rig`. */
  assets?: Record<string, string>;
  fill?: "edit" | "fallback";
  /** Brief jobs only, once the parts step has decided. */
  decomposition?: Decomposition;
  /** Live jobs from "expressing" on (character-control): what each expression family came to. */
  expressions?: Partial<Record<ExpressionFamily, "ok" | "skipped" | "failed">>;
  error?: { code: ForgeErrorCode; message: string };
}
