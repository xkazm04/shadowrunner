// Composition root of the landing (spec landing, design.md "Files"). The world holds the cellar
// and its light, the eye and the spiral pumpkin, the gourd row and its legend, and the status bar
// over them: on the set the status bar is the header (the shell renders none on /). The set
// (task 5.2) joins here as its task lands. The chat strip hangs on the right (portrait: last).
import { useState, type ReactNode } from "react";
import { PAGES, type PageDef } from "../app/pages";
import { useHealth, type Plane } from "../app/plane";
import { usePreferences } from "../app/theme";
import { ChatStrip } from "./ChatStrip";
import { Eye } from "./Eye";
import { GlassCaption, Gourds } from "./Gourds";
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
  const { motion } = usePreferences();
  const [hover, setHover] = useState<PageDef | undefined>(undefined);
  return (
    <section data-page="landing" aria-label="On air" className={styles.landing}>
      <World className={styles.stage}>
        <Room>
          <SpiralThrow />
          {/* The set (task 5.2) stands here, in front of the thrown light and behind the eye. Until
              then the hovered channel is written on its glass's place. Once the daemon is lost,
              the glass shows NO CARRIER instead (task 8). */}
          {daemon === "online" && <GlassCaption page={hover} />}
          <Eye />
          <Spiral />
        </Room>
        <Gourds current={ON_AIR?.id} plane={plane} onHover={setHover} />
        <ChatStrip plane={plane} motion={motion} />
        <StatusBar plane={plane} daemon={daemon} channel={CHANNEL} badge={badge} controls={controls} />
      </World>
    </section>
  );
}
