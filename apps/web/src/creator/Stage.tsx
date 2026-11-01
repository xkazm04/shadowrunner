// The stage (creator requirement 1, 5.2): the face through <AvatarCanvas>, the brightest thing on
// the page, with its caption ("<name> · live rig, N layers" and the motion state) and "speak a
// line" (`useSpeaker`): a recorded WAV played through one <audio> element that also drives the
// mouth via <AvatarCanvas audio>.
//
// Decisions the spec leaves open:
// - The audio element is handed to the canvas only after the first press, so no AudioContext is
//   created before a user gesture (autoplay policy).
// - `revealKey` replays the reveal (a fresh character from the forge): the face rises out of the
//   dark with a brief flare. Under reduced motion it is a plain cross-fade.
import { AvatarCanvas, type RigAssets } from "@sr/avatar";
import type { Gesture, Look, Rig } from "@sr/rig";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { lineAt, loadLines, type SpokenLine } from "./speak";
import styles from "./Stage.module.css";

export interface StageProps {
  rig?: Rig;
  look?: Look;
  assets?: RigAssets;
  gesture?: Gesture;
  audio?: HTMLMediaElement;
  /** Under the face, left: the character. */
  name?: string;
  /** Under the face, right: what the face is doing. */
  motion: string;
  /** The line being spoken, shown as a subtitle. */
  subtitle?: string;
  /** A change replays the reveal. */
  revealKey?: string;
  /** A label on the stage (RECORDED for a replay character). */
  badge?: ReactNode;
  /** Shown over the stage instead of (or above) the face: loading, empty, forging. */
  children?: ReactNode;
}

export function Stage({ rig, look, assets, gesture, audio, name, motion, subtitle, revealKey, badge, children }: StageProps) {
  const ready = rig !== undefined && look !== undefined && assets !== undefined;
  const visibleLayers = rig === undefined ? 0 : rig.layers.filter((l) => l.visible !== false && !look?.hidden.includes(l.name)).length;
  return (
    <figure className={styles.stage} data-stage="" aria-label={name === undefined ? "Stage" : `Stage: ${name}`}>
      <div className={styles.well}>
        {ready && (
          <div key={revealKey} className={styles.face} data-reveal={revealKey === undefined ? undefined : ""}>
            <AvatarCanvas
              rig={rig}
              look={look}
              assets={assets}
              className={styles.canvas}
              {...(gesture === undefined ? {} : { gesture })}
              {...(audio === undefined ? {} : { audio })}
            />
          </div>
        )}
        {children !== undefined && <div className={styles.overlay}>{children}</div>}
        {badge !== undefined && <div className={styles.badge}>{badge}</div>}
        {subtitle !== undefined && (
          <p className={styles.subtitle} aria-live="polite">
            {subtitle}
          </p>
        )}
      </div>
      <figcaption className={styles.caption}>
        <span>
          {name === undefined ? (
            "No character on the stage"
          ) : (
            <>
              <b>{name}</b>
              {rig !== undefined && ` · live rig, ${visibleLayers} ${visibleLayers === 1 ? "layer" : "layers"}`}
            </>
          )}
        </span>
        <span data-motion-state="">{motion}</span>
      </figcaption>
    </figure>
  );
}

export interface Speaker {
  /** The element to hand to <AvatarCanvas audio>; undefined until the first line. */
  audio?: HTMLAudioElement;
  /** The line playing now. */
  line?: SpokenLine;
  /** Plays the next recorded line, or stops the one playing. */
  toggle: () => void;
  stop: () => void;
}

/** "Speak a line": the next recorded line, through one reusable <audio>. `onLine` hears each start. */
export function useSpeaker(onLine?: (line: SpokenLine) => void): Speaker {
  const element = useRef<HTMLAudioElement | undefined>(undefined);
  const count = useRef(0);
  const [audio, setAudio] = useState<HTMLAudioElement | undefined>(undefined);
  const [line, setLine] = useState<SpokenLine | undefined>(undefined);
  const heard = useRef(onLine);
  useEffect(() => {
    heard.current = onLine;
  });

  const stop = useCallback(() => {
    element.current?.pause();
    setLine(undefined);
  }, []);

  const toggle = useCallback(() => {
    if (element.current !== undefined && !element.current.paused) {
      stop();
      return;
    }
    void (async () => {
      const next = lineAt(await loadLines(), count.current);
      if (next === undefined) return;
      count.current += 1;
      const el = (element.current ??= new Audio());
      el.src = next.url;
      el.onended = () => setLine(undefined);
      setAudio(el);
      setLine(next);
      heard.current?.(next);
      try {
        await el.play();
      } catch {
        setLine(undefined);
      }
    })();
  }, [stop]);

  useEffect(() => () => element.current?.pause(), []);
  return audio === undefined ? { toggle, stop, ...(line === undefined ? {} : { line }) } : { audio, toggle, stop, ...(line === undefined ? {} : { line }) };
}
