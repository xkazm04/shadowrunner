// The carrier on the set's glass when the daemon goes (landing requirement 7.1): the picture's
// power envelope folds to a line and then to a dot (folding, FOLD_MS), the dot's afterglow dies
// on dead glass under the NO CARRIER lower third (dark), and the raster opens again from the dot
// when health returns (relighting). Sized as the set's plate and clipped to the glass
// superellipse, like GlassCaption, so the set (task 5.2) can host it inside its shared mask and
// run the same envelope on <AvatarCanvas>.
// Online it renders nothing. Reduced motion never shows the timed states (daemon.ts settles them
// at once) and draws no afterglow: dark is the dead glass and its caption, static.
import type { CSSProperties } from "react";
import type { Plane } from "../app/plane";
import styles from "./Carrier.module.css";
import { FOLD_MS, relightMs, type DaemonState } from "./daemon";
import { GLASS_CLIP, LIGHTS, PLATE_VARS } from "./Gourds";

type Vars = CSSProperties & Record<`--${string}`, string | number>;

const VARS: Vars = { ...PLATE_VARS, "--fold": `${FOLD_MS}ms`, "--unfold": `${relightMs(LIGHTS)}ms` };

export interface CarrierProps {
  daemon: DaemonState;
  plane: Plane;
}

export function Carrier({ daemon, plane }: CarrierProps) {
  if (daemon === "online") return null;
  return (
    <div className={styles.plate} style={VARS} data-carrier={daemon}>
      <div className={styles.glass} style={{ clipPath: GLASS_CLIP }} aria-hidden="true">
        {daemon !== "dark" && <div className={styles.raster} />}
        {daemon === "dark" && <div className={styles.afterglow} />}
      </div>
      {daemon === "dark" && (
        <p className={styles.third} data-no-carrier>
          <span className={styles.title}>NO CARRIER</span>
          {/* Only the replay sample answers D; on live the daemon has to come back by itself. */}
          <span className={styles.line}>
            {plane === "replay" ? "Press D to re-seat the daemon" : "Waiting for the daemon to return"}
          </span>
        </p>
      )}
    </div>
  );
}
