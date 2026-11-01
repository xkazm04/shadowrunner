// The sepia still each slide carries, and throws on the wall when pulled (costume design.md
// "Per-page notes, Landing"): CH 2 the cellar's face, CH 3 the Forge's lantern warden, CH 4 a
// listed character, CH 6 the carrier's bulb, CH 9 a sealed eye, O the stage's set. Photos are the
// committed stills; the bulb and the eye are drawn here (role-token strokes, Still.module.css), so
// no pumpkin art reaches the landing. The sepia grade and the brightness are the caller's.
import type { PageDef, PageId } from "../app/pages";
import crtFrontal from "../../../../assets/plates/crt-frontal.webp";
import lanternWarden from "../../../../assets/replay/thumbs/lantern-warden.webp";
import malakor from "../../../../assets/replay/thumbs/malakor.webp";
import mothWidow from "../../../../assets/replay/thumbs/moth-widow.webp";
import styles from "./Still.module.css";

interface Photo {
  src: string;
  /** object-position y, percent: where the face sits in the frame. */
  focus: number;
}

const PHOTOS: Partial<Record<PageId, Photo>> = {
  landing: { src: malakor, focus: 30 },
  creator: { src: lanternWarden, focus: 40 },
  characters: { src: mothWidow, focus: 28 },
  air: { src: crtFrontal, focus: 40 },
};

/** The carrier's bulb: a filament lamp, glowing. */
function Bulb() {
  return (
    <svg className={styles.art} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" focusable="false">
      <rect className={styles.ground} width="100" height="100" />
      <circle className={styles.halo} cx="50" cy="46" r="30" />
      <path
        className={styles.glass}
        d="M50 16c-16 0-26 11-26 25 0 10 6 16 10 22 2 4 3 8 3 12h26c0-4 1-8 3-12 4-6 10-12 10-22 0-14-10-25-26-25z"
      />
      <path className={styles.filament} d="M43 75V56l2.4-9 2.4 9 2.2-9 2.2 9 2.4-9 2.4 9v19" />
      <rect className={styles.cap} x="38" y="76" width="24" height="5" rx="1" />
      <rect className={styles.cap2} x="39" y="82" width="22" height="5" rx="1" />
      <rect className={styles.cap3} x="41" y="88" width="18" height="4" rx="2" />
    </svg>
  );
}

/** Nothing is broadcast on nine: an eye stitched shut under a wax seal. */
function SealedEye() {
  return (
    <svg className={styles.art} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" focusable="false">
      <rect className={styles.ground} width="100" height="100" />
      <path className={styles.socket} d="M14 50c10-15 22-22 36-22s26 7 36 22c-10 15-22 22-36 22s-26-7-36-22z" />
      <path className={styles.lid} d="M16 50c10 9 21 13 34 13s24-4 34-13" />
      <path className={styles.stitch} d="M30 52l4 10M40 55l2 11M50 56v11M60 55l-2 11M70 52l-4 10" />
      <circle className={styles.seal} cx="50" cy="73" r="8" />
      <circle className={styles.sealRim} cx="50" cy="73" r="5" />
    </svg>
  );
}

export interface StillProps {
  page: PageDef;
  className?: string;
}

export function Still({ page, className }: StillProps) {
  const cls = className ? `${styles.still} ${className}` : styles.still;
  const photo = PHOTOS[page.id];
  return (
    <span className={cls} data-still={page.id} aria-hidden="true">
      {photo ? (
        <img className={styles.photo} src={photo.src} alt="" decoding="async" style={{ objectPosition: `50% ${photo.focus}%` }} />
      ) : page.id === "daemon" ? (
        <Bulb />
      ) : (
        <SealedEye />
      )}
    </span>
  );
}
