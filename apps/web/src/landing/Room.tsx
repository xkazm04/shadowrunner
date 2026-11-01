// The root cellar around the set (landing requirement 4): the wide plate fills the frame, then
// static light layers. Children (the light throw, the set, the eye, the spiral) are composited
// between the back layers and the front ones, in the order the composition root gives them.
import type { ReactNode } from "react";
import cellarWide from "../../../../assets/plates/cellar-wide.webp";
import styles from "./Room.module.css";

export interface RoomProps {
  children?: ReactNode;
}

export function Room({ children }: RoomProps) {
  return (
    <div className={styles.room} data-room>
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
