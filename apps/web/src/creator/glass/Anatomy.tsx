// One character under glass (costume 3.1, `r1/creator-b.html`): the layer stack, the glass with
// its pinned lights, the mood dial, gestures and voices. Replaces the tabbed Workbench and keeps
// its state and logic: the look (lookReducer) is written to the library shortly after each change,
// the voice is stored on the record, "speak a line" plays a recorded line through the mouth.
// Keyed by the character, so a switch starts clean. The page hands in the cast strip.
// character-control: the right column is two tabs, Mood (dial, gestures, voice) and Look (Palette,
// Shape); selecting a part (a Layer stack name, or a pick on the glass) switches to Look.
// face-control: a third tab, Face (FaceCard), writes Look.face through the same reducer and save;
// its Look around steers the glass's gaze (useLookAround).
// retire-a-face: under it, FACES (FaceFamilies) retires or restores each family's painted face
// through the same reducer and save; its Show puts the glass, never the saved look, at a family.
// tiger L1: under GESTURE, SIGNATURE ACTS (ActsCard) rehearses each act on the glass.
// forge-creator S2: FACES can repaint one face of a live-forged character (useRepaint); while a
// candidate is on screen the glass shows that family on the current or the candidate face.
// perfection-pass task 7: the look carries its history (useLookHistory: Undo / Redo, the keys, a
// drag as one step, Reset look undoable); Compare, held, puts the look as opened on the glass with
// a "before" tag; the name is renamed in place and Duplicate makes a variant (NameField); a pending
// save is written on a switch, unmount and pagehide (useLookSave). A repaint Accept is a record
// change, not a look edit: it keeps the look on screen and leaves the history as it is.
import type { VoiceId } from "@sr/engine";
import { regionKey, resolveFace, resolveGesture, type Emotion, type Gesture } from "@sr/rig";
import { useCallback, useState, type CSSProperties, type ReactNode } from "react";
import type { CharacterRecord } from "../library/libraryStore";
import { useArtRig, useRigAssets, type Library } from "../library/useLibrary";
import { useSpeaker } from "../useSpeaker";
import { ActsCard, useActedRig, useRehearse } from "./ActsCard";
import { FaceCard } from "./FaceCard";
import { FAMILY_EMOTION, FaceFamilies, useFacePreview } from "./FaceFamilies";
import { Glass } from "./Glass";
import { gestureLabel, useGesturePulse } from "./gestures";
import { BeforeTag, HistoryBar } from "./HistoryBar";
import { LayerRail, useBlobUrls } from "./LayerRail";
import { MoodDial } from "./MoodDial";
import { NameField } from "./NameField";
import { PaletteCard } from "./PaletteCard";
import { decodePixels, type PixelReader } from "./pixels";
import { ShapeCard } from "./ShapeCard";
import { ChannelActions, GestureCard, SheetCard, VoiceCard } from "./SignalCards";
import { SignalTabs, type SignalTab } from "./SignalTabs";
import { reducedMotion, usePick } from "./usePick";
import { useLookAround } from "./useLookAround";
import { useLookHistory } from "./useLookHistory";
import { SAVE_DELAY_MS, useLookSave } from "./useLookSave";
import { useRepaint } from "./useRepaint";
import { repaintWindow } from "../forge/repaint";
import styles from "./Anatomy.module.css";
import signal from "./Signal.module.css";

export { SAVE_DELAY_MS };

