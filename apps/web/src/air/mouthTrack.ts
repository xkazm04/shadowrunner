// A voice clip's mouth track (perfection-pass task 4, requirement 4.3): the clip decoded once
// (an OfflineAudioContext at the analyser's own 16 kHz, so nothing is left running and no context
// needs closing) and read by @sr/avatar's `analyseSpeech`, with the line's text when known.
// Consumers: the stage (show.ts's player starts it as a line starts; AirPage reads it), the
// creator's "speak a line" (useSpeaker starts it, Glass reads it) and the studio (its own buffer).
//
// Decisions:
// - Cached by absolute URL (a few entries: a blob: URL is revoked after its line), so the reader
//   (`useClipMouth`, which knows only the element) gets the track its starter made with the text.
//   The first call for a URL wins: a later one's text is ignored.
// - Any failure (fetch, decode, an empty clip, no OfflineAudioContext) resolves undefined: the
//   face keeps the loudness jaw. Fetching a blob: URL reads memory; a recorded asset's URL is the
//   same file the <audio> element plays (the HTTP cache serves the second read).
// - `useClipMouth` follows the element: each new source (`loadstart`) drops the old track at
//   once and takes the new one when it is ready; the clock is `audio.currentTime` while it plays.
import { analyseSpeech, type ClipMouth, type MouthTrack } from "@sr/avatar";
import { useEffect, useState } from "react";

/** The rate the clip is decoded at: @sr/avatar's analysis rate, so it needs no resampling. */
export const DECODE_RATE = 16000;
/** Tracks kept (a show plays one line at a time; the creator cycles through a handful). */
export const CACHE_SIZE = 8;

export interface ClipDeps {
  fetch(url: string): Promise<{ ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }>;
  /** Decodes to mono samples at DECODE_RATE (undefined when the browser cannot). */
  decode(bytes: ArrayBuffer): Promise<Float32Array | undefined>;
}

/** Decodes with an OfflineAudioContext (mono, DECODE_RATE): the browser resamples and mixes down. */
async function browserDecode(bytes: ArrayBuffer): Promise<Float32Array | undefined> {
  if (typeof OfflineAudioContext !== "function") return undefined;
  const context = new OfflineAudioContext(1, 1, DECODE_RATE);
  const buffer = await context.decodeAudioData(bytes);
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const mono = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const channel = buffer.getChannelData(c);
    for (let i = 0; i < mono.length; i += 1) mono[i] = (mono[i] ?? 0) + (channel[i] ?? 0) / buffer.numberOfChannels;
  }
  return mono;
}

const browserDeps: ClipDeps = { fetch: (url) => fetch(url), decode: browserDecode };

const cache = new Map<string, Promise<MouthTrack | undefined>>();

const keyOf = (url: string): string => {
  try {
    return new URL(url, typeof document === "undefined" ? undefined : document.baseURI).href;
  } catch {
    return url;
  }
};

/** Forgets every cached track (tests). */
export function clearClipTracks(): void {
  cache.clear();
}

async function analyse(clip: Blob | string, text: string | undefined, deps: ClipDeps): Promise<MouthTrack | undefined> {
  try {
    let bytes: ArrayBuffer;
    if (typeof clip === "string") {
      const res = await deps.fetch(clip);
      if (!res.ok) return undefined;
      bytes = await res.arrayBuffer();
    } else bytes = await clip.arrayBuffer();
    const samples = await deps.decode(bytes);
    if (samples === undefined || samples.length === 0) return undefined;
    return analyseSpeech(samples, DECODE_RATE, text === undefined ? {} : { text });
  } catch {
    return undefined;
  }
}

/**
 * The clip's mouth track, or undefined when it cannot be analysed. A URL is cached (the first
 * call's text wins); a Blob is analysed each call.
 */
export function trackForClip(clip: Blob | string, text?: string, deps: ClipDeps = browserDeps): Promise<MouthTrack | undefined> {
  if (typeof clip !== "string") return analyse(clip, text, deps);
  const key = keyOf(clip);
  const known = cache.get(key);
  if (known !== undefined) return known;
  const made = analyse(clip, text, deps);
  cache.set(key, made);
  while (cache.size > CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return made;
}

/** The mouth for whatever `audio` is playing: its source's track on its clock, once analysed. */
export function useClipMouth(audio: HTMLMediaElement | null | undefined, deps: ClipDeps = browserDeps): ClipMouth | undefined {
  const [mouth, setMouth] = useState<ClipMouth | undefined>(undefined);
  useEffect(() => {
    if (audio === null || audio === undefined) return undefined;
    let alive = true;
    let current = "";
    const pick = (): void => {
      const src = audio.currentSrc || audio.src;
      if (src === current) return;
      current = src;
      setMouth(undefined);
      if (src === "") return;
      void trackForClip(src, undefined, deps).then((track) => {
        // A paused element reads NaN: no shapes, so a line stopped mid-word does not hold its mouth open.
        if (alive && current === src && track !== undefined) setMouth({ track, clock: () => (audio.paused ? Number.NaN : audio.currentTime) });
      });
    };
    audio.addEventListener("loadstart", pick);
    pick();
    return () => {
      alive = false;
      audio.removeEventListener("loadstart", pick);
      setMouth(undefined);
    };
  }, [audio, deps]);
  return mouth;
}
