// @sr/forge/wire: the forge wire contract (forge-pipeline design.md "Contracts (wire names)").
// Types only, so it is safe to import in the browser. This is the ONLY declaration of these
// names; the creator imports them from "@sr/forge/wire" and never redeclares them.
import type { Rig } from "@sr/rig";
import type { PartRole } from "./types.js";

/** Job status, in step order. `filling` sits between `cutting` and `done`. */
export type ForgeStatus = "queued" | "portrait" | "segmenting" | "cutting" | "filling" | "done" | "failed";

/** Error codes that may cross the API in `{ error: { code, message } }`. */
export type ForgeErrorCode = "quota" | "refused_likeness" | "refused_content" | "upstream" | "bad_input";

/** Body of `POST /api/forge`; answered with `202 { jobId }`. */
export interface ForgeRequest {
  mode: "prompt" | "image" | "brief";
  prompt?: string;
  imageBase64?: string;
  /** mode "brief" (cast-forge 4.3): the brief the streamer approved, checked again by the server. */
  brief?: CharacterBrief;
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
  /** 6..16 parts. */
  parts: BriefPart[];
  style: { name: string; why: string };
  /** At most 900 characters. */
  portrait_prompt: string;
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

/** Body of `GET /api/forge/:jobId`. Optional fields are omitted, never null. */
export interface JobView {
  jobId: string;
  status: ForgeStatus;
  plane: "replay" | "live";
  /** Available from status "segmenting" on. */
  portraitUrl?: string;
  /** Only when status is "done"; each `layer.file` is a key in `assets`. */
  rig?: Rig;
  /** file -> URL (https Blob URL on live, data: URL on replay/dev). */
  assets?: Record<string, string>;
  fill?: "edit" | "fallback";
  error?: { code: ForgeErrorCode; message: string };
}
