// What the image model is asked for each mouth shape: an edit of the character's own mouth crop
// that changes only the lips, teeth and tongue, so the art stays the character's.
import type { MouthShape } from "../page/lip/mouth/shapes.js";

export const SHAPE_WORDS: Readonly<Record<Exclude<MouthShape, "rest">, string>> = {
  openWide: "wide open, as when saying \"ah\": the jaw dropped, the upper teeth and the tongue just visible inside",
  openMid: "half open, as when saying \"eh\": relaxed lips, a dark gap, a hint of the upper teeth",
  round: "rounded and pushed forward into a small \"oo\" circle, the lips pursed",
  closed: "closed, the lips pressed firmly together as when saying \"p\" or \"m\"",
  teeth: "nearly closed with the upper teeth resting on the lower lip, as when saying \"f\" or \"v\"",
  tongue: "slightly open with the tongue tip touching behind the upper teeth, as when saying \"l\" or \"th\"",
  narrow: "spread wide and narrow, as when saying \"ee\": the teeth almost together and visible",
};

export function shapePrompt(name: string, shape: MouthShape): string {
  const words = shape === "rest" ? "relaxed and closed" : SHAPE_WORDS[shape];
  return [
    `Edit this close-up crop of ${name}'s mouth. Change ONLY the mouth: make it ${words}.`,
    "Keep the same character, art style, colours, lighting and skin, and every pixel outside the lips, teeth and tongue.",
    "The mouth stays exactly where it is and the same width; the framing does not move.",
    "Do not add text, borders, frames or objects.",
  ].join(" ");
}
