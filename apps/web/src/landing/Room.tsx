// The root cellar around the set (landing requirement 4): the wide plate fills the frame, then
// static light layers. Children (the light throw, the set, the eye, the spiral) are composited
// between the back layers and the front ones, in the order the composition root gives them.
// The room carries the daemon's state (daemon.ts): once it is lost the set's spill goes with the
// picture, the spiral pumpkin (light position 0) goes out first and the gourds' glow on the floor
// dies with them; relighting brings it all back.
import type { CSSProperties, ReactNode } from "react";
import cellarWide from "../../../../assets/plates/cellar-wide.webp";
import type { Motion } from "../app/theme";
import { fadeMs, FOLD_MS, lightDelayMs, type DaemonState } from "./daemon";
import styles from "./Room.module.css";

export interface RoomProps {
  children?: ReactNode;
  daemon?: DaemonState;
  motion?: Motion;
  /** How many lights the room has (daemon.ts positions); the spiral is position 0. */
  lights?: number;
}

type Vars = CSSProperties & Record<`--${string}`, string>;

export function Room({ children, daemon = "online", motion = "reduced", lights = 1 }: RoomProps) {
  const vars: Vars = {
    "--delay": `${lightDelayMs(daemon, 0, lights, motion)}ms`,
    "--fade": `${fadeMs(daemon)}ms`,
    "--fold": `${FOLD_MS}ms`,
  };
  return (
    <div className={styles.room} data-room data-daemon={daemon} data-flame style={vars}>
      {/* The LCP element: a real <img>, fetched first (requirement 9.5). */}
      <img
        className={styles.cellar}
        src={cellarWide}
        width={1376}
        height={768}
        fetchPriority="high"
        alt="A root cellar: gourd piles left and right on a stone floor (stylised photo)"
      />
      <div className={styles.gourdGlow} aria-hidden="true" />
      <div className={styles.ceiling} aria-hidden="true" />
      {children}
      <div className={styles.spill} aria-hidden="true" />
      <div className={styles.vignette} aria-hidden="true" />
      <div className={styles.floorShade} aria-hidden="true" />
      <div className={styles.edges} aria-hidden="true" />
    </div>
  );
}
