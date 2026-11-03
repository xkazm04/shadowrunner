// CH 4, the big set's live tube (costume 5.1; design.md "Characters": the live hour uses
// <AvatarCanvas> in its tube). A lazy chunk, so the wall's first paint does not carry the renderer
// or his layer images: until it lands the tube shows his cast still. Malakor comes from his
// committed rig the way the library seeds him; the captions are his recorded show's replies, a
// sentence at a time, and his face takes each reply's emotion. He glances at whichever set the
// visitor warms (the page writes the point into `lookAt`, no render per move).
//
// character-control 6: the tube shows the character "Put on air" recorded (air/onAir.ts) with its
// saved look, and Malakor with his default look when there is none (each reply's emotion on top).
//
// Not the prototype: the prototype's jaw flapped on a loop. There is no audio on this page, so
// the mouth stays at rest; the face still breathes, blinks, drifts and turns.
import { AvatarCanvas, type LookAtRef, type RigAssets } from "@sr/avatar";
import { parseShow, type ShowBeat } from "@sr/engine";
import { defaultLook, type Look, type Rig } from "@sr/rig";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import showJson from "../../../../assets/replay/shows/malakor-night.json";
import { loadOnAir } from "../air/onAir";
import { malakorAssetUrls, malakorRig } from "../creator/library/seed";
import styles from "./WallTube.module.css";

interface Loaded {
  rig: Rig;
  assets: RigAssets;
  /** The on-air character's saved look; Malakor's default when absent. */
  look?: Look;
}

let loading: Promise<Loaded> | undefined;

/** The on-air character, or his rig and decoded layer images; once per page. Rejects when the art does not load. */
function loadLive(): Promise<Loaded> {
  loading ??= (async () => {
    const onAir = await loadOnAir();
    if (onAir !== undefined) return { rig: onAir.rig, assets: onAir.assets, look: onAir.look };
    const rig = malakorRig();
    const urls = malakorAssetUrls(rig);
    const assets: RigAssets = {};
    await Promise.all(
      Object.entries(urls).map(async ([file, url]) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        assets[file] = image;
      }),
    );
    return { rig, assets };
  })();
  loading.catch(() => {
    loading = undefined;
  });
  return loading;
}

export interface Caption {
  text: string;
  emotion: Look["emotion"];
}

/** Pure: each recorded reply split into its sentences, in show order. */
export function captionsOf(beats: readonly ShowBeat[]): Caption[] {
  return beats.flatMap((beat) =>
    (beat.reply.line.match(/[^.!?]+[.!?]+["')]*/g) ?? [beat.reply.line])
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((text) => ({ text, emotion: beat.reply.emotion })),
  );
}

const CAPTION_MS = 3400;

export interface WallLiveProps {
  /** Where he looks, in his tube's normalised view space; written by the page. */
  lookAt: LookAtRef;
  /** The captions run (false once the set is cold, e.g. not yet booted). */
  speaking: boolean;
}

export default function WallLive({ lookAt, speaking }: WallLiveProps): ReactElement | null {
  const [live, setLive] = useState<Loaded | undefined>(undefined);
  const [at, setAt] = useState(0);
  const captions = useMemo(() => captionsOf(parseShow(showJson)?.beats ?? []), []);

  useEffect(() => {
    let on = true;
    loadLive().then(
      (l) => on && setLive(l),
      () => undefined,
    );
    return () => {
      on = false;
    };
  }, []);

  useEffect(() => {
    if (!speaking || captions.length < 2) return undefined;
    const id = window.setInterval(() => setAt((n) => (n + 1) % captions.length), CAPTION_MS);
    return () => window.clearInterval(id);
  }, [speaking, captions.length]);

  const caption = captions[at];
  const look = useMemo(
    () => (live === undefined ? undefined : { ...(live.look ?? defaultLook(live.rig)), emotion: caption?.emotion ?? "neutral" }),
    [live, caption?.emotion],
  );

  return (
    <>
      {live !== undefined && look !== undefined && (
        <AvatarCanvas className={styles.rig} rig={live.rig} look={look} assets={live.assets} lookAt={lookAt} />
      )}
      {speaking && caption !== undefined && (
        <span className={styles.sub} data-caption="">
          {caption.text}
        </span>
      )}
    </>
  );
}
