// Captions (voice-and-air 3.4, 4.6; costume 8.1): a centred lower third framed by the corridor.
// Above it the cue, "<user> asked: <text>" (or "to the throne room" for an unprompted line); in it
// the speaker, his emotion tag ("listening" between lines) and the line, revealed word by word.
// Every word is laid out from the start and only its opacity changes (reveal.ts), so nothing
// reflows and no word jumps between lines. A voiced line reveals with the audio's playhead; a
// caption-only line at a reading pace, and says it is captions only. On the dead line the bar
// carries the dead line's words instead (DeadLine).
// perfection-pass 5.1: while the stage waits on the next line (`pending`, shown only after the
// show's THINK_DELAY_MS), the bar says so in the character's voice with a slow three-dot mark (a
// static mark under reduced motion), the cue shows the message he is reading, and the emotion tag
// shows the reply's emotion as soon as it lands. The bar is `aria-busy` while it waits, so a
// screen reader hears the line when it comes, not a waiting notice every beat.
import type { ChatMsg, EngineReply } from "@sr/engine";
import { useEffect, useMemo, useState } from "react";
import { DeadLine } from "./DeadLine";
import { captionWords, readMs, revealedCount } from "./reveal";
import { BEAT_MS, type Caption } from "./show";
import styles from "./Captions.module.css";

export interface CaptionsProps {
  caption?: Caption;
  speaker: string;
  /** The line is dead: the bar says so instead. */
  dead?: boolean;
  /** The stage's <audio>: a voiced line reveals with its playhead. */
  audio?: HTMLAudioElement | null;
  /** What the stage waits on between lines (show.ts `pending`). */
  pending?: "reply" | "voice" | undefined;
  /** The next line's reply, once it has landed. */
  upcoming?: EngineReply | undefined;
  /** The chat message the next line answers. */
  asking?: ChatMsg | undefined;
}

/** The waiting line: what he is doing while the stage waits. */
export function waitingLine(speaker: string, pending: "reply" | "voice"): string {
  return pending === "reply" ? `${speaker} reads the chat` : `${speaker} finds the words`;
}

/** Words lit so far: follows the playhead (voiced) or a reading clock (captions only). */
function useReveal(words: readonly string[], caption: Caption | undefined, audio: HTMLAudioElement | null | undefined): number {
  const [count, setCount] = useState(0);
  const beat = caption?.beat;
  const voiced = caption?.voiced === true;
  useEffect(() => {
    setCount(0);
    if (beat === undefined) return undefined;
    const started = performance.now();
    const pace = readMs(words.length, BEAT_MS);
    let raf = 0;
    let shown = 0;
    const tick = (t: number) => {
      const d = audio?.duration ?? Number.NaN;
      const progress = voiced && audio && Number.isFinite(d) && d > 0 ? audio.currentTime / d : (t - started) / pace;
      const next = Math.max(shown, revealedCount(words, progress));
      if (next !== shown) {
        shown = next;
        setCount(next);
      }
      if (shown < words.length) raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [beat, voiced, words, audio]);
  return count;
}

export function Captions({ caption, speaker, dead = false, audio, pending, upcoming, asking }: CaptionsProps) {
  const line = caption?.line ?? "";
  const words = useMemo(() => captionWords(line), [line]);
  const lit = useReveal(words, dead ? undefined : caption, audio);
  const live = !dead && caption !== undefined;
  const waiting = !dead && !live && pending !== undefined ? pending : undefined;
  const asked = live ? caption.answered : waiting !== undefined ? asking : undefined;

  return (
    <div className={styles.captions} data-captions="" data-dead-line={dead ? "" : undefined} data-pending={waiting}>
      <p className={styles.cue} data-on={live || asked !== undefined ? "" : undefined}>
        {asked ? (
          <>
            <b className={styles.cueUser}>{asked.user}</b> asked: {asked.text}
          </>
        ) : live ? (
          "to the throne room"
        ) : null}
      </p>
      <div className={styles.bar} aria-live="polite" aria-busy={waiting === undefined ? undefined : "true"}>
        {dead ? (
          <DeadLine />
        ) : (
          <>
            <p className={styles.who}>
              <span className={styles.speaker}>{speaker}</span>
              <em className={styles.emotion}>{live ? caption.reply.emotion : waiting !== undefined ? (upcoming?.emotion ?? "thinking") : "listening"}</em>
              {live && !caption.voiced && <span className={styles.captionOnly}>captions only</span>}
            </p>
            <p className={styles.line}>
              {live ? (
                words.map((w, i) => (
                  <span key={i} className={styles.word} data-word="" data-on={i < lit ? "" : undefined}>
                    {w}{" "}
                  </span>
                ))
              ) : waiting !== undefined ? (
                <span className={styles.waiting} data-waiting="">
                  {waitingLine(speaker, waiting)}
                  <span className={styles.dots} aria-hidden="true">
                    <span className={styles.dot}>.</span>
                    <span className={styles.dot}>.</span>
                    <span className={styles.dot}>.</span>
                  </span>
                </span>
              ) : (
                <span className={styles.idle}>{speaker} listens to the chat.</span>
              )}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
