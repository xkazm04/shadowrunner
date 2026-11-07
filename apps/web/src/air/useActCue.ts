// The stage's act trigger (tiger L1): while a line is up, the first cue word it says (acts.ts)
// fires that part's act when playback reaches the word - (char index / line length) of the way
// through the audio for a voiced line, or of the caption's reading clock for a caption-only line,
// the same clocks the captions reveal by. At most once per line, ACT_COOLDOWN_MS between two. No
// request is made: the act is the part's own motion, played by the face (AvatarCanvas `act`).
import { useEffect, useRef, useState } from "react";
import { captionWords, readMs } from "./reveal";
import { BEAT_MS, type Caption } from "./show";
import { cooled, lineCue, type StageAct } from "./acts";

/** What AvatarCanvas plays: each new `n` is one act of `layer`. */
export interface ActFire {
  layer: string;
  n: number;
}

export function useActCue(caption: Caption | undefined, audio: HTMLAudioElement | null | undefined, acts: readonly StageAct[]): ActFire | undefined {
  const [fire, setFire] = useState<ActFire | undefined>(undefined);
  const last = useRef<number | undefined>(undefined);
  const beat = caption?.beat;
  const line = caption?.line;
  const voiced = caption?.voiced === true;
  useEffect(() => {
    if (beat === undefined || line === undefined) return undefined;
    const cue = lineCue(line, acts);
    if (cue === undefined) return undefined;
    const started = performance.now();
    const pace = readMs(captionWords(line).length, BEAT_MS);
    let raf = 0;
    const tick = (t: number) => {
      const d = audio?.duration ?? Number.NaN;
      const progress = voiced && audio && Number.isFinite(d) && d > 0 ? audio.currentTime / d : (t - started) / pace;
      if (progress < cue.at) {
        raf = window.requestAnimationFrame(tick);
        return;
      }
      if (!cooled(last.current, t)) return;
      last.current = t;
      setFire((prev) => ({ layer: cue.layer, n: (prev?.n ?? 0) + 1 }));
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [beat, line, voiced, audio, acts]);
  return fire;
}
