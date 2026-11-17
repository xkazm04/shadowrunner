// <AvatarCanvas> (avatar-renderer req 6, 5.3): a React shell over the avatar player (spec
// avatar-reach, design "Player core"), so the creator, the on-air stage and every non-React page
// render the face with one host loop, one frame body and one input set.
//
// Decisions the spec leaves open:
// - The component renders a <div> (with `className`) and creates its <canvas> inside it, filling
//   it; the player is created on that canvas at mount and disposed (canvas removed) at unmount. The
//   renderer may swap the canvas for a fresh one when WebGL2 is lost (a WebGL canvas cannot give a
//   2D context), and React never owns the canvas node, so the swap is safe; the player watches the
//   div, not the canvas. The div takes its size from `className`; the drawing buffer follows it
//   (the player's autoSize: ResizeObserver, x DPR capped at MAX_DPR).
// - The player keeps the rig's backdrop (`backdrop: true`): the stage hides it through the look.
// - `pauseOffscreen` (perfection-pass P1, default on), timing (the driver's clock, gaps clamped),
//   reduced motion (prefers-reduced-motion and the shell's data-motion, read per frame) and the
//   mood crossfade are the player's (player/run.ts, player/frame.ts).
// - Props reach the player in effects after each commit, so the next frame reads them:
//   `gesture` triggers on every change to a defined value (including the first render); playing
//   the same gesture again needs the prop to change (e.g. through undefined). `act` plays on each
//   new `n`. `level`, `lookAt` (a point or a ref, read every frame by the player: the landing's
//   torch steers it without a render per move), `dim`, `drive`, `gaze` and `mouth` (a clip's track
//   and clock) hold until they change; a new `rig` or `assets` swaps the renderer's rig live.
// - The driver is seeded with `seed` (default 1), so two mounts with one seed move alike, and a
//   player with that seed fed the same calls moves alike too. `seed`, `loadAsset` and
//   `pauseOffscreen` are read once, at mount.
// - `level` (a page's own reading) wins over the `audio` tap.
// - `moodFader` (player/frame.ts) and `resolveLookAt` (player/run.ts) are re-exported as before.
import type { Drive, Gesture, Look, Rig } from "@sr/rig";
import { useEffect, useRef, type ReactElement } from "react";
import type { LookAtPoint } from "../driver/lookAt.js";
import type { Gaze } from "../driver/state.js";
import { createAvatarPlayer, type FullAvatarPlayer, type LookAtRef } from "../player/player.js";
import type { AssetLoader } from "../render/assets.js";
import type { RigAssets } from "../render/types.js";
import type { ClipMouth } from "../speech/drive.js";

export { moodFader } from "../player/frame.js";
export { resolveLookAt } from "../player/run.js";

export interface AvatarCanvasProps {
  rig: Rig;
  look: Look;
  /** Keyed by `Layer.file`. */
  assets: RigAssets;
  /** Overrides the driver (tests, screenshots). */
  drive?: Drive;
  audio?: AudioNode | HTMLMediaElement;
  /**
   * The speech level 0..1, read every frame; wins over `audio` (perfection-pass 4.4: a page that
   * already taps its voice, the stage, hands its reading here instead of a second analyser).
   */
  level?: () => number;
  /**
   * A clip's mouth track on the clip's clock (perfection-pass task 4): while set, a rig whose
   * `mouthMode` is "drawn", "warp" or "morph" shapes its mouth (and opens its jaw) from the track; other
   * rigs keep the level drive. Under reduced motion one soft speaking shape (speech/drive.ts).
   */
  mouth?: ClipMouth | undefined;
  /** Default "host". */
  gaze?: Gaze;
  /** A change triggers playback. */
  gesture?: Gesture;
  /**
   * A signature act (tiger L1): each new `n` plays that layer's act once, from the next frame
   * (`n` lets the same layer play again). Absent: none.
   */
  act?: { layer: string; n: number };
  className?: string;
  /** Driver RNG seed; default 1. */
  seed?: number;
  /**
   * Stop stepping and drawing while the page is hidden or the face is fully outside the viewport,
   * resuming without a time jump (default true; read once, at mount).
   */
  pauseOffscreen?: boolean;
  /**
   * Look toward this point, normalised view space ([-1, 1] per axis, centre 0, y down; see
   * driver/lookAt.ts), or a ref holding it. Absent: behaviour is unchanged (costume 9).
   */
  lookAt?: LookAtPoint | LookAtRef;
  /** Loads a rig file missing from `assets` (a region map, a face patch) on first need. */
  loadAsset?: AssetLoader;
  /**
   * Eyes-only dim, 0..1, read every frame (default 0: the face lit as today). Every layer but an
   * emissive eye falls toward a hint of its light; the eyes keep theirs. It eases over about a
   * second (`easeDim`) and is instant under reduced motion.
   */
  dim?: number;
}

export function AvatarCanvas(props: AvatarCanvasProps): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<FullAvatarPlayer | undefined>(undefined);
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  // Mount: canvas and player, started. Unmount: dispose the player, remove the canvas.
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return undefined;
    const canvas = host.ownerDocument.createElement("canvas");
    canvas.style.cssText = "display:block;width:100%;height:100%";
    host.appendChild(canvas);
    const first = latest.current;
    const player = createAvatarPlayer(canvas, {
      rig: first.rig,
      look: first.look,
      assets: first.assets,
      backdrop: true,
      autoSize: true,
      ...(first.seed === undefined ? {} : { seed: first.seed }),
      ...(first.loadAsset === undefined ? {} : { loadAsset: first.loadAsset }),
      ...(first.pauseOffscreen === undefined ? {} : { pauseOffscreen: first.pauseOffscreen }),
    });
    playerRef.current = player;
    player.start();
    return () => {
      if (playerRef.current === player) playerRef.current = undefined;
      player.dispose();
      host.replaceChildren();
    };
  }, []);

  const { rig, assets, look, drive, gaze, dim, lookAt, mouth, level, audio, gesture } = props;
  useEffect(() => playerRef.current?.setRig(rig, assets), [rig, assets]);
  useEffect(() => playerRef.current?.setLook(look), [look]);
  useEffect(() => playerRef.current?.setDrive(drive), [drive]);
  useEffect(() => playerRef.current?.setGaze(gaze), [gaze]);
  useEffect(() => playerRef.current?.setDim(dim), [dim]);
  useEffect(() => playerRef.current?.setLookAt(lookAt), [lookAt]);
  useEffect(() => playerRef.current?.setClipMouth(mouth), [mouth]);
  useEffect(() => playerRef.current?.setLevelSource(level), [level]);

  // Audio: tap the source while it is set.
  useEffect(() => {
    if (audio === undefined) return undefined;
    const player = playerRef.current;
    player?.attachAudio(audio);
    return () => player?.attachAudio(undefined);
  }, [audio]);

  // Gesture: edge-triggered on change; the next frame starts it at the driver's t.
  useEffect(() => {
    if (gesture !== undefined) playerRef.current?.gesture(gesture);
  }, [gesture]);

  // Act: edge-triggered on a new `n`; the next frame starts it at the driver's t.
  const actLayer = props.act?.layer;
  const actN = props.act?.n;
  useEffect(() => {
    if (actLayer !== undefined && actN !== undefined) playerRef.current?.act(actLayer);
  }, [actLayer, actN]);

  return <div ref={hostRef} className={props.className} data-avatar="" />;
}
