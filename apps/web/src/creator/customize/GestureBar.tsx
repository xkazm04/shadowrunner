// Six gestures (creator requirement 1.3). Gestures are events, not state (design.md): a press
// calls `onGesture`, and the page pulses the `<AvatarCanvas gesture>` prop (useGesturePulse).
import type { Gesture } from "@sr/rig";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./Customize.module.css";

export const GESTURES: readonly Gesture[] = ["nod", "tilt", "lean_in", "recoil", "glare", "flare"];

export const gestureLabel = (g: Gesture): string => g.replace("_", " ");

export function GestureBar({ onGesture }: { onGesture: (gesture: Gesture) => void }) {
  return (
    <div className={`${styles.keys} ${styles.keys6}`} role="group" aria-label="Gesture">
      {GESTURES.map((g) => (
        <button key={g} type="button" className={styles.key} onClick={() => onGesture(g)}>
          {gestureLabel(g)}
        </button>
      ))}
    </div>
  );
}

/** How long the gesture prop holds its value before it returns to undefined (so a repeat fires). */
export const PULSE_MS = 120;

/**
 * The gesture prop for <AvatarCanvas>: `fire(g)` sets it for one pulse, then clears it, because
 * the canvas plays a gesture on every change to a defined value. A press during a pulse clears
 * first and fires on the next tick, so every press plays exactly once.
 */
export function useGesturePulse(): [Gesture | undefined, (gesture: Gesture) => void] {
  const [gesture, setGesture] = useState<Gesture | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fire = useCallback((g: Gesture) => {
    clearTimeout(timer.current);
    setGesture(undefined);
    timer.current = setTimeout(() => {
      setGesture(g);
      timer.current = setTimeout(() => setGesture(undefined), PULSE_MS);
    }, 0);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [gesture, fire];
}
