// /studio (spec avatar-reach, design "Studio", requirements 4.1-4.4): pick a character, see it
// live on a background colour, give it a line (typed on live, recorded on replay), Preview it with
// lip-sync and Record it into a WebM to download.
//
// Decisions the spec leaves open:
// - The AudioContext is created on the first Preview or Record click (browsers want a gesture)
//   and lives as long as the page.
// - The last decoded line is kept, so Record after Preview does not ask the voice again (a live
//   line costs a TTS call).
// - The first cast pack is picked when the page opens with nothing picked, so a first visit has a
//   character on screen with no keys.
import { createAvatarPlayer, type AvatarPlayer } from "@sr/avatar/core";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { apiFetch, type Plane } from "../../app/plane";
import { loadPlayable, type Playable, type PlayableSource } from "../playable";
import { FALLBACK_BACKGROUND, readSwatches } from "./background";
import { LinePanel } from "./LinePanel";
import { liveAudio, recordedAudio, replayLines, type LineAudio } from "./lines";
import { canRecord, pickMimeType, playLine, RecordError, recordLine, RECORD_FAILED, type Playback, type RecorderClass } from "./recorder";
import { SourcePicker } from "./SourcePicker";
import styles from "./Studio.module.css";

type Load = { kind: "none" } | { kind: "loading" } | { kind: "ready"; playable: Playable } | { kind: "error"; error: string };
type Work = { kind: "idle" } | { kind: "voicing" } | { kind: "playing" } | { kind: "recording"; progress: number } | { kind: "error"; error: string };

export const NO_RECORDER = "This browser cannot record video (it lacks MediaRecorder or canvas capture). Preview still works; try a current Chrome, Edge or Firefox to record.";
export const NO_AUDIO = "This line's audio could not be played.";

/** "Arch-Lich Malakor" -> "arch-lich-malakor" (the download's name). */
export function fileSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "character"
  );
}

const recordSentence = (err: unknown): string => (err instanceof RecordError ? err.message : RECORD_FAILED);

