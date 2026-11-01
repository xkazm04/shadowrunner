// The carrier on the set's glass when the daemon goes (landing requirement 7.1): the picture's
// power envelope folds to a line and then to a dot (folding, FOLD_MS), the dot's afterglow dies
// on dead glass (dark), and the raster opens again from the dot when health returns (relighting).
// It renders inside the glass's shared clip (Glass.tsx), over the picture, which runs the same
// envelope (Glass.module.css); the NO CARRIER lower third is Glass.tsx's LowerThird.
// Online it renders nothing. Reduced motion never shows the timed states (daemon.ts settles them
// at once) and draws no afterglow: dark is the dead glass, static.
import type { CSSProperties } from "react";
import styles from "./Carrier.module.css";
import { FOLD_MS, relightMs, type DaemonState } from "./daemon";
import { LIGHTS } from "./Gourds";

type Vars = CSSProperties & Record<`--${string}`, string | number>;

const VARS: Vars = { "--fold": `${FOLD_MS}ms`, "--unfold": `${relightMs(LIGHTS)}ms` };

export interface CarrierProps {
  daemon: DaemonState;
}

export function Carrier({ daemon }: CarrierProps) {
  if (daemon === "online") return null;
  return (
    <div className={styles.carrier} style={VARS} data-carrier={daemon} aria-hidden="true">
      <div className={styles.dead} />
      {daemon !== "dark" && <div className={styles.raster} />}
      {daemon === "dark" && <div className={styles.afterglow} />}
    </div>
  );
}
