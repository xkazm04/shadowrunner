// Composition root of the landing (spec landing, design.md "Files"). The world holds the cellar
// and its light, the eye and the spiral pumpkin, and the status bar over them: on the set the
// status bar is the header (the shell renders none on /). The set (task 5), the gourds (task 6)
// and the chat (task 7) join here as their tasks land.
import type { ReactNode } from "react";
import { PAGES } from "../app/pages";
import { useHealth, type Plane } from "../app/plane";
import { Eye } from "./Eye";
import styles from "./LandingPage.module.css";
import { Room } from "./Room";
import { Spiral, SpiralThrow } from "./Spiral";
import { daemonOf, StatusBar } from "./StatusBar";
import { World } from "./World";

const ON_AIR = PAGES.find((p) => p.id === "landing");
const CHANNEL = { number: ON_AIR?.channel ?? 2, title: ON_AIR?.title ?? "On air" };

export interface LandingPageProps {
  /** The plane the shell resolved (usePlane()); replay until told otherwise. */
  plane?: Plane;
  /** The shell's RECORDED badge, shown as a tag after the wordmark. */
  badge?: ReactNode;
  /** The shell's theme toggle, shown in the status bar before the daemon pill. */
  controls?: ReactNode;
}

export function LandingPage({ plane = "replay", badge, controls }: LandingPageProps) {
  const daemon = daemonOf(useHealth());
  return (
    <section data-page="landing" aria-label="On air" className={styles.landing}>
      <World className={styles.stage}>
        <Room>
          <SpiralThrow />
          {/* The set (task 5) stands here: in front of the thrown light, behind the eye. */}
          <Eye />
          <Spiral />
        </Room>
        <StatusBar plane={plane} daemon={daemon} channel={CHANNEL} badge={badge} controls={controls} />
      </World>
    </section>
  );
}
