// The sentence a person reads when a pack fails, one per error code: shared by the creator's import,
// the studio and overlay (via reach/playable.ts) and the <sr-avatar> element, which cannot import
// app code. One map, so the wording cannot drift between them.
import type { PackError, PackErrorCode } from "./types.js";

const SENTENCES: Readonly<Record<PackErrorCode, (detail: string) => string>> = {
  not_a_pack: () => "That file is not a Shadowrunner pack.",
  newer_version: () => "That pack was made by a newer Shadowrunner.",
  bad_manifest: () => "That pack's details are damaged.",
  bad_rig: () => "That pack's character is damaged.",
  bad_look: () => "That pack's saved look is damaged.",
  missing_file: (detail) => `That pack is missing ${detail === "" ? "an image" : detail}.`,
  too_large: () => "That pack is over 50 MB.",
  fetch_failed: () => "That pack could not be fetched.",
};

/** The user-facing sentence for a failed pack read, load or import. */
export function packErrorSentence(error: PackError): string {
  return SENTENCES[error.code](error.detail);
}
