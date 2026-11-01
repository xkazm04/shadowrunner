// <AvatarCanvas> (avatar-renderer req 6, 5.3): owns the canvas, renderer, driver and the
// requestAnimationFrame loop, so the creator and the on-air stage render the face identically.
//
// Decisions the spec leaves open:
// - The component renders a <div> (with `className`) and creates its <canvas> inside it, filling
//   it. The renderer may swap that canvas for a fresh one when WebGL2 is lost (a WebGL canvas
//   cannot give a 2D context), and React never owns the canvas node, so the swap is safe. The div
//   takes its size from `className`; the drawing buffer follows it (ResizeObserver, x DPR).
// - Timing is the driver's clock (react/loop.ts): the rAF timestamps only give the gap
//   between frames, which `step` clamps; blinks, gestures and the glow pulse run on driver `t`.
// - `gesture` triggers on every change to a defined value (including the first render); playing
//   the same gesture again needs the prop to change (e.g. through undefined).
// - The driver is seeded with `seed` (default 1), so two mounts with one seed move alike.
import { applyLook, poseLayers, type Drive, type Gesture, type Look, type Rig } from "@sr/rig";
import { useEffect, useRef, type ReactElement } from "react";
import { attachAudio, type AudioLevelTap } from "../audio/level.js";
import { initialState, type Gaze } from "../driver/state.js";
import { createRenderer } from "../gl/renderer.js";
import type { RigAssets } from "../render/types.js";
import { advanceFrame, isReducedMotion } from "./loop.js";

export interface AvatarCanvasProps {
  rig: Rig;
  look: Look;
  /** Keyed by `Layer.file`. */
  assets: RigAssets;
  /** Overrides the driver (tests, screenshots). */
  drive?: Drive;
  audio?: AudioNode | HTMLMediaElement;
  /** Default "host". */
  gaze?: Gaze;
  /** A change triggers playback. */
  gesture?: Gesture;
  className?: string;
  /** Driver RNG seed; default 1. */
  seed?: number;
}

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

/** The rig dressed by the look, recomputed only when either changes. */
function dresser(): (rig: Rig, look: Look) => Rig {
  let last: { rig: Rig; look: Look; dressed: Rig } | undefined;
  return (rig, look) => {
    if (last === undefined || last.rig !== rig || last.look !== look) last = { rig, look, dressed: applyLook(rig, look) };
    return last.dressed;
  };
}

export function AvatarCanvas(props: AvatarCanvasProps): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  const tapRef = useRef<AudioLevelTap | null>(null);
  const pendingGesture = useRef<Gesture | undefined>(undefined);

  useEffect(() => {
    latest.current = props;
  });

  // Mount: canvas, renderer, frame loop. Unmount: cancel the loop, dispose, remove the canvas.
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return undefined;
    const doc = host.ownerDocument;
    const win = doc.defaultView;
    if (win === null) return undefined;
    const canvas = doc.createElement("canvas");
    canvas.style.cssText = "display:block;width:100%;height:100%";
    host.appendChild(canvas);
    const first = latest.current;
    const renderer = createRenderer(canvas, first.rig, first.assets);
    let shown = { rig: first.rig, assets: first.assets };

    const resize = (): void => {
      const box = host.getBoundingClientRect();
      renderer.resize(Math.max(1, box.width), Math.max(1, box.height), win.devicePixelRatio || 1);
    };
    resize();
    const observer = typeof win.ResizeObserver === "function" ? new win.ResizeObserver(resize) : undefined;
    observer?.observe(host);

    const media = typeof win.matchMedia === "function" ? win.matchMedia(REDUCED_QUERY) : undefined;
    const dress = dresser();
    let state = initialState(first.seed ?? 1);
    let lastNow: number | undefined;
    let raf = 0;
    let alive = true;

    const frame = (now: number): void => {
      if (!alive) return;
      const p = latest.current;
      if (p.rig !== shown.rig || p.assets !== shown.assets) {
        renderer.setRig(p.rig, p.assets);
        shown = { rig: p.rig, assets: p.assets };
      }
      const reducedMotion = isReducedMotion(media?.matches ?? false, host.closest("[data-motion]")?.getAttribute("data-motion"));
      const gesture = pendingGesture.current;
      pendingGesture.current = undefined;
      const dt = lastNow === undefined ? 0 : (now - lastNow) / 1000;
      lastNow = now;
      const next = advanceFrame(state, {
        dt,
        level: tapRef.current?.level() ?? 0,
        gaze: p.gaze ?? "host",
        reducedMotion,
        ...(gesture === undefined ? {} : { gesture }),
        ...(p.drive === undefined ? {} : { drive: p.drive }),
      });
      state = next.state;
      const poses = poseLayers(dress(p.rig, p.look), p.look, next.drive);
      renderer.draw(poses, p.look, { t: p.drive?.t ?? state.t, reducedMotion });
      raf = win.requestAnimationFrame(frame);
    };
    raf = win.requestAnimationFrame(frame);

    return () => {
      alive = false;
      win.cancelAnimationFrame(raf);
      observer?.disconnect();
      renderer.dispose();
      host.replaceChildren();
    };
  }, []);

  // Audio: tap the source while it is set.
  useEffect(() => {
    if (props.audio === undefined) return undefined;
    const tap = attachAudio(props.audio);
    tapRef.current = tap;
    return () => {
      tap.detach();
      if (tapRef.current === tap) tapRef.current = null;
    };
  }, [props.audio]);

  // Gesture: edge-triggered on change; the next frame starts it at the driver's t.
  useEffect(() => {
    if (props.gesture !== undefined) pendingGesture.current = props.gesture;
  }, [props.gesture]);

  return <div ref={hostRef} className={props.className} data-avatar="" />;
}
