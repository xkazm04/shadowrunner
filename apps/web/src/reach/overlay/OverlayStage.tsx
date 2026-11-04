// The overlay with a source (spec avatar-reach, design "Overlay"): the character alone on the URL's
// background, full viewport, lip-synced to the microphone with `mic=1`, moods and a gesture on keys.
// Nothing else is drawn: a status line shows only while something needs the user (a load failure,
// a click to start the microphone, a refusal) and is gone once the character runs.
import { createAvatarPlayer, type AvatarPlayer } from "@sr/avatar/core";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { loadPlayable } from "../playable";
import { listenOverlayKeys } from "./keys";
import { browserMicEnv, createMic, type Mic, type MicEnv, type MicState } from "./mic";
import { backgroundColour, type OverlayParams, type OverlaySource } from "./params";
import styles from "./Overlay.module.css";

export const NO_RENDERER = "This browser could not draw the character.";

type Load = { kind: "loading" } | { kind: "ready" } | { kind: "failed"; error: string };

/** Paints `<html>` and `<body>` with `colour` while mounted; the earlier inline values come back on unmount. */
export function usePageBackground(colour: string): void {
  useEffect(() => {
    const targets = [document.documentElement, document.body];
    const before = targets.map((el) => [el.style.getPropertyValue("background"), el.style.getPropertyPriority("background")] as const);
    for (const el of targets) el.style.setProperty("background", colour, "important");
    return () => {
      targets.forEach((el, i) => {
        const [value, priority] = before[i] ?? ["", ""];
        el.style.removeProperty("background");
        if (value !== "") el.style.setProperty("background", value, priority);
      });
    };
  }, [colour]);
}

export interface OverlayStageProps {
  source: OverlaySource;
  params: OverlayParams;
  /** Test seam: the browser's microphone and audio context. */
  micEnv?: () => MicEnv;
}

export function OverlayStage({ source, params, micEnv = browserMicEnv }: OverlayStageProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<AvatarPlayer | undefined>(undefined);
  const micRef = useRef<Mic | undefined>(undefined);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [mic, setMic] = useState<MicState | undefined>(undefined);
  const envRef = useRef(micEnv);
  envRef.current = micEnv;

  usePageBackground(backgroundColour(params.bg));

  const sourceKey = "pack" in source ? `pack:${source.pack}` : `character:${source.character}`;
  const { mood, mic: listen } = params;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const abort = new AbortController();
    let player: AvatarPlayer | undefined;
    let listener: Mic | undefined;
    setLoad({ kind: "loading" });
    setMic(undefined);
    void loadPlayable(source, { signal: abort.signal }).then((result) => {
      if (abort.signal.aborted) return;
      if (!result.ok) return setLoad({ kind: "failed", error: result.error });
      const { rig, look, assets } = result.playable;
      try {
        player = createAvatarPlayer(canvas, { rig, look: mood === undefined ? look : { ...look, emotion: mood }, assets });
      } catch {
        return setLoad({ kind: "failed", error: NO_RENDERER });
      }
      playerRef.current = player;
      player.start();
      setLoad({ kind: "ready" });
      if (listen) {
        listener = createMic(player, envRef.current(), setMic);
        micRef.current = listener;
        void listener.start(false);
      }
    });
    return () => {
      abort.abort();
      listener?.dispose();
      player?.dispose();
      playerRef.current = undefined;
      micRef.current = undefined;
    };
    // `source` is keyed by `sourceKey`: a new object for the same source does not reload.
  }, [sourceKey, mood, listen]);

  useEffect(
    () =>
      listenOverlayKeys(window, (action) => {
        const player = playerRef.current;
        if (action.kind === "mood") player?.setEmotion(action.emotion);
        else player?.gesture(action.gesture);
      }),
    [],
  );

  const line = load.kind === "failed" ? load.error : mic !== undefined && mic.kind !== "running" && mic.kind !== "starting" ? mic.reason : undefined;
  return (
    <div className={styles.stage} data-load={load.kind} data-mic={mic?.kind}>
      <canvas ref={canvasRef} className={styles.canvas} aria-label="The character" />
      <div className={styles.status} role="status">
        {load.kind === "loading" && <span className={styles.hidden}>Loading the character.</span>}
        {line !== undefined &&
          (mic?.kind === "needs-click" && load.kind === "ready" ? (
            <button type="button" className={styles.line} onClick={() => void micRef.current?.start(true)}>
              {line}
            </button>
          ) : (
            <p className={styles.line}>{line}</p>
          ))}
      </div>
    </div>
  );
}
