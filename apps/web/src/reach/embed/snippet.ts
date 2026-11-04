// The copy-paste snippet the /embed page offers (spec avatar-reach, design "Embed"): the script
// from this deploy and one <sr-avatar> on a cast pack, both as absolute URLs.
import type { Emotion } from "@sr/rig";
import { packUrlOf } from "../playable";

export const SCRIPT_PATH = "/embed/sr-avatar.js";

/** `origin` is e.g. `https://shadowrunner.example`; `mood` is left out when unset (the pack's saved look). */
export function embedSnippet(origin: string, slug: string, mood?: Emotion): string {
  const moodAttr = mood === undefined ? "" : ` mood="${mood}"`;
  return `<script type="module" src="${origin}${SCRIPT_PATH}"></script>\n<sr-avatar src="${origin}${packUrlOf(slug)}"${moodAttr}></sr-avatar>`;
}
