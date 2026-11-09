// The stage's act trigger (tiger L1): while a line is up, the first cue word it says (acts.ts)
// fires that part's act when playback reaches the word - (char index / line length) of the way
// through the audio for a voiced line, or of the caption's reading clock for a caption-only line,
// the same clocks the captions reveal by. At most once per line, ACT_COOLDOWN_MS between two. No
// request is made: the act is the part's own motion, played by the face (AvatarCanvas `act`).
// perfection-pass 5.5, the cooldown rule: a cue word reached inside the cooldown is dropped (an act
// never fires late, away from its word), and the line's next cue word reached after the cooldown
// fires instead. Before, only the first cue was tried, so a line that opened inside the cooldown
// lost its act even when it said the word again later.
import { useEffect, useRef, useState } from "react";
import { captionWords, readMs } from "./reveal";
import { BEAT_MS, type Caption } from "./show";
import { cooled, lineCues, type StageAct } from "./acts";

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
    const cues = lineCues(line, acts);
    if (cues.length === 0) return undefined;
    const started = performance.now();
    const pace = readMs(captionWords(line).length, BEAT_MS);
    let raf = 0;
    let next = 0;
    const tick = (t: number) => {
      const d = audio?.duration ?? Number.NaN;
      const progress = voiced && audio && Number.isFinite(d) && d > 0 ? audio.currentTime / d : (t - started) / pace;
      // Every cue word passed by now: the first one past the cooldown fires, the others are dropped.
      for (let cue = cues[next]; cue !== undefined && progress >= cue.at; cue = cues[next]) {
        next += 1;
        if (!cooled(last.current, t)) continue;
        last.current = t;
        const { layer } = cue;
        setFire((prev) => ({ layer, n: (prev?.n ?? 0) + 1 }));
        return;
      }
      if (next < cues.length) raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [beat, line, voiced, audio, acts]);
  return fire;
}
