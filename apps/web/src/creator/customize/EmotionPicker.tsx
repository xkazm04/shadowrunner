// Ten emotions (creator requirement 1.3): one key each, the current one pressed; choosing one
// writes `look.emotion`.
import type { Emotion } from "@sr/rig";
import styles from "./Customize.module.css";

export const EMOTIONS: readonly Emotion[] = [
  "neutral",
  "amused",
  "smug",
  "irritated",
  "furious",
  "delighted",
  "bored",
  "suspicious",
  "grim",
  "theatrical",
];

export function EmotionPicker({ value, onChange }: { value: Emotion; onChange: (emotion: Emotion) => void }) {
  return (
    <div className={styles.keys} role="group" aria-label="Expression">
      {EMOTIONS.map((emotion) => (
        <button key={emotion} type="button" className={styles.key} aria-pressed={value === emotion} onClick={() => onChange(emotion)}>
          {emotion}
        </button>
      ))}
    </div>
  );
}
