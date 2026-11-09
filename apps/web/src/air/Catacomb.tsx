// The catacomb set (costume requirement 8.1, prototype r2/air-b.html "Candles of the Catacomb"):
// a symmetrical corridor plate whose vanishing point sits behind Malakor's skull. The tunnel's
// far light is his backlight (--back, bound to the speech level by useStageLights); the eight
// candles painted into the plate carry live flames (--flame, --glow, --refl per candle, from
// candleLevels). Pure presentation: every moving value is a CSS variable written through refs; the
// layers that read --back carry `data-back`, so the loop writes it on them and not on the stage.
import type { RefObject } from "react";
import { CANDLE_COUNT } from "./candles";
import styles from "./Catacomb.module.css";

export interface CatacombProps {
  /** The candle elements, by index, for the light loop to write into. */
  candles: RefObject<(HTMLElement | null)[]>;
}

const INDICES = Array.from({ length: CANDLE_COUNT }, (_, i) => i);

/** The plate and its lights, behind the face. */
export function CatacombPlate({ candles }: CatacombProps) {
  return (
    <div className={styles.plate} aria-hidden="true">
      <span className={styles.img} />
      <span className={styles.grade} />
      <span className={styles.tunnel} data-back />
      {INDICES.map((i) => (
        <span
          key={i}
          className={styles.candle}
          data-candle={i}
          ref={(el) => {
            if (candles.current) candles.current[i] = el;
          }}
        >
          <span className={styles.refl} />
          <span className={styles.halo} />
          <span className={styles.tip} />
        </span>
      ))}
    </div>
  );
}

/** Lights between the plate and the face: the warm key from the vault, the bulb, the bloom. */
export function CatacombLights() {
  return (
    <>
      <span className={styles.key} aria-hidden="true" />
      <span className={styles.bulb} aria-hidden="true">
        <span className={styles.glass} />
      </span>
      <span className={styles.bloom} data-back aria-hidden="true" />
      <span className={styles.pool} aria-hidden="true" />
    </>
  );
}

/** In front of the face: the floor lip and the dead line's static. */
export function CatacombFront() {
  return (
    <>
      <span className={styles.lip} aria-hidden="true" />
      <span className={styles.static} aria-hidden="true" />
    </>
  );
}
