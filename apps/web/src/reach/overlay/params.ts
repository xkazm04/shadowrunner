// The overlay's URL (spec avatar-reach, requirement 3.2): parsed by the page, built by the setup
// card. Pure, so both halves are table-tested.
//
// Decisions the spec leaves open:
// - `pack` wins over `character` when both are given (a pack also plays in OBS's own browser).
// - `bg` takes `transparent`, `green` or `#rrggbb`; the `#` may be left out (a bare `#` in a pasted
//   URL starts the fragment). Anything else is transparent: the safe default for a browser source.
// - `mic` listens for `1` or `true`; `mood` must be an emotion name, else the character's own look.
import { EMOTION_FAMILY, type Emotion } from "@sr/rig";

export type OverlayBackground = "transparent" | "green" | `#${string}`;

/** The overlay plays a pack (cast slug or URL) or a library character on this browser. */
export type OverlaySource = { pack: string } | { character: string };

export interface OverlayParams {
  source?: OverlaySource;
  mood?: Emotion;
  bg: OverlayBackground;
  mic: boolean;
}

/** The usual chroma-key green (OBS's Chroma Key filter default is green). */
export const CHROMA_GREEN = "#00ff00";

const HEX = /^#?([0-9a-f]{6})$/;

export const isEmotion = (value: string): value is Emotion => Object.hasOwn(EMOTION_FAMILY, value);

function readBackground(value: string | null): OverlayBackground {
  const bg = (value ?? "").trim().toLowerCase();
  if (bg === "green") return "green";
  const hex = HEX.exec(bg);
  return hex === null ? "transparent" : `#${hex[1]}`;
}

function readSource(query: URLSearchParams): OverlaySource | undefined {
  const pack = query.get("pack")?.trim();
  if (pack) return { pack };
  const character = query.get("character")?.trim();
  return character ? { character } : undefined;
}

export function parseOverlayParams(search: string): OverlayParams {
  const query = new URLSearchParams(search);
  const source = readSource(query);
  const mood = query.get("mood")?.trim().toLowerCase();
  const mic = query.get("mic")?.trim().toLowerCase();
  return {
    ...(source === undefined ? {} : { source }),
    ...(mood !== undefined && isEmotion(mood) ? { mood } : {}),
    bg: readBackground(query.get("bg")),
    mic: mic === "1" || mic === "true",
  };
}

/** The CSS colour the page is painted with for `bg`. */
export function backgroundColour(bg: OverlayBackground): string {
  return bg === "green" ? CHROMA_GREEN : bg;
}

/** `<origin>/overlay?...` with only the parameters that differ from the defaults. */
export function buildOverlayUrl(origin: string, params: OverlayParams): string {
  const query = new URLSearchParams();
  if (params.source !== undefined) {
    if ("pack" in params.source) query.set("pack", params.source.pack);
    else query.set("character", params.source.character);
  }
  if (params.mood !== undefined) query.set("mood", params.mood);
  if (params.bg !== "transparent") query.set("bg", params.bg);
  if (params.mic) query.set("mic", "1");
  const text = query.toString();
  return `${origin.replace(/\/+$/, "")}/overlay${text === "" ? "" : `?${text}`}`;
}
