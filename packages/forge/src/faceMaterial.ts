// forge-creator C3, material-aware live faces + capped retries. Two pure pieces the live forge's
// eye and expression steps share:
// - `eyesMaterial`: the brief's one editable line "Its eyes are ..." (`CharacterBrief.face.eyes`)
//   as the full sentence the image edits carry (expressionPrompt's `material`, irisFreePrompt and
//   closedEyesPrompt's material frames). The offline cast learned it the hard way
//   (scripts/cast/five/prompts.mjs header; docs/provenance.md): brows/eyelids/irises wording makes
//   the editor paint human eyes on a pumpkin, a skull, a helm or a glass creature.
// - `faceRetry`: what a family the stability gate (or the unsocketed drift flag) refused does next:
//   re-run with attempt + 1 (expressionPrompt's STRICTER sentences, docs/provenance.md: 22 passes
//   over 37 STRICTER re-runs), up to MAX_FACE_ATTEMPT per family and MAX_EXTRA_EDITS per forge.
// Browser-safe and pure.

/** The last attempt a refused family is re-run at (STRICTER has two sentences: attempts 1 and 2). */
export const MAX_FACE_ATTEMPT = 2;
/** Re-run edits one forge may spend over its six families (each charged like any expression edit). */
export const MAX_EXTRA_EDITS = 4;

/**
 * The eyes line as one sentence, or undefined when there is none (a blank line is none). The line is
 * what follows "Its eyes are": a typed "Its eyes are" prefix and trailing full stops are dropped so
 * the sentence never doubles them.
 */
export function eyesMaterial(eyes: string | undefined): string | undefined {
  const line = (eyes ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^its eyes are\s*/i, "")
    .replace(/[\s.;]+$/, "");
  if (line === "") return undefined;
  return `Its eyes are ${line}; keep them exactly that material and never paint human eyeballs, irises or eyelids on them.`;
}

/** What the gate said of one family's edit: kept ("ok"), refused by the gate ("refused"), or any other end. */
export type FaceVerdict = "ok" | "refused" | "skipped" | "failed";

export interface FaceRetryState {
  /** The attempt that just ran (0 = the first edit). */
  attempt: number;
  /** Re-run edits this forge has already spent. */
  extraEdits: number;
}

/** Re-run the same family at `attempt`, or settle it with `outcome`. */
export type FaceNext = { retry: true; attempt: number } | { retry: false; outcome: "ok" | "skipped" | "failed" };

/**
 * The next move after one family's edit: a gate refusal is re-run at attempt + 1 while the attempt
 * is under MAX_FACE_ATTEMPT and the forge has spent fewer than MAX_EXTRA_EDITS re-runs; a refusal
 * past either cap settles "skipped" (as before C3). Every other verdict settles as it is.
 */
export function faceRetry(verdict: FaceVerdict, state: FaceRetryState): FaceNext {
  if (verdict !== "refused") return { retry: false, outcome: verdict };
  if (state.attempt < MAX_FACE_ATTEMPT && state.extraEdits < MAX_EXTRA_EDITS) return { retry: true, attempt: state.attempt + 1 };
  return { retry: false, outcome: "skipped" };
}
