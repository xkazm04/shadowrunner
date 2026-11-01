// The set's tube for the channels that are tuned on it (CH 6 Daemon, CH 9 Sealed), after the
// reference's `#tubeText` on the frontal set: the `crt-frontal` plate, and over its glass a cold
// phosphor grade, the channel's picture and type, scanlines and glare, all clipped to the glass
// superellipse (superellipse.ts GLASS, in the plate's 1200x896 space). `reticle` draws the test
// card of CH 6; `snow` the static of CH 9. On a narrow screen the glass stands alone, full width.
// Static: nothing here animates, so the reduced-motion twin is the same picture.
import type { CSSProperties, ReactNode } from "react";
import crtFrontal from "../../../../assets/plates/crt-frontal.webp";
import { clipPolygon, GLASS, PLATE, superellipse } from "../landing/superellipse";
import styles from "./Tube.module.css";

/** The glass in its own box (2a x 2b), so the clip fills an element of the glass's aspect. */
export const TUBE_CLIP = clipPolygon(superellipse({ ...GLASS, cx: GLASS.a, cy: GLASS.b }, 96), {
  width: 2 * GLASS.a,
  height: 2 * GLASS.b,
});

const pct = (v: number) => `${(v * 100).toFixed(4)}%`;

/** The glass box inside the plate, as percentages of the plate. */
export const GLASS_IN_PLATE: CSSProperties & Record<`--${string}`, string> = {
  "--glass-x": pct((GLASS.cx - GLASS.a) / PLATE.width),
  "--glass-y": pct((GLASS.cy - GLASS.b) / PLATE.height),
  "--glass-w": pct((2 * GLASS.a) / PLATE.width),
  "--glass-h": pct((2 * GLASS.b) / PLATE.height),
};

export interface TubeProps {
  label: string;
  picture?: "reticle" | "snow";
  children: ReactNode;
}

function Reticle() {
  return (
    <svg className={styles.reticle} viewBox="0 0 506 408" aria-hidden="true" focusable="false">
      {[60, 120, 180, 240].map((r) => (
        <circle key={r} cx="253" cy="204" r={r} />
      ))}
      <path d="M253 0V408M0 204H506" />
      {[
        [253, 24],
        [253, 384],
        [453, 204],
        [53, 204],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} className={styles.pip} cx={x} cy={y} r="4" />
      ))}
    </svg>
  );
}

function Snow() {
  return (
    <svg className={styles.snow} viewBox="0 0 506 408" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <filter id="sr-tube-snow" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="9" />
        <feColorMatrix type="saturate" values="0" />
        <feComponentTransfer>
          <feFuncA type="linear" slope="0" intercept="1" />
        </feComponentTransfer>
      </filter>
      <rect width="506" height="408" filter="url(#sr-tube-snow)" />
    </svg>
  );
}

export function Tube({ label, picture, children }: TubeProps) {
  return (
    <figure className={styles.set} style={GLASS_IN_PLATE} aria-label={label} data-tube={picture ?? "plain"}>
      <img className={styles.plate} src={crtFrontal} alt="" width={PLATE.width} height={PLATE.height} />
      <div className={styles.glass} style={{ clipPath: TUBE_CLIP }}>
        {picture === "reticle" && <Reticle />}
        {picture === "snow" && <Snow />}
        <div className={styles.text}>{children}</div>
        <div className={styles.scan} aria-hidden="true" />
      </div>
    </figure>
  );
}