export interface AnatomyProps {
  record: CharacterRecord;
  library: Library;
  /** Under the glass: the cast strip. */
  cast?: ReactNode;
  /** Next to the name (RECORDED). */
  badge?: ReactNode;
  /** Reads an image's pixels for a glass pick. Default: decoded through a 2D canvas. */
  readPixels?: PixelReader;
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

export function Anatomy({ record, library, cast, badge, readPixels = decodePixels }: AnatomyProps) {
  const history = useLookHistory(record);
  const { look, dispatch } = history;
  const [comparing, setComparing] = useState(false);
  const art = useArtRig(record.rig);
  const [tab, setTab] = useState<SignalTab>("mood");
  const [part, setPart] = useState<string | undefined>(undefined);
  const [region, setRegion] = useState<string | undefined>(undefined);
  const glassPick = usePick(record, look, readPixels);
  const [gesture, fireGesture] = useGesturePulse();
  const [lastGesture, setLastGesture] = useState<string | undefined>(undefined);
  const actedRig = useActedRig(record.id, art);
  const [act, rehearse] = useRehearse();
  const [highlight, setHighlight] = useState<string | undefined>(undefined);
  const [around, setAround] = useState(false);
  const gaze = useLookAround(around, resolveFace(record.rig, look).gaze.habits);
  const reduced = reducedMotion();
  const { preview, show } = useFacePreview(reduced);
  const { assets, failed } = useRigAssets(record);
  const repaint = useRepaint(record, look, library.add);
  const [windowNow] = useState(() => Date.now());
  // S2: a candidate on screen puts the glass at its family, on the face chosen (current or candidate).
  const compare = repaint.state.step === "candidate" ? repaint.state : undefined;
  const onCandidate = compare !== undefined && compare.shown === "candidate" && compare.preview.assets !== undefined ? compare.preview : undefined;
  const glassFamily = compare?.family ?? preview;
  // Compare, held, wins over a family shown or a candidate: the character as opened, nothing else.
  const glassLook = comparing ? history.opened : glassFamily === undefined ? look : { ...look, emotion: FAMILY_EMOTION[glassFamily] };
  const glassRig = comparing ? actedRig : (onCandidate?.rig ?? actedRig);
  const glassAssets = comparing ? assets : (onCandidate?.assets ?? assets);
  const thumbs = useBlobUrls(record.assets);
  const speaker = useSpeaker((line) => {
    if (line.reply.gesture !== undefined) fireGesture(line.reply.gesture);
  });

  // Keep the look: written shortly after the last change, and at once on a switch or pagehide.
  const flush = useLookSave(record.id, look, library.saveLook);
  const onRename = async (name: string): Promise<void> => {
    if ((await library.rename(record.id, name)) !== "renamed") throw new Error("not renamed");
  };
  const onDuplicate = async (): Promise<void> => {
    await flush();
    await library.duplicate(record.id);
  };

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
  const select = (layer: string, slot?: string): void => {
    setPart(layer);
    setRegion(slot === undefined ? undefined : regionKey(layer, slot));
    setTab("look");
  };
  const onPick = (point: [number, number]): void => {
    void glassPick.pick(point).then((hit) => {
      if (hit !== undefined) select(hit.layer, hit.slot);
    });
  };

  const motion = failed
    ? "The face could not be drawn"
    : speaker.line !== undefined
      ? "Speaking"
      : gesture !== undefined && lastGesture !== undefined
        ? `Gesture · ${lastGesture}`
        : preview !== undefined
          ? `Showing ${preview}`
          : `${look.emotion === "neutral" ? "Idle" : title(look.emotion)} · ${gaze === undefined ? "blinking" : `looking to ${gaze}`}`;
  const shown = record.rig.layers.filter((l) => l.visible !== false && !look.hidden.includes(l.name)).length;
  const changed =
    JSON.stringify(look.palette) !== JSON.stringify(record.rig.palette) || look.hidden.length > 0 || look.emotion !== "neutral" || look.regions !== undefined || look.shape !== undefined || look.face !== undefined;
  const chip = liftChip(record, look.hidden);

  return (
    <div className={styles.anatomy} data-page="creator" style={{ "--lamp": look.palette.eye } as CSSProperties}>
      <LayerRail
        layers={record.rig.layers}
        thumbs={thumbs}
        hidden={look.hidden}
        onToggle={toggle}
        onHighlight={setHighlight}
        {...(part === undefined ? {} : { selected: part })}
        onSelect={(layer) => select(layer)}
      />
      <section className={styles.centre} aria-label={`The glass: ${record.rig.name}`}>
        <div className={styles.glassBox}>
          <Glass
            rig={glassRig}
            look={glassLook}
            {...(glassAssets === undefined ? {} : { assets: glassAssets })}
            {...(gesture === undefined ? {} : { gesture })}
            {...(act === undefined ? {} : { act })}
            {...(speaker.audio === undefined ? {} : { audio: speaker.audio })}
            {...(gaze === undefined ? {} : { gaze })}
            {...(highlight === undefined ? {} : { highlight })}
            onPalette={(key, value) => dispatch({ type: "palette", key, value })}
            onLift={toggle}
            onPick={onPick}
            {...(glassPick.outline === undefined ? {} : { outline: glassPick.outline })}
            {...(chip === undefined ? {} : { chip })}
          >
            {assets === undefined ? <p>{failed ? "This character's images could not be read." : "Lighting the face…"}</p> : undefined}
          </Glass>
          {comparing && <BeforeTag />}
        </div>
        <div className={styles.status}>
          <span>
            <NameField name={record.rig.name} fixed={record.seeded === true} onRename={onRename} onDuplicate={onDuplicate} /> · live rig, {shown} {shown === 1 ? "layer" : "layers"} {badge}
          </span>
          <span className={styles.statusEnd}>
            <HistoryBar
              canUndo={history.canUndo}
              canRedo={history.canRedo}
              onUndo={history.undo}
              onRedo={history.redo}
              canCompare={look !== history.opened}
              comparing={comparing}
              onCompare={setComparing}
            />
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
        <SignalTabs
          tab={tab}
          onTab={setTab}
          panels={{
            mood: (
              <>
                <MoodDial value={look.emotion} onChange={onEmotion} />
                <GestureCard onGesture={onGesture} />
                <ActsCard rig={actedRig} onRehearse={rehearse} />
                <VoiceCard
                  voice={record.voice}
                  onVoice={onVoice}
                  onSpeak={speaker.toggle}
                  speaking={speaker.line !== undefined}
                  {...(speaker.line === undefined ? {} : { line: speaker.line.reply.line })}
                />
                {record.sheet !== undefined && <SheetCard sheet={record.sheet} />}
              </>
            ),
            look: (
              <>
                <PaletteCard
                  rig={record.rig}
                  look={look}
                  onPalette={(key, value) => dispatch({ type: "palette", key, value })}
                  onRegion={(key, value) => dispatch({ type: "region", key, value })}
                  {...(region === undefined ? {} : { selected: region })}
                />
                <ShapeCard
                  look={look}
                  {...(part === undefined ? {} : { part })}
                  onShape={(layer, value) => dispatch({ type: "shape", layer, value })}
                  onReset={(layer) => dispatch({ type: "shapeReset", layer })}
                  onResetAll={() => dispatch({ type: "shapeResetAll" })}
                />
              </>
            ),
            face: (
              <>
                <FaceCard
                  rig={record.rig}
                  look={look}
                  onFace={(field, value) => dispatch({ type: "face", field, value, rig: record.rig })}
                  onReset={() => dispatch({ type: "faceReset" })}
                  lookAround={around}
                  onLookAround={setAround}
                  reduced={reduced}
                />
                <FaceFamilies
                  rig={record.rig}
                  look={look}
                  onRetire={(family, retired) => dispatch({ type: "retire", family, retired })}
                  preview={preview}
                  onShow={show}
                  reduced={reduced}
                  {...(record.faceGate === undefined ? {} : { gate: record.faceGate })}
                  windowState={repaintWindow(record, windowNow)}
                  repaint={repaint}
                />
              </>
            ),
          }}
        />
        <ChannelActions recordId={record.id} record={record} />
      </aside>
    </div>
  );
}
