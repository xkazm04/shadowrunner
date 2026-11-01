// The gourd with one carved eye on the right-hand pile (landing requirements 4.2, 4.4, 7.3), from
// `root-eye`. The pupil follows the pointer: eased while the show is on, with no lag at all once
// the daemon is dark (and with reduced motion, where nothing animates: it is simply where you
// are). In the dark the eye is the one light left, burning harder, captioned IT IS STILL LOOKING.
// No pointer, no motion: the pupil rests on the set (REST_LOOK).
import { useEffect, useId, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { Motion } from "../app/theme";
import { stareDelayMs, type DaemonState } from "./daemon";
import styles from "./Eye.module.css";
import type { WorldLayout } from "./World";

/** The SVG overlay's space, matching the reference (the photo is drawn to fill it). */
export const EYE_VIEWBOX = 1024;

/** Where the pupil rests in the slit with a straight gaze. */
export const PUPIL_REST = { x: 540, y: 512 } as const;

/** The eye box's width in world px (Eye.module.css). */
export const EYE_WORLD: Readonly<Record<WorldLayout, number>> = { landscape: 220, portrait: 110 };

/** World px from the eye's centre at which the gaze is fully turned (the reference's 600 x 450). */
export const GAZE_REACH = { x: 600, y: 450 } as const;

/** Per 60 Hz frame, the share of the way the eased pupil moves toward the pointer. */
export const GAZE_EASE = 0.02;

/** The carved slit, a diagonal sliver from lower left to upper right, in EYE_VIEWBOX units. */
const SLIT =
  "M410 642 L427 600 L449 560 L473 520 L514 480 L565 440 L620 405 L664 382 L652 412 L633 450 L618 480 " +
  "L608 500 L587 520 L569 540 L549 560 L524 580 L494 600 L460 622 Z";

export interface Look {
  /** -1 (left) .. 1 (right) */
  x: number;
  /** -1 (up) .. 1 (down) */
  y: number;
}

/** The reference's first frame: the eye looks toward the set, up and to the left. */
export const REST_LOOK: Look = { x: -1, y: -0.5667 };

function unit(n: number): number {
  return Number.isFinite(n) ? Math.max(-1, Math.min(1, n)) : 0;
}

/**
 * Pure: the pupil centre for a gaze. The gaze is clamped to [-1, 1] on each axis, then mostly
 * slides the pupil along the slit (78 units) and a little across it (16 units).
 */
export function pupilCentre(look: Look): { x: number; y: number } {
  const lx = unit(look.x);
  const ly = unit(look.y);
  const along = lx * 0.7 - ly * 0.72;
  const across = lx * 0.72 + ly * 0.7;
  return {
    x: PUPIL_REST.x + 0.7 * along * 78 + 0.72 * across * 16,
    y: PUPIL_REST.y - 0.72 * along * 78 + 0.7 * across * 16,
  };
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Pure: the gaze toward a pointer (screen px), given the eye box on screen and the world layout. */
export function gazeToward(pointer: { x: number; y: number }, eye: Box, layout: WorldLayout): Look {
  const scale = eye.width / EYE_WORLD[layout];
  if (!(scale > 0) || !Number.isFinite(scale)) return REST_LOOK;
  return {
    x: unit((pointer.x - (eye.left + eye.width / 2)) / (GAZE_REACH.x * scale)),
    y: unit((pointer.y - (eye.top + eye.height / 2)) / (GAZE_REACH.y * scale)),
  };
}

/** Pure: one easing step over `frames` 60 Hz frames; `instant` (no lag) lands on the target. */
export function easeLook(look: Look, target: Look, frames: number, instant: boolean): Look {
  const k = instant ? 1 : Math.max(0, Math.min(1, frames * GAZE_EASE));
  return { x: look.x + (target.x - look.x) * k, y: look.y + (target.y - look.y) * k };
}

const settled = (a: Look, b: Look) => Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3;

/** The gaze, following window pointer moves. The frame loop runs only while the pupil travels. */
function useGaze(eye: RefObject<HTMLDivElement | null>, instant: boolean): Look {
  const [look, setLook] = useState<Look>(REST_LOOK);
  const lagless = useRef(instant);
  useEffect(() => {
    lagless.current = instant;
  }, [instant]);
  useEffect(() => {
    let current = REST_LOOK;
    let target: Look | undefined;
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      frame = 0;
      if (!target) return;
      const frames = last ? Math.min(6, (now - last) / (1000 / 60)) : 1;
      last = now;
      current = settled(current, target) ? target : easeLook(current, target, frames, lagless.current);
      setLook(current);
      if (settled(current, target)) last = 0;
      else frame = requestAnimationFrame(tick);
    };
    const onMove = (event: PointerEvent) => {
      const el = eye.current;
      if (!el) return;
      const layout: WorldLayout = el.closest("[data-world]")?.getAttribute("data-world") === "portrait" ? "portrait" : "landscape";
      target = gazeToward({ x: event.clientX, y: event.clientY }, el.getBoundingClientRect(), layout);
      if (lagless.current) {
        current = target;
        setLook(target);
      } else if (!frame) {
        frame = requestAnimationFrame(tick);
      }
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [eye]);
  return look;
}

export interface EyeProps {
  /** A fixed gaze (tests, stills); without it the eye follows the pointer. */
  look?: Look;
  daemon?: DaemonState;
  motion?: Motion;
  /** How many lights go out before the eye is the last (daemon.ts), for the caption's delay. */
  lights?: number;
}

export function Eye({ look, daemon = "online", motion = "reduced", lights = 1 }: EyeProps) {
  const box = useRef<HTMLDivElement>(null);
  const dark = daemon === "dark";
  const gaze = useGaze(box, dark || motion === "reduced");
  const id = useId().replace(/[^\w-]/g, "");
  const slit = `sr-eye-slit-${id}`;
  const glow = `sr-eye-glow-${id}`;
  const pupil = pupilCentre(look ?? gaze);
  const cx = pupil.x.toFixed(1);
  const cy = pupil.y.toFixed(1);
  const stare: CSSProperties & Record<"--stare", string> = { "--stare": `${stareDelayMs(lights, motion)}ms` };
  return (
    <>
      <div ref={box} className={styles.eye} data-daemon={daemon} data-flame aria-hidden="true">
        <div className={styles.gourd} />
        <svg className={styles.overlay} viewBox={`0 0 ${EYE_VIEWBOX} ${EYE_VIEWBOX}`} focusable="false">
          <defs>
            <clipPath id={slit}>
              <path d={SLIT} />
            </clipPath>
            <radialGradient id={glow}>
              <stop offset="0" className={styles.glowCore} />
              <stop offset="0.5" className={styles.glowMid} />
              <stop offset="1" className={styles.glowEdge} />
            </radialGradient>
          </defs>
          <g clipPath={`url(#${slit})`}>
            <rect className={styles.core} x="380" y="360" width="300" height="300" />
            <ellipse className={styles.pupil} cx={cx} cy={cy} rx="30" ry="34" />
            <ellipse className={styles.pupil} cx={cx} cy={cy} rx="13" ry="15" />
          </g>
          <ellipse
            className={styles.glow}
            cx={PUPIL_REST.x}
            cy={PUPIL_REST.y}
            rx="190"
            ry="170"
            fill={`url(#${glow})`}
          />
        </svg>
      </div>
      {dark && (
        <p className={styles.note} style={stare} data-eye-note>
          IT IS STILL LOOKING
        </p>
      )}
    </>
  );
}
