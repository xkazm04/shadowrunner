// Model prompts, verbatim from forge-pipeline design.md "Prompts (exact)". Line breaks in the
// design are joined with single spaces. Do not edit these strings without editing design.md.

export const HOUSE_STYLE =
  "Original character portrait, head and shoulders bust, facing the camera, centred, symmetrical framing, theatrical horror, painterly realism, dramatic rim light, the face clearly separated from the body, the jaw and eyes clearly visible, near-black (#050505) empty background, no text, no logos, no frame, not a real person, no gore, 1:1.";

/** At most this many characters of the user's text reach the image model. */
export const MAX_CHARACTER_TEXT = 400;

/** Portrait prompt for `mode: "prompt"` (requirement 2.1). */
export function portraitPrompt(text: string): string {
  return `${HOUSE_STYLE} The character: ${text.slice(0, MAX_CHARACTER_TEXT)}`;
}

/** Image-edit prompt that redraws an accepted upload in the house style (requirement 2.3). */
export function restylePrompt(): string {
  return `Redraw this image as: ${HOUSE_STYLE} Keep the character's defining features, costume and colours.`;
}

/** Upload classification prompt for the segmentation model, JSON response (requirement 2.2). */
export const LIKENESS_PROMPT =
  'Classify this image. Return {"real_person": boolean, "unsafe": boolean, "reason": string}. real_person is true if it shows a photograph or realistic depiction of an identifiable real human face. unsafe is true for sexual content, gore or hate symbols.';

/** Part polygon prompt for the segmentation model, JSON response (requirement 3.1). */
export const PARTS_PROMPT =
  'This is a character portrait to be cut into animation layers. For each visible part among: head (skull/face, excluding crown, hair, hat and jaw), jaw (lower jaw that moves when speaking), eye_l (character\'s left eye), eye_r, monocle, crown (all crown spikes together), hat, hair, accessory (one other worn object on the head), torso (shoulders/robe), return a tight polygon outline. Return JSON: [{"name": string, "box_2d": [ymin,xmin,ymax,xmax], "poly": [[y,x],...]}] with coordinates normalized to 0-1000, 8-40 points per polygon, clockwise. Omit parts that are not visible.';

/** Image-edit prompt that paints the surface behind lifted parts (requirement 5.2). */
export function fillPrompt(parts: readonly string[]): string {
  return `Same image, same framing and lighting. Remove the ${parts.join(", ")} and paint the plausible surface that would be behind them. Change nothing else.`;
}
