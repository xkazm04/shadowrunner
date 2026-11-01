// The gourd with one carved eye on the right-hand pile (landing requirement 4.2), from `root-eye`.
// Static here: the pupil sits where `look` puts it (the resting gaze by default). Pointer tracking
// with easing, and no lag once the daemon is lost, arrive with the motion work (landing task 8).
import { useId } from "react";
import styles from "./Eye.module.css";

/** The SVG overlay's space, matching the reference (the photo is drawn to fill it). */
export const EYE_VIEWBOX = 1024;

/** Where the pupil rests in the slit with a straight gaze. */
export const PUPIL_REST = { x: 540, y: 512 } as const;

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

export interface EyeProps {
  look?: Look;
}

export function Eye({ look = REST_LOOK }: EyeProps) {
  const id = useId().replace(/[^\w-]/g, "");
  const slit = `sr-eye-slit-${id}`;
  const glow = `sr-eye-glow-${id}`;
  const pupil = pupilCentre(look);
  const cx = pupil.x.toFixed(1);
  const cy = pupil.y.toFixed(1);
  return (
    <div className={styles.eye} aria-hidden="true">
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
  );
}
