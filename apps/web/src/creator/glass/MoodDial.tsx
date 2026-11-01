// The mood dial (costume 3.1, `r1/creator-b.html` `.dial`): ten emotions round a bakelite knob.
// The knob is a slider (arrow keys, Home, End; a press turns it one step), each emotion a button;
// either writes Look.emotion. Arrow keys are kept from the shell, which steps channels on them.
import type { Emotion } from "@sr/rig";
import type { KeyboardEvent } from "react";
import styles from "./Signal.module.css";

export const EMOTIONS: readonly Emotion[] = ["neutral", "amused", "smug", "irritated", "furious", "delighted", "bored", "suspicious", "grim", "theatrical"];

/** The knob's pointer angle for emotion `i`: a 270-degree sweep from lower left. */
export const angleOf = (i: number): number => -135 + i * 30;

/** Where emotion `i` sits round the knob, rem from the dial's centre. */
function placeOf(i: number): { x: number; y: number } {
  const a = (angleOf(i) * Math.PI) / 180;
  return { x: Math.sin(a) * 7.4, y: -Math.cos(a) * 5.3 };
}

export function MoodDial({ value, onChange }: { value: Emotion; onChange: (emotion: Emotion) => void }) {
  const at = Math.max(0, EMOTIONS.indexOf(value));
  const step = (i: number): void => {
    const next = EMOTIONS[(i + EMOTIONS.length) % EMOTIONS.length];
    if (next !== undefined) onChange(next);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "ArrowRight" || event.key === "ArrowUp") step(at + 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") step(at - 1);
    else if (event.key === "Home") step(0);
    else if (event.key === "End") step(EMOTIONS.length - 1);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <section className={styles.card} aria-labelledby="dial-title">
      <h2 id="dial-title" className={styles.cardTitle}>
        MOOD DIAL <small>{value}</small>
      </h2>
      <div className={styles.dial}>
        <div
          className={styles.knob}
          role="slider"
          tabIndex={0}
          aria-label="Expression"
          aria-valuemin={0}
          aria-valuemax={EMOTIONS.length - 1}
          aria-valuenow={at}
          aria-valuetext={value}
          style={{ transform: `rotate(${angleOf(at)}deg)` }}
          onKeyDown={onKeyDown}
          onClick={() => step(at + 1)}
        />
        <span className={styles.knobFace} aria-hidden="true">
          EXPRESSION
        </span>
        {EMOTIONS.map((emotion, i) => {
          const { x, y } = placeOf(i);
          return (
            <button
              key={emotion}
              type="button"
              className={styles.emo}
              style={{ insetInlineStart: `calc(50% + ${x.toFixed(2)}rem)`, insetBlockStart: `calc(50% + ${y.toFixed(2)}rem)` }}
              aria-pressed={emotion === value}
              tabIndex={-1}
              onClick={() => onChange(emotion)}
            >
              {emotion}
            </button>
          );
        })}
      </div>
    </section>
  );
}
