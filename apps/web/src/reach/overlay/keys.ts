// The overlay's own keys (spec avatar-reach, requirement 3.4): 1-6 one mood per expression family,
// 0 neutral, G a gesture. Listened for on window in the capture phase so the shell's hotkeys (a
// window bubble listener: 1-6 and 0 are channels) never see them; every other key, Esc included,
// still reaches the shell.
import { EMOTION_FAMILY, EXPRESSION_FAMILIES, type Emotion, type ExpressionFamily, type Gesture } from "@sr/rig";

function firstOf(family: ExpressionFamily): Emotion {
  const emotion = (Object.keys(EMOTION_FAMILY) as Emotion[]).find((e) => EMOTION_FAMILY[e] === family);
  if (emotion === undefined) throw new Error(`overlay keys: no emotion in the family ${family}`);
  return emotion;
}

/** Key -> emotion: `1`-`6` the first emotion of each family (EXPRESSION_FAMILIES order), `0` neutral. */
export const MOOD_KEYS: Readonly<Record<string, Emotion>> = Object.freeze(
  Object.fromEntries([["0", "neutral"], ...EXPRESSION_FAMILIES.map((family, i) => [String(i + 1), firstOf(family)])]),
);

export const GESTURE_KEY = "g";
export const OVERLAY_GESTURE: Gesture = "nod";

export type OverlayKeyAction = { kind: "mood"; emotion: Emotion } | { kind: "gesture"; gesture: Gesture };

type KeyLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">;

/** The overlay's action for a key, or undefined for keys it does not own (modified keys included). */
export function overlayKeyAction(event: KeyLike): OverlayKeyAction | undefined {
  if (event.ctrlKey || event.metaKey || event.altKey) return undefined;
  const key = event.key.toLowerCase();
  if (key === GESTURE_KEY) return { kind: "gesture", gesture: OVERLAY_GESTURE };
  const emotion = MOOD_KEYS[key];
  return emotion === undefined ? undefined : { kind: "mood", emotion };
}

/** Listens until the returned function is called. Owned keys stop there (no shell hotkey fires). */
export function listenOverlayKeys(target: Window, onAction: (action: OverlayKeyAction) => void): () => void {
  function onKeyDown(event: KeyboardEvent) {
    const action = overlayKeyAction(event);
    if (action === undefined) return;
    event.stopPropagation();
    event.preventDefault();
    if (!event.repeat && !event.isComposing) onAction(action);
  }
  target.addEventListener("keydown", onKeyDown, { capture: true });
  return () => target.removeEventListener("keydown", onKeyDown, { capture: true });
}