export default function StudioPage({ plane }: { plane: Plane }): ReactElement {
  const [sourceKey, setSourceKey] = useState<string | undefined>(undefined);
  const [load, setLoad] = useState<Load>({ kind: "none" });
  const swatches = useMemo(() => readSwatches(), []);
  const [background, setBackground] = useState(() => swatches[0]?.hex ?? FALLBACK_BACKGROUND);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState(0);
  const [work, setWork] = useState<Work>({ kind: "idle" });
  const [take, setTake] = useState<{ url: string; name: string } | undefined>(undefined);
  const recordable = useMemo(() => canRecord(), []);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<AvatarPlayer | undefined>(undefined);
  const contextRef = useRef<AudioContext | undefined>(undefined);
  const cacheRef = useRef<{ key: string; buffer: AudioBuffer } | undefined>(undefined);
  const playbackRef = useRef<Playback | undefined>(undefined);
  const recordAbort = useRef<AbortController | undefined>(undefined);
  const takes = useRef(0);
  const loadAbort = useRef<AbortController | undefined>(undefined);

  const playable = load.kind === "ready" ? load.playable : undefined;
  const replay = useMemo(() => (playable === undefined ? { lines: [] } : replayLines(playable)), [playable]);
  const busy = work.kind === "voicing" || work.kind === "playing" || work.kind === "recording";

  const pick = useCallback((key: string, source: PlayableSource) => {
    loadAbort.current?.abort();
    const abort = new AbortController();
    loadAbort.current = abort;
    setSourceKey(key);
    setLoad({ kind: "loading" });
    setPicked(0);
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

  /** The decoded line now chosen (typed or recorded), or the sentence that says why not. */
  const lineBuffer = async (who: Playable): Promise<{ ok: true; buffer: AudioBuffer; context: AudioContext } | { ok: false; error: string }> => {
    const context = (contextRef.current ??= new AudioContext());
    if (context.state === "suspended") await context.resume().catch(() => undefined);
    const line = replay.lines[picked];
    const key = plane === "live" ? `live|${who.voice}|${text.trim()}` : `replay|${line?.url ?? ""}`;
    const cached = cacheRef.current;
    if (cached?.key === key) return { ok: true, buffer: cached.buffer, context };
    let audio: LineAudio;
    if (plane === "live") audio = await liveAudio(apiFetch, text, who);
    else if (line === undefined) return { ok: false, error: "Pick a recorded line first." };
    else audio = await recordedAudio((url, init) => fetch(url, init), line);
    if (!audio.ok) return audio;
    try {
      const buffer = await context.decodeAudioData(audio.bytes);
      cacheRef.current = { key, buffer };
      return { ok: true, buffer, context };
    } catch {
      return { ok: false, error: NO_AUDIO };
    }
  };

  const preview = async () => {
    const player = playerRef.current;
    if (playable === undefined || player === undefined || busy) return;
    setWork({ kind: "voicing" });
    const line = await lineBuffer(playable);
    if (!line.ok) return setWork({ kind: "error", error: line.error });
    const playback = playLine(line.context, line.buffer, player);
    playbackRef.current = playback;
    setWork({ kind: "playing" });
    await playback.ended;
    if (playbackRef.current === playback) playbackRef.current = undefined;
    setWork({ kind: "idle" });
  };

  const record = async () => {
    const player = playerRef.current;
    const canvas = canvasRef.current;
    const Recorder: RecorderClass | undefined = typeof MediaRecorder === "function" ? MediaRecorder : undefined;
    if (playable === undefined || player === undefined || canvas === null || Recorder === undefined || busy) return;
    const mimeType = pickMimeType((type) => Recorder.isTypeSupported(type));
    if (mimeType === undefined) return setWork({ kind: "error", error: NO_RECORDER });
    setWork({ kind: "voicing" });
    const line = await lineBuffer(playable);
    if (!line.ok) return setWork({ kind: "error", error: line.error });
    const abort = new AbortController();
    recordAbort.current = abort;
    setWork({ kind: "recording", progress: 0 });
    try {
      const blob = await recordLine({
        context: line.context,
        buffer: line.buffer,
        player,
        source: canvas,
        target: document.createElement("canvas"),
        background,
        Recorder,
        mimeType,
        frames: { request: (cb) => window.requestAnimationFrame(cb), cancel: (h) => window.cancelAnimationFrame(h) },
        wait: (ms) => new Promise<void>((resolve) => window.setTimeout(resolve, ms)),
        onProgress: (progress) => setWork({ kind: "recording", progress }),
        signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      takes.current += 1;
      setTake({ url: URL.createObjectURL(blob), name: `${fileSlug(playable.name)}-${takes.current}.webm` });
      setWork({ kind: "idle" });
    } catch (err) {
      if (!abort.signal.aborted) setWork({ kind: "error", error: recordSentence(err) });
    }
  };

  const stop = () => {
    playbackRef.current?.stop();
    recordAbort.current?.abort();
    setWork({ kind: "idle" });
  };

  const name = playable?.name ?? "The character";
  const ready = playable !== undefined && (plane === "live" ? text.trim().length > 0 : replay.lines.length > 0);

  return (
    <section data-page="studio" data-plane={plane} aria-label="Studio" className={styles.studio}>
      <div className={styles.controls}>
        <SourcePicker current={sourceKey} onPick={pick} busy={busy} />
        <fieldset className={styles.group} disabled={busy}>
          <legend className={styles.legend}>Background</legend>
          <div className={styles.swatches}>
            {swatches.map((swatch) => (
              <button
                key={swatch.role}
                type="button"
                className={styles.swatch}
                style={{ background: swatch.hex }}
                aria-label={swatch.label}
                aria-pressed={background === swatch.hex}
                onClick={() => setBackground(swatch.hex)}
              />
            ))}
            <label className={styles.colour}>
              <span>Any colour</span>
              <input type="color" value={background} onChange={(e) => setBackground(e.target.value)} />
            </label>
          </div>
        </fieldset>
        {playable === undefined ? null : (
          <LinePanel plane={plane} name={name} text={text} onText={setText} replay={replay} picked={picked} onPick={setPicked} busy={busy} />
        )}
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
            <p>
              <a className={styles.download} href={take.url} download={take.name}>
                Download {take.name}
              </a>
            </p>
          )}
        </div>
      </div>
      <div className={styles.stage} style={{ background }} data-studio="stage">
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
