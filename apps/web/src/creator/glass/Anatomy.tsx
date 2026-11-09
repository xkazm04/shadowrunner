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
// perfection-pass task 9: every card is memoised and handed only the part of the look it reads
// (the reducer shares unchanged parts), and every callback here is stable (the library and the
// look are read through refs), so a slider drag re-renders the glass, the dragged card and nothing
// else (Anatomy.renders.dom.test.tsx).
import type { VoiceId } from "@sr/engine";
import { regionKey, resolveFace, resolveGesture, type Emotion, type ExpressionFamily, type FaceField, type Gesture, type Palette, type PartShape } from "@sr/rig";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
  // The library object and the look change on every save and step; callbacks read them here.
  const latest = useRef({ library, look });
  useEffect(() => {
    latest.current = { library, look };
  });
  const id = record.id;
  const onRename = useCallback(async (name: string): Promise<void> => {
    if ((await latest.current.library.rename(id, name)) !== "renamed") throw new Error("not renamed");
  }, [id]);
  const onDuplicate = useCallback(async (): Promise<void> => {
    await flush();
    await latest.current.library.duplicate(id);
  }, [flush, id]);

  const onGesture = useCallback(
    (g: Gesture) => {
      fireGesture(g);
      setLastGesture(gestureLabel(g));
    },
    [fireGesture],
  );

  const onEmotion = useCallback((emotion: Emotion): void => {
    dispatch({ type: "emotion", emotion });
    const g = resolveGesture({ ...latest.current.look, emotion });
    if (g !== undefined) onGesture(g);
  }, [dispatch, onGesture]);

  const onVoice = useCallback((voice: VoiceId): void => void latest.current.library.saveVoice(id, voice), [id]);
  const toggle = useCallback((layer: string): void => dispatch({ type: "toggle", layer }), [dispatch]);
  const select = useCallback((layer: string, slot?: string): void => {
    setPart(layer);
    setRegion(slot === undefined ? undefined : regionKey(layer, slot));
    setTab("look");
  }, []);
  const selectPart = useCallback((layer: string): void => select(layer), [select]);
  const rig = record.rig;
  const onPalette = useCallback((key: keyof Palette, value: string) => dispatch({ type: "palette", key, value }), [dispatch]);
  const onRegion = useCallback((key: string, value: string | null) => dispatch({ type: "region", key, value }), [dispatch]);
  const onShape = useCallback((layer: string, value: Partial<PartShape>) => dispatch({ type: "shape", layer, value }), [dispatch]);
  const onShapeReset = useCallback((layer: string) => dispatch({ type: "shapeReset", layer }), [dispatch]);
  const onShapeResetAll = useCallback(() => dispatch({ type: "shapeResetAll" }), [dispatch]);
  const onFace = useCallback((field: FaceField, value: number) => dispatch({ type: "face", field, value, rig }), [dispatch, rig]);
  const onFaceReset = useCallback(() => dispatch({ type: "faceReset" }), [dispatch]);
  const onRetire = useCallback((family: ExpressionFamily, retired: boolean) => dispatch({ type: "retire", family, retired }), [dispatch]);
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
        onSelect={selectPart}
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
            onPalette={onPalette}
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
                  rig={rig}
                  palette={look.palette}
                  regions={look.regions}
                  onPalette={onPalette}
                  onRegion={onRegion}
                  {...(region === undefined ? {} : { selected: region })}
                />
                <ShapeCard shape={look.shape} {...(part === undefined ? {} : { part })} onShape={onShape} onReset={onShapeReset} onResetAll={onShapeResetAll} />
              </>
            ),
            face: (
              <>
                <FaceCard rig={rig} face={look.face} onFace={onFace} onReset={onFaceReset} lookAround={around} onLookAround={setAround} reduced={reduced} />
                <FaceFamilies
                  rig={rig}
                  retired={look.face?.expression?.faces}
                  onRetire={onRetire}
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
