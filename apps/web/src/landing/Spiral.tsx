// The lit spiral pumpkin in the left foreground, cut from `root-pile`, and the spiral of light
// dots it throws onto the wall (landing requirement 4.2). Static: both read the `--light` custom
// property (0 dark to 1 lit) from the Room, their shared ancestor, as `--glow` (the light times
// the flicker from fx/); the daemon-lost sequence (daemon.ts) drives `--light` there.
// Both parts are landscape-only, as in the reference.
import { useId } from "react";
import styles from "./Spiral.module.css";

export interface ThrowDot {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/** The thrown light in its own 520x560 box (world px), the reference's spiral of 40 dots. */
export const THROW_BOX = { width: 520, height: 560 } as const;

export const THROW_DOTS: readonly ThrowDot[] = Array.from({ length: 40 }, (_, i) => {
  const a = i * 0.6;
  const r = 10 + i * 5.4;
  const pr = 3.2 + i * 0.13;
  return {
    cx: 240 + Math.cos(a) * r * 1.3 + Math.sin(a) * r * 0.22,
    cy: 300 + Math.sin(a) * r * 1.02,
    rx: pr * 2.4,
    ry: pr * 2.1,
  };
});

/** The dots on the wall. Composited behind the set. */
export function SpiralThrow() {
  // useId output may hold characters that are awkward inside url(#...); keep it plain.
  const gradient = `sr-throw-${useId().replace(/[^\w-]/g, "")}`;
  return (
    <svg
      className={styles.throw}
      viewBox={`0 0 ${THROW_BOX.width} ${THROW_BOX.height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={gradient}>
          <stop offset="0" className={styles.dotCore} />
          <stop offset="0.32" className={styles.dotMid} />
          <stop offset="1" className={styles.dotEdge} />
        </radialGradient>
      </defs>
      {THROW_DOTS.map((dot, i) => (
        <ellipse
          key={i}
          cx={dot.cx.toFixed(1)}
          cy={dot.cy.toFixed(1)}
          rx={dot.rx.toFixed(2)}
          ry={dot.ry.toFixed(2)}
          fill={`url(#${gradient})`}
        />
      ))}
    </svg>
  );
}

/** The pumpkin itself: a soft crop of the pile and a screen-blended hot copy for its candle. */
export function Spiral() {
  return (
    <div className={styles.spiral} aria-hidden="true">
      <div className={`${styles.crop} ${styles.base}`} />
      <div className={`${styles.crop} ${styles.hot}`} />
    </div>
  );
}
