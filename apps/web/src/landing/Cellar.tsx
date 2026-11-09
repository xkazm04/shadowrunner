// The cellar around the face (costume requirement 3.1, 3.3; prototype `.room`, `.dark`, `.torch`,
// `.tvlight` (the spill), `.flame`): the vault plate, seen only where a light reaches it. The darkness is a
// radial mask around the visitor's torch, whose position the composition root writes as `--mx` and
// `--my` (percent of the world) on the cellar and the flame (`data-torch`): no React render per
// move. The face spills a cold glow on the wall while the lantern burns; once the daemon is lost the spill goes with it
// (`data-spill`, position 0 of daemon.ts's light schedule). With motion the torch is a flame that follows
// the pointer, and it flickers (fx/flicker.ts animates the scale and opacity of the light layers).
import type { CSSProperties } from "react";
import rootVault from "../../../../assets/plates/root-vault.webp";
import type { Motion } from "../app/theme";
import styles from "./Cellar.module.css";
import { fadeMs, isLost, lightDelayMs, type DaemonState } from "./daemon";
import { LIGHTS } from "./slides";

type Vars = CSSProperties & Record<`--${string}`, string>;

export interface CellarProps {
  daemon: DaemonState;
  motion: Motion;
}

export function Cellar({ daemon, motion }: CellarProps) {
  const vars: Vars = {
    "--delay": `${lightDelayMs(daemon, 0, LIGHTS, motion)}ms`,
    "--fade": `${fadeMs(daemon)}ms`,
  };
  return (
    <div className={styles.cellar} style={vars} data-cellar data-flame data-torch data-spill={isLost(daemon) ? "off" : "on"}>
      {/* The LCP element: a real <img>, fetched first. */}
      <img
        className={styles.room}
        src={rootVault}
        width={1376}
        height={768}
        fetchPriority="high"
        alt="A vaulted root cellar under a grate, roots through the brick (stylised photo)"
      />
      {/* The light layers flicker on the compositor (fx/flicker.ts, `data-flicker`). */}
      <div className={styles.spill} aria-hidden="true">
        <div className={styles.spillLight} data-flicker="opacity" />
      </div>
      <div className={styles.dark} data-flicker="scale" aria-hidden="true" />
      <div className={styles.torch} data-flicker="scale" aria-hidden="true" />
    </div>
  );
}

/** The flame at the torch, over everything but the intro's door (motion only, Cellar.module.css). */
export function Flame() {
  return <div className={styles.flame} data-torch aria-hidden="true" />;
}
