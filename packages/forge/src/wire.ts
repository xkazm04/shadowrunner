// @sr/forge/wire: the forge wire contract (forge-pipeline design.md "Contracts (wire names)").
// Types only, so it is safe to import in the browser. This is the ONLY declaration of these
// names; the creator imports them from "@sr/forge/wire" and never redeclares them.
import type { Rig } from "@sr/rig";

/** Job status, in step order. `filling` sits between `cutting` and `done`. */
export type ForgeStatus = "queued" | "portrait" | "segmenting" | "cutting" | "filling" | "done" | "failed";

/** Error codes that may cross the API in `{ error: { code, message } }`. */
export type ForgeErrorCode = "quota" | "refused_likeness" | "refused_content" | "upstream" | "bad_input";

/** Body of `POST /api/forge`; answered with `202 { jobId }`. */
export interface ForgeRequest {
  mode: "prompt" | "image";
  prompt?: string;
  imageBase64?: string;
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
