// "Speak a line" (creator requirement 1.4): the next recorded line (speak.ts) played through one
// reusable <audio>, which is handed to <AvatarCanvas audio> so it drives the mouth. The element is
// created on the first press only, so no AudioContext starts before a user gesture. Each line's
// mouth track (perfection-pass task 4) is started here with its words; Glass shapes a drawn or
// warp mouth from it, other rigs keep the loudness jaw.
import { useCallback, useEffect, useRef, useState } from "react";
import { trackForClip } from "../air/mouthTrack";
import { lineAt, loadLines, type SpokenLine } from "./speak";
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
      // The line's mouth track, made with its words; Glass reads it for the element (useClipMouth).
      void trackForClip(next.url, next.reply.line);
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
