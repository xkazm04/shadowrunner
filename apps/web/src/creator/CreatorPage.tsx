// CH 3 · Forge: the creator page (spec creator). Regions: the stage (the face, the largest
// region), the controls (tabbed: LOOKS | FACE) and, from later tasks, the forge and the library.
import { resolveGesture, type Emotion, type Look } from "@sr/rig";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { FacePane, LooksPane } from "./customize/Customize";
import { gestureLabel, useGesturePulse } from "./customize/GestureBar";
import { lookReducer } from "./customize/lookReducer";
import type { CharacterRecord } from "./library/libraryStore";
import { useLibrary, useRigAssets, type Library } from "./library/useLibrary";
import { Stage, useSpeaker } from "./Stage";
import styles from "./CreatorPage.module.css";

type Tab = "looks" | "face";
const TABS: readonly { id: Tab; label: string }[] = [
  { id: "looks", label: "LOOKS" },
  { id: "face", label: "FACE" },
];

/** How long after the last change a look is written to the library. */
export const SAVE_DELAY_MS = 400;

export function Workbench({ record, library }: { record: CharacterRecord; library: Library }) {
  const [look, dispatch] = useReducer(lookReducer, record.look);
  const [tab, setTab] = useState<Tab>("looks");
  const [gesture, fireGesture] = useGesturePulse();
  const [lastGesture, setLastGesture] = useState<string | undefined>(undefined);
  const { assets, failed } = useRigAssets(record);
  const speaker = useSpeaker((line) => {
    if (line.reply.gesture !== undefined) fireGesture(line.reply.gesture);
  });

  // Keep the look: written shortly after the last change, only when it differs from the stored one.
  const stored = useRef<Look>(record.look);
  useEffect(() => {
    if (look === stored.current) return undefined;
    const timer = setTimeout(() => {
      stored.current = look;
      void library.saveLook(record.id, look);
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [look, record.id, library]);

  const onGesture = useCallback(
    (g: Parameters<typeof fireGesture>[0]) => {
      fireGesture(g);
      setLastGesture(gestureLabel(g));
    },
    [fireGesture],
  );

  const onEmotion = (emotion: Emotion) => {
    dispatch({ type: "emotion", emotion });
    const g = resolveGesture({ ...look, emotion });
    if (g !== undefined) onGesture(g);
  };

  const motion = speaker.line !== undefined ? `Speaking · ${speaker.line.reply.emotion}` : gesture !== undefined && lastGesture !== undefined ? `Gesture · ${lastGesture}` : `${look.emotion === "neutral" ? "Idle" : look.emotion} · blinking`;

  return (
    <div className={styles.creator} data-page="creator">
      <div className={styles.stageRegion}>
        <Stage
          rig={record.rig}
          look={look}
          name={record.rig.name}
          motion={failed ? "The face could not be drawn" : motion}
          {...(assets === undefined ? {} : { assets })}
          {...(gesture === undefined ? {} : { gesture })}
          {...(speaker.audio === undefined ? {} : { audio: speaker.audio })}
          {...(speaker.line === undefined ? {} : { subtitle: speaker.line.reply.line })}
        >
          {assets === undefined && <p className={styles.state}>{failed ? "This character's images could not be read." : "Lighting the face…"}</p>}
        </Stage>
      </div>
      <div className={styles.controlsRegion}>
        <div className={styles.tabs} role="tablist" aria-label="Controls">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-controls={`pane-${t.id}`}
              aria-selected={tab === t.id}
              tabIndex={tab === t.id ? 0 : -1}
              className={styles.tab}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className={styles.sheet} role="tabpanel" id={`pane-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === "looks" && <LooksPane rig={record.rig} look={look} dispatch={dispatch} />}
          {tab === "face" && (
            <FacePane
              look={look}
              onEmotion={onEmotion}
              onGesture={onGesture}
              onSpeak={speaker.toggle}
              speaking={speaker.line !== undefined}
              speakNote="A recorded line from the replay show, in the Clerk voice."
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function CreatorPage() {
  const library = useLibrary();
  if (library.active === undefined) {
    return (
      <div className={styles.creator} data-page="creator">
        <p className={styles.state}>{library.status === "loading" ? "Opening the library…" : "No character to show."}</p>
      </div>
    );
  }
  return <Workbench key={library.active.id} record={library.active} library={library} />;
}
