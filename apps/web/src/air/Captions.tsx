// Captions (voice-and-air 3.4, 4.6; costume 8.1): a centred lower third framed by the corridor.
// Above it the cue, "<user> asked: <text>" (or "to the throne room" for an unprompted line); in it
// the speaker, his emotion tag ("listening" between lines) and the line, revealed word by word.
// Every word is laid out from the start and only its opacity changes (reveal.ts), so nothing
// reflows and no word jumps between lines. A voiced line reveals with the audio's playhead; a
// caption-only line at a reading pace, and says it is captions only. On the dead line the bar
// carries the dead line's words instead (DeadLine).
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

export function Captions({ caption, speaker, dead = false, audio }: CaptionsProps) {
  const line = caption?.line ?? "";
  const words = useMemo(() => captionWords(line), [line]);
  const lit = useReveal(words, dead ? undefined : caption, audio);
  const live = !dead && caption !== undefined;

  return (
    <div className={styles.captions} data-captions="" data-dead-line={dead ? "" : undefined}>
      <p className={styles.cue} data-on={live ? "" : undefined}>
        {live && caption.answered ? (
          <>
            <b className={styles.cueUser}>{caption.answered.user}</b> asked: {caption.answered.text}
          </>
        ) : live ? (
          "to the throne room"
        ) : null}
      </p>
      <div className={styles.bar} aria-live="polite">
        {dead ? (
          <DeadLine />
        ) : (
          <>
            <p className={styles.who}>
              <span className={styles.speaker}>{speaker}</span>
              <em className={styles.emotion}>{live ? caption.reply.emotion : "listening"}</em>
              {live && !caption.voiced && <span className={styles.captionOnly}>captions only</span>}
            </p>
            <p className={styles.line}>
              {live ? (
                words.map((w, i) => (
                  <span key={i} className={styles.word} data-word="" data-on={i < lit ? "" : undefined}>
                    {w}{" "}
                  </span>
                ))
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
