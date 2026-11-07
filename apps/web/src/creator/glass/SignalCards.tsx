// The right column's lower cards (costume 3.1, `r1/creator-b.html` GESTURE, VOICE and the actions):
// six gestures, the five voices with "speak a line" and its transcript typed out, and the two
// channel actions (Put on air to CH 2, Characters to CH 4) taken from the page manifest. Put on air
// records the character first (`sr.onAir`, character-control), so the stage shows it.
// "Export pack" (spec avatar-pack) opens the Export sheet for any character but the seeded Malakor.
// C4: a forged character's sheet (archetype, hook, example lines) is shown under VOICE, read-only.
import { VOICE_IDS, VOICES, type VoiceId } from "@sr/engine";
import type { CharacterSheet } from "@sr/pack";
import type { Gesture } from "@sr/rig";
import { useEffect, useState } from "react";
import { PAGES } from "../../app/pages";
import { handleLinkClick } from "../../app/router";
import { writeOnAir } from "../../air/onAir";
import { ExportSheet } from "../library/ExportSheet";
import type { CharacterRecord } from "../library/libraryStore";
import { canExport } from "../library/packing";
import { GESTURES, gestureLabel } from "./gestures";
import anatomy from "./Anatomy.module.css";
import styles from "./Signal.module.css";

export function GestureCard({ onGesture }: { onGesture: (gesture: Gesture) => void }) {
  return (
    <section className={styles.card} aria-labelledby="gesture-title">
      <h2 id="gesture-title" className={styles.cardTitle}>
        GESTURE
      </h2>
      <div className={styles.gestures}>
        {GESTURES.map((g) => (
          <button key={g} type="button" className={styles.key} onClick={() => onGesture(g)}>
            {gestureLabel(g)}
          </button>
        ))}
      </div>
    </section>
  );
}

const reduced = (): boolean => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** `text` typed out two characters at a time (all at once under reduced motion). */
export function useTyped(text: string | undefined, stepMs = 104): string {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (text === undefined) return undefined;
    if (reduced()) {
      setShown(text.length);
      return undefined;
    }
    setShown(0);
    const timer = setInterval(() => setShown((n) => (n >= text.length ? n : n + 2)), stepMs);
    return () => clearInterval(timer);
  }, [text, stepMs]);
  return text === undefined ? "" : text.slice(0, shown);
}

export interface VoiceCardProps {
  voice: VoiceId;
  onVoice: (voice: VoiceId) => void;
  onSpeak: () => void;
  speaking: boolean;
  /** The line being spoken. */
  line?: string;
}

export function VoiceCard({ voice, onVoice, onSpeak, speaking, line }: VoiceCardProps) {
  const typed = useTyped(line);
  const [, description] = VOICES[voice].label.split(":");
  return (
    <section className={styles.card} aria-labelledby="voice-title">
      <h2 id="voice-title" className={styles.cardTitle}>
        VOICE
      </h2>
      <div className={styles.voices} role="group" aria-labelledby="voice-title">
        {VOICE_IDS.map((id) => (
          <button key={id} type="button" className={styles.key} aria-pressed={voice === id} onClick={() => onVoice(id)}>
            {VOICES[id].label.split(":")[0]}
          </button>
        ))}
      </div>
      <p className={styles.voiceNote}>
        {description?.trim()}
        {voice === "clerk" ? " · recorded in this voice" : " · on replay, lines are Clerk's"}
      </p>
      <button type="button" className={styles.speak} onClick={onSpeak}>
        {speaking ? "Stop the line" : "Speak a line"}
      </button>
      <p className={styles.transcript}>
        <span aria-hidden="true">{line === undefined ? "" : typed}</span>
        <span className={anatomy.srOnly} aria-live="polite">
          {line ?? ""}
        </span>
      </p>
    </section>
  );
}

/** C4: who a forged character is on air, from the brief the streamer approved (read-only). */
export function SheetCard({ sheet }: { sheet: CharacterSheet }) {
  return (
    <section className={styles.card} aria-labelledby="sheet-title" data-sheet="">
      <h2 id="sheet-title" className={styles.cardTitle}>
        ON AIR AS <small>{sheet.archetype}</small>
      </h2>
      <p className={styles.voiceNote}>{sheet.hook}</p>
      {sheet.lines.length > 0 && (
        <ul className={styles.sheetLines} aria-label="Its lines">
          {sheet.lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

const onAir = PAGES.find((p) => p.id === "landing");
const characters = PAGES.find((p) => p.id === "characters");

export function ChannelActions({ recordId, record }: { recordId?: string; record?: CharacterRecord }) {
  const [exporting, setExporting] = useState(false);
  return (
    <nav className={styles.actions} aria-label="Channels from the forge">
      {onAir !== undefined && (
        <a
          href={onAir.path}
          className={`${styles.action} ${styles.air}`}
          data-on-air=""
          onClick={(event) => {
            if (recordId !== undefined) writeOnAir(recordId);
            handleLinkClick(event, onAir.path);
          }}
        >
          Put on air <kbd>CH {onAir.channel}</kbd>
        </a>
      )}
      {characters !== undefined && (
        <a href={characters.path} className={styles.action} onClick={(event) => handleLinkClick(event, characters.path)}>
          Characters <kbd>CH {characters.channel}</kbd>
        </a>
      )}
      {record !== undefined && canExport(record) && (
        <button type="button" className={`${styles.action} ${styles.exportAction}`} data-export-pack="" onClick={() => setExporting(true)}>
          Export pack <kbd>.srpack</kbd>
        </button>
      )}
      {exporting && record !== undefined && <ExportSheet record={record} onClose={() => setExporting(false)} />}
    </nav>
  );
}
