// /studio (spec avatar-reach, design "Studio", requirements 4.1-4.4; perfection-pass task 6,
// requirements 6.1-6.4): pick a character, see it live on a background, give it a script (typed
// lines on live, recorded ones on replay, each with a mood and a gesture), Preview it with
// lip-sync and Record it into one WebM, at the stage's size or a preset, to download.
//
// Decisions the spec leaves open:
// - The AudioContext is created on the first Preview or Record click (browsers want a gesture)
//   and lives as long as the page.
// - Decoded lines are cached (clips.ts), so Record after Preview does not ask the voice again (a
//   live line costs a TTS call).
// - The first cast pack is picked when the page opens with nothing picked, so a first visit has a
//   character on screen with no keys.
// - The script starts as one line (replay: the first recorded line, with its recorded mood and
//   gesture; live: an empty box) and is reset when the character changes.
// - A take is one mixed buffer with its cues and per-line mouth tracks (take.ts); Preview runs its
//   director beside the on-screen player, Record steps it per frame (recorder.ts). Afterwards the
//   player is put back in the look's own mood.
// - A preset size records from a second player (takeStage.ts); "as shown" from the on-screen one.
// - The finished take states its size and length, and carries its measured figures (frames, the
//   longest frame gap, the A/V drift by the last line) as data attributes for the e2e test.
import { createAvatarPlayer, isReducedMotion, type AvatarPlayer } from "@sr/avatar/core";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { apiFetch, type Plane } from "../../app/plane";
import { loadPlayable, type Playable, type PlayableSource } from "../playable";
import { aspectOf, type AspectId } from "./aspect";
import { FALLBACK_BACKGROUND, readSwatches } from "./background";
import { decodeScript, type ClipCache } from "./clips";
import { frameLoop } from "./lipsync";
import { liveAudio, recordedAudio, replayLines } from "./lines";
import { OutputPanel } from "./OutputPanel";
import { canRecord, pickMimeType, playLine, RecordError, recordLine, RECORD_FAILED, TRANSPARENT, type Playback, type RecorderClass, type TakeStats } from "./recorder";
import { DEFAULT_PAUSE_MS, MAX_TAKE_S, recordedRow, scriptOf, scriptReady, typedRow, type ScriptLine, type ScriptRow } from "./script";
import { ScriptPanel } from "./ScriptPanel";
import { SourcePicker } from "./SourcePicker";
import styles from "./Studio.module.css";
import { buildTake, directTake, type BuiltTake } from "./take";
import { takeStage } from "./takeStage";

export { NO_AUDIO } from "./clips";

type Load = { kind: "none" } | { kind: "loading" } | { kind: "ready"; playable: Playable } | { kind: "error"; error: string };
type Work = { kind: "idle" } | { kind: "voicing" } | { kind: "playing" } | { kind: "recording"; progress: number } | { kind: "error"; error: string };
interface Recorded {
  url: string;
  name: string;
  width: number;
  height: number;
  stats: TakeStats;
}

export const NO_RECORDER = "This browser cannot record video (it lacks MediaRecorder or canvas capture). Preview still works; try a current Chrome, Edge or Firefox to record.";

/** "Arch-Lich Malakor" -> "arch-lich-malakor" (the download's name). */
export function fileSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "character"
  );
}

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
const FRAMES = { request: (cb: FrameRequestCallback) => window.requestAnimationFrame(cb), cancel: (h: number) => window.cancelAnimationFrame(h) };

const recordSentence = (err: unknown): string => (err instanceof RecordError ? err.message : RECORD_FAILED);

/** The A/V drift by the last line (TakeStats.offsetsMs: last minus first), ms. */
export const driftMs = (stats: TakeStats): number => (stats.offsetsMs.at(-1) ?? 0) - (stats.offsetsMs[0] ?? 0);

