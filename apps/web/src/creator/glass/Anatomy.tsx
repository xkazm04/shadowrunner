// One character under glass (costume 3.1, `r1/creator-b.html`): the layer stack, the glass with
// its pinned lights, the mood dial, gestures and voices. Replaces the tabbed Workbench and keeps
// its state and logic: the look (lookReducer) is written to the library shortly after each change,
// the voice is stored on the record, "speak a line" plays a recorded line through the mouth.
// Keyed by the character, so a switch starts clean. The page hands in the cast strip.
import type { VoiceId } from "@sr/engine";
import { resolveGesture, type Emotion, type Gesture, type Look } from "@sr/rig";
import { useCallback, useEffect, useReducer, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { lookReducer } from "../customize/lookReducer";
import type { CharacterRecord } from "../library/libraryStore";
import { useRigAssets, type Library } from "../library/useLibrary";
import { useSpeaker } from "../useSpeaker";
import { Glass } from "./Glass";
import { gestureLabel, useGesturePulse } from "./gestures";
import { LayerRail, useBlobUrls } from "./LayerRail";
import { MoodDial } from "./MoodDial";
import { ChannelActions, GestureCard, VoiceCard } from "./SignalCards";
import styles from "./Anatomy.module.css";
import signal from "./Signal.module.css";

/** How long after the last change a look is written to the library. */
export const SAVE_DELAY_MS = 400;

export interface AnatomyProps {
  record: CharacterRecord;
  library: Library;
  /** Under the glass: the cast strip. */
  cast?: ReactNode;
  /** Next to the name (RECORDED). */
  badge?: ReactNode;
}

const title = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The chip on the glass: how many crown pieces are on, or how to lift the accessory. */
function liftChip(record: CharacterRecord, hidden: readonly string[]): string | undefined {
  const off = new Set(hidden);
  const crown = record.rig.layers.filter((l) => l.kind === "crown");
  if (crown.length > 0) {
    const on = crown.filter((l) => !off.has(l.name)).length;
    return `Crown ${on} / ${crown.length}${crown.length > 1 ? " pieces" : ""} · click one to lift it`;
  }
  const accessory = record.rig.layers.find((l) => l.kind === "accessory");
  return accessory === undefined ? undefined : `${title(accessory.name.replace(/_/g, " "))} ${off.has(accessory.name) ? "off" : "on"} · click it to lift`;
}

export function Anatomy({ record, library, cast, badge }: AnatomyProps) {
  const [look, dispatch] = useReducer(lookReducer, record.look);
  const [gesture, fireGesture] = useGesturePulse();
  const [lastGesture, setLastGesture] = useState<string | undefined>(undefined);
  const [highlight, setHighlight] = useState<string | undefined>(undefined);
  const { assets, failed } = useRigAssets(record);
  const thumbs = useBlobUrls(record.assets);
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

  const onGesture = useCallback(
    (g: Gesture) => {
      fireGesture(g);
      setLastGesture(gestureLabel(g));
    },
    [fireGesture],
  );

  const onEmotion = (emotion: Emotion): void => {
    dispatch({ type: "emotion", emotion });
    const g = resolveGesture({ ...look, emotion });
    if (g !== undefined) onGesture(g);
  };

  const onVoice = (voice: VoiceId): void => void library.saveVoice(record.id, voice);
  const toggle = (layer: string): void => dispatch({ type: "toggle", layer });

  const motion = failed
    ? "The face could not be drawn"
    : speaker.line !== undefined
      ? "Speaking"
      : gesture !== undefined && lastGesture !== undefined
        ? `Gesture · ${lastGesture}`
        : `${look.emotion === "neutral" ? "Idle" : title(look.emotion)} · blinking`;
  const shown = record.rig.layers.filter((l) => l.visible !== false && !look.hidden.includes(l.name)).length;
  const changed = JSON.stringify(look.palette) !== JSON.stringify(record.rig.palette) || look.hidden.length > 0 || look.emotion !== "neutral";
  const chip = liftChip(record, look.hidden);

  return (
    <div className={styles.anatomy} data-page="creator" style={{ "--lamp": look.palette.eye } as CSSProperties}>
      <LayerRail layers={record.rig.layers} thumbs={thumbs} hidden={look.hidden} onToggle={toggle} onHighlight={setHighlight} />
      <section className={styles.centre} aria-label={`The glass: ${record.rig.name}`}>
        <div className={styles.glassBox}>
          <Glass
            rig={record.rig}
            look={look}
            {...(assets === undefined ? {} : { assets })}
            {...(gesture === undefined ? {} : { gesture })}
            {...(speaker.audio === undefined ? {} : { audio: speaker.audio })}
            {...(highlight === undefined ? {} : { highlight })}
            onPalette={(key, value) => dispatch({ type: "palette", key, value })}
            onLift={toggle}
            {...(chip === undefined ? {} : { chip })}
          >
            {assets === undefined ? <p>{failed ? "This character's images could not be read." : "Lighting the face…"}</p> : undefined}
          </Glass>
        </div>
        <div className={styles.status}>
          <span>
            <b>{record.rig.name}</b> · live rig, {shown} {shown === 1 ? "layer" : "layers"} {badge}
          </span>
          <span className={styles.statusEnd}>
            <button type="button" className={styles.reset} disabled={!changed} onClick={() => dispatch({ type: "reset", rig: record.rig })}>
              Reset look
            </button>
            <span className={styles.lamp} data-motion-state="" data-speaking={speaker.line === undefined ? undefined : ""}>
              {motion}
            </span>
          </span>
        </div>
        {cast}
      </section>
      <aside className={signal.signal} aria-label="Signal">
        <MoodDial value={look.emotion} onChange={onEmotion} />
        <GestureCard onGesture={onGesture} />
        <VoiceCard
          voice={record.voice}
          onVoice={onVoice}
          onSpeak={speaker.toggle}
          speaking={speaker.line !== undefined}
          {...(speaker.line === undefined ? {} : { line: speaker.line.reply.line })}
        />
        <ChannelActions />
      </aside>
    </div>
  );
}
