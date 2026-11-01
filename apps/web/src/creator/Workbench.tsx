// One character on the bench: its look (lookReducer, kept in the library shortly after each
// change), the stage and the tabbed controls. Keyed by the character, so a switch starts clean.
// The page hands in what is not about this character: the forge sheet, a stage overlay while a
// forge runs, and the regions under the controls.
import type { VoiceId } from "@sr/engine";
import { resolveGesture, type Emotion, type Gesture, type Look } from "@sr/rig";
import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { FacePane, LooksPane } from "./customize/Customize";
import { gestureLabel, useGesturePulse } from "./customize/GestureBar";
import { lookReducer } from "./customize/lookReducer";
import { VoicePane } from "./customize/VoicePane";
import type { CharacterRecord } from "./library/libraryStore";
import { useRigAssets, type Library } from "./library/useLibrary";
import { ChannelActions } from "./ChannelActions";
import { Stage, useSpeaker } from "./Stage";
import styles from "./CreatorPage.module.css";

export type Tab = "looks" | "face" | "voice" | "forge";

export const TABS: readonly { id: Tab; label: string }[] = [
  { id: "looks", label: "LOOKS" },
  { id: "face", label: "FACE" },
  { id: "voice", label: "VOICE" },
  { id: "forge", label: "FORGE NEW" },
];

/** How long after the last change a look is written to the library. */
export const SAVE_DELAY_MS = 400;

export interface WorkbenchProps {
  record: CharacterRecord;
  library: Library;
  tab: Tab;
  onTab: (tab: Tab) => void;
  /** The FORGE NEW sheet. */
  forge?: ReactNode;
  /** Shown in the sheet instead of the open tab (the replay gallery). */
  sheet?: ReactNode;
  /** Over the stage (forge progress); the face stays underneath. */
  stageOverlay?: ReactNode;
  /** Label on the stage (RECORDED). */
  badge?: ReactNode;
  /** Set when this character was just forged: plays the reveal and speaks one line. */
  revealKey?: string;
  /** Under the panel: the library. */
  below?: ReactNode;
  /** What the stage caption says the face is doing, when the page knows better (a forge running). */
  motion?: string;
}

function TabList({ tab, onTab }: { tab: Tab; onTab: (tab: Tab) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (index: number): void => {
    const next = TABS[(index + TABS.length) % TABS.length];
    if (next === undefined) return;
    onTab(next.id);
    refs.current[(index + TABS.length) % TABS.length]?.focus();
  };
  return (
    <div className={styles.tabs} role="tablist" aria-label="Controls">
      {TABS.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`tab-${t.id}`}
          aria-controls="creator-sheet"
          aria-selected={tab === t.id}
          tabIndex={tab === t.id ? 0 : -1}
          className={styles.tab}
          onClick={() => onTab(t.id)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") move(i + 1);
            else if (event.key === "ArrowLeft") move(i - 1);
            else if (event.key === "Home") move(0);
            else if (event.key === "End") move(TABS.length - 1);
            else return;
            event.preventDefault();
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Workbench({ record, library, tab, onTab, forge, sheet, stageOverlay, badge, revealKey, below, motion: pageMotion }: WorkbenchProps) {
  const [look, dispatch] = useReducer(lookReducer, record.look);
  const [gesture, fireGesture] = useGesturePulse();
  const [lastGesture, setLastGesture] = useState<string | undefined>(undefined);
  const { assets, failed } = useRigAssets(record);
  const speaker = useSpeaker((line) => {
    if (line.reply.gesture !== undefined) fireGesture(line.reply.gesture);
  });

  // Keep the look: written shortly after the last change, only when it differs from the stored one.
  const stored = useRef<Look>(record.look);
  const saveLook = library.saveLook;
  useEffect(() => {
    if (look === stored.current) return undefined;
    const timer = setTimeout(() => {
      stored.current = look;
      void saveLook(record.id, look);
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [look, record.id, saveLook]);

  // The reveal speaks one line once the face is drawn.
  const spoke = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (revealKey === undefined || assets === undefined || spoke.current === revealKey) return;
    spoke.current = revealKey;
    const timer = setTimeout(speaker.toggle, 1400);
    return () => clearTimeout(timer);
  }, [revealKey, assets, speaker.toggle]);

  const onGesture = useCallback(
    (g: Gesture) => {
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

  const onVoice = (voice: VoiceId) => void library.saveVoice(record.id, voice);

  const motion = failed
    ? "The face could not be drawn"
    : pageMotion !== undefined
      ? pageMotion
    : speaker.line !== undefined
      ? `Speaking · ${speaker.line.reply.emotion}`
      : gesture !== undefined && lastGesture !== undefined
        ? `Gesture · ${lastGesture}`
        : `${look.emotion === "neutral" ? "Idle" : look.emotion.charAt(0).toUpperCase() + look.emotion.slice(1)} · blinking`;

  return (
    <div className={styles.creator} data-page="creator">
      <div className={styles.stageRegion}>
        <Stage
          rig={record.rig}
          look={look}
          name={record.rig.name}
          motion={motion}
          {...(assets === undefined ? {} : { assets })}
          {...(gesture === undefined ? {} : { gesture })}
          {...(speaker.audio === undefined ? {} : { audio: speaker.audio })}
          {...(speaker.line === undefined ? {} : { subtitle: speaker.line.reply.line })}
          {...(revealKey === undefined ? {} : { revealKey })}
          {...(badge === undefined ? {} : { badge })}
        >
          {stageOverlay ??
            (assets === undefined ? <p className={styles.state}>{failed ? "This character's images could not be read." : "Lighting the face…"}</p> : undefined)}
        </Stage>
      </div>
      <div className={styles.controlsRegion}>
        <div className={styles.panelWrap}>
          <div className={styles.panel}>
            <TabList tab={tab} onTab={onTab} />
            <div className={styles.sheet} role="tabpanel" id="creator-sheet" aria-labelledby={`tab-${tab}`} tabIndex={0}>
              {sheet}
              {sheet === undefined && tab === "looks" && <LooksPane rig={record.rig} look={look} dispatch={dispatch} />}
              {sheet === undefined && tab === "face" && (
                <FacePane
                  look={look}
                  onEmotion={onEmotion}
                  onGesture={onGesture}
                  onSpeak={speaker.toggle}
                  speaking={speaker.line !== undefined}
                  speakNote="A recorded line from the replay show, in the Clerk voice."
                />
              )}
              {sheet === undefined && tab === "voice" && <VoicePane voice={record.voice} onVoice={onVoice} onSpeak={speaker.toggle} speaking={speaker.line !== undefined} />}
              {sheet === undefined && tab === "forge" && forge}
            </div>
            <ChannelActions />
          </div>
        </div>
        {below}
      </div>
    </div>
  );
}