export default function StudioPage({ plane }: { plane: Plane }): ReactElement {
  const [sourceKey, setSourceKey] = useState<string | undefined>(undefined);
  const [load, setLoad] = useState<Load>({ kind: "none" });
  const swatches = useMemo(() => readSwatches(), []);
  const [colour, setColour] = useState(() => swatches[0]?.hex ?? FALLBACK_BACKGROUND);
  const [background, setBackground] = useState(colour);
  const [aspect, setAspect] = useState<AspectId>("shown");
  const [rows, setRows] = useState<ScriptRow[]>([]);
  const [pauseMs, setPauseMs] = useState(DEFAULT_PAUSE_MS);
  const [work, setWork] = useState<Work>({ kind: "idle" });
  const [take, setTake] = useState<Recorded | undefined>(undefined);
  const recordable = useMemo(() => canRecord(), []);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<AvatarPlayer | undefined>(undefined);
  const contextRef = useRef<AudioContext | undefined>(undefined);
  const clips = useRef<ClipCache>(new Map());
  const playbackRef = useRef<Playback | undefined>(undefined);
  const recordAbort = useRef<AbortController | undefined>(undefined);
  const takes = useRef(0);
  const loadAbort = useRef<AbortController | undefined>(undefined);

  const playable = load.kind === "ready" ? load.playable : undefined;
  const replay = useMemo(() => (playable === undefined ? { lines: [] } : replayLines(playable)), [playable]);
  const busy = work.kind === "voicing" || work.kind === "playing" || work.kind === "recording";

  // A new character (or plane) starts a new one-line script.
  useEffect(() => {
    const first = replay.lines[0];
    setRows(playable === undefined ? [] : plane === "live" ? [typedRow()] : first === undefined ? [] : [recordedRow(first)]);
  }, [playable, plane, replay]);

  const pick = useCallback((key: string, source: PlayableSource) => {
    loadAbort.current?.abort();
    const abort = new AbortController();
    loadAbort.current = abort;
    setSourceKey(key);
    setLoad({ kind: "loading" });
    setWork({ kind: "idle" });
    void loadPlayable(source, { signal: abort.signal }).then((result) => {
      if (abort.signal.aborted) return;
      setLoad(result.ok ? { kind: "ready", playable: result.playable } : { kind: "error", error: result.error });
    });
  }, []);

  // The live player: one per loaded character.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (playable === undefined || canvas === null) return;
    let player: AvatarPlayer;
    try {
      player = createAvatarPlayer(canvas, { rig: playable.rig, look: playable.look, assets: playable.assets });
    } catch {
      setLoad({ kind: "error", error: "This browser could not draw the character." });
      return;
    }
    playerRef.current = player;
    player.start();
    return () => {
      playerRef.current = undefined;
      player.dispose();
    };
  }, [playable]);

  // Page lifetime: stop what plays, release the take and the audio.
  useEffect(
    () => () => {
      loadAbort.current?.abort();
      recordAbort.current?.abort();
      playbackRef.current?.stop();
      void contextRef.current?.close().catch(() => undefined);
    },
    [],
  );
  useEffect(() => () => (take === undefined ? undefined : URL.revokeObjectURL(take.url)), [take]);

  const reduced = (): boolean => isReducedMotion(window.matchMedia?.(REDUCED_QUERY).matches ?? false, canvasRef.current?.closest("[data-motion]")?.getAttribute("data-motion"));

  /** The script as one take (decoded, mixed, cued), or the sentence that says why not. */
  const prepare = async (who: Playable): Promise<{ ok: true; context: AudioContext; take: BuiltTake<AudioBuffer> } | { ok: false; error: string }> => {
    const context = (contextRef.current ??= new AudioContext());
    if (context.state === "suspended") await context.resume().catch(() => undefined);
    const script = scriptOf(rows);
    const result = await decodeScript(script, clips.current, {
      context,
      keyOf: (line: ScriptLine) => (line.url === undefined ? `live|${who.voice}|${line.text.trim()}` : `replay|${line.url}`),
      fetchLine: (line: ScriptLine) =>
        line.url === undefined ? liveAudio(apiFetch, line.text, who) : recordedAudio((url, init) => fetch(url, init), { text: line.text, url: line.url }),
    });
    if (!result.ok) return result;
    const built = buildTake(context, script, result.decoded, { pauseMs, lookEmotion: who.look.emotion, maxS: MAX_TAKE_S });
    return built.ok ? { ok: true, context, take: built.take } : built;
  };

  const preview = async () => {
    const player = playerRef.current;
    if (playable === undefined || player === undefined || busy) return;
    setWork({ kind: "voicing" });
    const ready = await prepare(playable);
    if (!ready.ok) return setWork({ kind: "error", error: ready.error });
    const { context, take: built } = ready;
    const playback = playLine(context, built.mix, player);
    playbackRef.current = playback;
    const stopLoop = frameLoop(player, directTake(player, built.cues, built.mouths, reduced, playback.clock), FRAMES);
    setWork({ kind: "playing" });
    await playback.ended;
    stopLoop();
    player.setLook(playable.look);
    if (playbackRef.current === playback) playbackRef.current = undefined;
    setWork({ kind: "idle" });
  };

  const record = async () => {
    const screen = playerRef.current;
    const canvas = canvasRef.current;
    const Recorder: RecorderClass | undefined = typeof MediaRecorder === "function" ? MediaRecorder : undefined;
    if (playable === undefined || screen === undefined || canvas === null || Recorder === undefined || busy) return;
    const mimeType = pickMimeType((type) => Recorder.isTypeSupported(type));
    if (mimeType === undefined) return setWork({ kind: "error", error: NO_RECORDER });
    setWork({ kind: "voicing" });
    const ready = await prepare(playable);
    if (!ready.ok) return setWork({ kind: "error", error: ready.error });
    const { context, take: built } = ready;
    const size = aspectOf(aspect).size;
    const stage = size === undefined ? undefined : takeStage(screen, { rig: playable.rig, look: playable.look, assets: playable.assets, reducedMotion: reduced() }, size, document.createElement("canvas"));
    if (size !== undefined && stage === undefined) return setWork({ kind: "error", error: "This browser could not draw the video frame." });
    const player = stage?.player ?? screen;
    const target = document.createElement("canvas");
    const abort = new AbortController();
    recordAbort.current = abort;
    setWork({ kind: "recording", progress: 0 });
    try {
      const { blob, stats } = await recordLine({
        context,
        buffer: built.mix,
        player,
        direct: (clock) => directTake(player, built.cues, built.mouths, reduced, clock),
        marks: built.plan.startsS,
        source: stage?.source ?? canvas,
        target,
        ...(size === undefined ? {} : { size }),
        ...(stage === undefined ? {} : { place: stage.place }),
        background,
        Recorder,
        mimeType,
        frames: FRAMES,
        wait: (ms) => new Promise<void>((resolve) => window.setTimeout(resolve, ms)),
        onProgress: (progress) => setWork({ kind: "recording", progress }),
        signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      takes.current += 1;
      setTake({ url: URL.createObjectURL(blob), name: `${fileSlug(playable.name)}-${takes.current}.webm`, width: target.width, height: target.height, stats });
      setWork({ kind: "idle" });
    } catch (err) {
      if (!abort.signal.aborted) setWork({ kind: "error", error: recordSentence(err) });
    } finally {
      stage?.dispose();
      screen.setLook(playable.look);
    }
  };

  const stop = () => {
    playbackRef.current?.stop();
    recordAbort.current?.abort();
    setWork({ kind: "idle" });
  };

  const pickBackground = (value: string) => {
    setBackground(value);
    if (value !== TRANSPARENT) setColour(value);
  };

  const name = playable?.name ?? "The character";
  const ready = playable !== undefined && scriptReady(rows);

  return (
    <section data-page="studio" data-plane={plane} aria-label="Studio" className={styles.studio}>
      <div className={styles.controls}>
        <SourcePicker current={sourceKey} onPick={pick} busy={busy} />
        {playable === undefined ? null : (
          <ScriptPanel
            plane={plane}
            name={name}
            lookEmotion={playable.look.emotion}
            replay={replay}
            rows={rows}
            onRows={setRows}
            pauseMs={pauseMs}
            onPause={setPauseMs}
            busy={busy}
          />
        )}
        <OutputPanel swatches={swatches} background={background} onBackground={pickBackground} colour={colour} aspect={aspect} onAspect={setAspect} busy={busy} />
        <div className={styles.actions}>
          <button type="button" className={styles.button} disabled={!ready || busy} onClick={() => void preview()}>
            Preview
          </button>
          {recordable ? (
            <button type="button" className={styles.button} disabled={!ready || busy} onClick={() => void record()} data-studio="record">
              Record
            </button>
          ) : null}
          {work.kind === "playing" || work.kind === "recording" ? (
            <button type="button" className={styles.button} onClick={stop}>
              Stop
            </button>
          ) : null}
        </div>
        {recordable ? null : (
          <p className={styles.hint} data-studio="no-recorder">
            {NO_RECORDER}
          </p>
        )}
        <div aria-live="polite" className={styles.status}>
          {work.kind === "voicing" ? <p>Finding the voice…</p> : null}
          {work.kind === "recording" ? (
            <p>
              Recording… <progress className={styles.progress} value={work.progress} max={1} />
            </p>
          ) : null}
          {work.kind === "error" ? (
            <p role="alert" className={styles.error}>
              {work.error}
            </p>
          ) : null}
          {take === undefined ? null : (
            <p
              data-studio="take"
              data-width={take.width}
              data-height={take.height}
              data-frames={take.stats.frames}
              data-wall-ms={Math.round(take.stats.wallMs)}
              data-max-gap-ms={Math.round(take.stats.maxGapMs)}
              data-drift-ms={driftMs(take.stats).toFixed(1)}
            >
              <a className={styles.download} href={take.url} download={take.name}>
                Download {take.name}
              </a>{" "}
              <span className={styles.hint}>
                {take.width} × {take.height}, {(take.stats.wallMs / 1000).toFixed(1)} s
              </span>
            </p>
          )}
        </div>
      </div>
      <div className={`${styles.stage} ${background === TRANSPARENT ? styles.checker : ""}`} style={background === TRANSPARENT ? undefined : { background }} data-studio="stage">
        {load.kind === "ready" ? null : (
          <p className={styles.stageNote}>
            {load.kind === "loading" ? "Loading the character…" : load.kind === "error" ? load.error : "Pick a character."}
          </p>
        )}
        <canvas key={`${sourceKey ?? ""}|${playable?.id ?? ""}`} ref={canvasRef} className={styles.canvas} aria-label={playable === undefined ? undefined : `${name}, live`} />
      </div>
    </section>
  );
}
