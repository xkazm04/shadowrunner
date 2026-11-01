// The customize panel (creator requirement 1), as the two parchment sheets of the reference:
// LOOKS (the lights and the parts) and FACE (expression, gesture, speak a line). Both only render
// the look and dispatch LookActions; the page owns the state.
import type { Emotion, Gesture, Look, Palette, Rig } from "@sr/rig";
import type { Dispatch } from "react";
import { EmotionPicker } from "./EmotionPicker";
import { GestureBar } from "./GestureBar";
import type { LookAction } from "./lookReducer";
import { PaletteField } from "./PaletteField";
import { PartToggles } from "./PartToggles";
import styles from "./Customize.module.css";

const LIGHTS: readonly (keyof Palette)[] = ["eye", "glow", "rim", "mouth"];

export interface LooksPaneProps {
  rig: Rig;
  look: Look;
  dispatch: Dispatch<LookAction>;
}

export function LooksPane({ rig, look, dispatch }: LooksPaneProps) {
  const changed = JSON.stringify(look.palette) !== JSON.stringify(rig.palette) || look.hidden.length > 0 || look.emotion !== "neutral";
  return (
    <>
      <section className={styles.row} aria-labelledby="looks-light">
        <h3 id="looks-light" className={styles.heading}>
          Light
        </h3>
        {LIGHTS.map((key) => (
          <PaletteField
            key={key}
            name={key}
            value={look.palette[key]}
            original={rig.palette[key]}
            onChange={(k, value) => dispatch({ type: "palette", key: k, value })}
          />
        ))}
      </section>
      <section className={styles.row} aria-labelledby="looks-parts">
        <h3 id="looks-parts" className={styles.heading}>
          Parts
        </h3>
        <PartToggles rig={rig} hidden={look.hidden} onToggle={(layer) => dispatch({ type: "toggle", layer })} />
        <p className={styles.note}>A lit lamp is a part on the face. Press one to lift it off; press again to put it back.</p>
      </section>
      <div className={styles.actions}>
        <button type="button" className={styles.button} disabled={!changed} onClick={() => dispatch({ type: "reset", rig })}>
          Reset look
        </button>
      </div>
    </>
  );
}

export interface FacePaneProps {
  look: Look;
  onEmotion: (emotion: Emotion) => void;
  onGesture: (gesture: Gesture) => void;
  onSpeak: () => void;
  speaking: boolean;
  /** One line under the speak button (what will be heard, or why nothing can be). */
  speakNote: string;
}

export function FacePane({ look, onEmotion, onGesture, onSpeak, speaking, speakNote }: FacePaneProps) {
  return (
    <>
      <section className={styles.row} aria-labelledby="face-emotion">
        <h3 id="face-emotion" className={styles.heading}>
          Expression · ten emotions
        </h3>
        <EmotionPicker value={look.emotion} onChange={onEmotion} />
      </section>
      <section className={styles.row} aria-labelledby="face-gesture">
        <h3 id="face-gesture" className={styles.heading}>
          Gesture · six moves
        </h3>
        <GestureBar onGesture={onGesture} />
      </section>
      <div className={styles.actions}>
        <button type="button" className={`${styles.button} ${styles.signal}`} onClick={onSpeak}>
          {speaking ? "Stop the line" : "Speak a line"}
        </button>
        <span className={styles.note}>{speakNote}</span>
      </div>
    </>
  );
}
