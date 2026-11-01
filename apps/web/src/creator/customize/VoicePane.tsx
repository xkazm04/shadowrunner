// The VOICE sheet: the character's voice from the fixed list (`VOICES`, owned by voice-and-air),
// stored on the library record. On replay the only recorded lines are the show's (Clerk), so the
// preview says what will actually be heard.
import { VOICE_IDS, VOICES, type VoiceId } from "@sr/engine";
import styles from "./Customize.module.css";

export interface VoicePaneProps {
  voice: VoiceId;
  onVoice: (voice: VoiceId) => void;
  onSpeak: () => void;
  speaking: boolean;
}

export function VoicePane({ voice, onVoice, onSpeak, speaking }: VoicePaneProps) {
  return (
    <>
      <section className={styles.row} aria-labelledby="voice-list">
        <h3 id="voice-list" className={styles.heading}>
          Voice
        </h3>
        <div className={styles.voices} role="group" aria-labelledby="voice-list">
          {VOICE_IDS.map((id) => {
            const [name, ...rest] = VOICES[id].label.split(":");
            return (
              <button key={id} type="button" className={styles.voice} aria-pressed={voice === id} onClick={() => onVoice(id)}>
                <b>{name}</b>
                <span>{rest.join(":").trim()}</span>
              </button>
            );
          })}
        </div>
      </section>
      <div className={styles.actions}>
        <button type="button" className={`${styles.button} ${styles.signal}`} onClick={onSpeak}>
          {speaking ? "Stop the line" : "Hear a recorded line"}
        </button>
        <span className={styles.note}>
          {voice === "clerk" ? "Recorded in this voice." : "Recorded lines exist in Clerk only; this voice speaks live, on air."}
        </span>
      </div>
    </>
  );
}
