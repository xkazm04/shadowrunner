// Composition root of the landing (spec landing, design.md "Files"). The world holds the cellar
// and its light, the eye and the spiral pumpkin, the gourd row and its legend, and the status bar
// over them: on the set the status bar is the header (the shell renders none on /). The set
// (task 5.2) joins here as its task lands. The chat strip hangs on the right (portrait: last).
// The daemon's state (daemon.ts) comes from health, or from the replay sample (key D, owned by
// the shell); every lit thing reads it. With motion, the effects chunk (fx/) adds the flicker
// and the dust, and the set warms up in a short intro that any key or click skips.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { PAGES, type PageDef } from "../app/pages";
import { useHealth, type Plane } from "../app/plane";
import { usePreferences, type Motion } from "../app/theme";
import { Carrier } from "./Carrier";
import { ChatStrip } from "./ChatStrip";
import { createDaemon, isLost, type DaemonDriver, type DaemonState } from "./daemon";
import { Eye } from "./Eye";
import { GlassCaption, Gourds, LIGHTS } from "./Gourds";
import styles from "./LandingPage.module.css";
import { Room } from "./Room";
import { Spiral, SpiralThrow } from "./Spiral";
import { daemonOf, StatusBar } from "./StatusBar";
import { World } from "./World";

const ON_AIR = PAGES.find((p) => p.id === "landing");
const CHANNEL = { number: ON_AIR?.channel ?? 2, title: ON_AIR?.title ?? "On air" };

/** The intro hands over control by then at the latest (requirement 9.3: within 4 s). */
export const INTRO_MS = 3500;

/** The intro plays once per page load: coming back to the set never replays it. */
let introPlayed = false;

/** Test hook: forget that the intro has played. */
export function resetIntro(): void {
  introPlayed = false;
}

/**
 * True while the set warms up (motion only). Any key or pointer press ends it at once, without
 * consuming the press, so a channel key still tunes. It never moves focus, scroll or route.
 */
export function useIntro(motion: Motion): boolean {
  const [on, setOn] = useState(() => motion === "full" && !introPlayed);
  useEffect(() => {
    if (!on) return;
    const finish = () => {
      introPlayed = true;
      setOn(false);
    };
    const timer = window.setTimeout(finish, INTRO_MS);
    window.addEventListener("keydown", finish, { capture: true });
    window.addEventListener("pointerdown", finish, { capture: true });
    return () => {
      // Leaving mid-intro counts as having seen it.
      introPlayed = true;
      window.clearTimeout(timer);
      window.removeEventListener("keydown", finish, { capture: true });
      window.removeEventListener("pointerdown", finish, { capture: true });
    };
  }, [on]);
  return on && motion === "full";
}

/** The daemon table on the browser's clock; applied before paint, so no frame shows a stale state. */
function useDaemon(lost: boolean, motion: Motion): DaemonState {
  const [state, setState] = useState<DaemonState>("online");
  const driver = useRef<DaemonDriver | null>(null);
  useLayoutEffect(() => {
    const d = createDaemon(setState, LIGHTS);
    driver.current = d;
    return () => d.dispose();
  }, []);
  useLayoutEffect(() => {
    driver.current?.health(lost, motion);
  }, [lost, motion]);
  return state;
}

/** Flicker and dust from the lazy fx chunk, with motion only. */
function useEffects(
  motion: Motion,
  root: RefObject<HTMLElement | null>,
  dust: RefObject<HTMLCanvasElement | null>,
  daemon: DaemonState,
): void {
  const picture = useRef(true);
  useEffect(() => {
    picture.current = !isLost(daemon);
  }, [daemon]);
  useEffect(() => {
    if (motion !== "full") return;
    const stops: (() => void)[] = [];
    let cancelled = false;
    void import("./fx").then((fx) => {
      if (cancelled) return;
      if (root.current) stops.push(fx.startFlicker(root.current));
      if (dust.current) stops.push(fx.startDust({ canvas: dust.current, active: () => picture.current }));
    });
    return () => {
      cancelled = true;
      for (const stop of stops) stop();
    };
  }, [motion, root, dust]);
}

export interface LandingPageProps {
  /** The plane the shell resolved (usePlane()); replay until told otherwise. */
  plane?: Plane;
  /** The shell's RECORDED badge, shown as a tag after the wordmark. */
  badge?: ReactNode;
  /** The shell's theme toggle, shown in the status bar before the daemon pill. */
  controls?: ReactNode;
  /** The replay sample (key D): play the daemon-lost state. The shell passes it on replay only. */
  daemonSample?: boolean;
}

export function LandingPage({ plane = "replay", badge, controls, daemonSample = false }: LandingPageProps) {
  const { motion } = usePreferences();
  const lost = daemonOf(useHealth()) === "lost" || (plane === "replay" && daemonSample);
  const daemon = useDaemon(lost, motion);
  const intro = useIntro(motion);
  const [hover, setHover] = useState<PageDef | undefined>(undefined);
  const root = useRef<HTMLElement>(null);
  const dust = useRef<HTMLCanvasElement>(null);
  useEffects(motion, root, dust, daemon);
  return (
    <section
      ref={root}
      data-page="landing"
      data-daemon={daemon}
      data-intro={intro || undefined}
      aria-label="On air"
      className={styles.landing}
    >
      <World className={styles.stage}>
        <Room daemon={daemon} motion={motion} lights={LIGHTS}>
          <SpiralThrow />
          {/* The set (task 5.2) stands here, in front of the thrown light and behind the eye, and
              hosts the carrier and the caption on its glass. The hovered channel is written there
              while the set has a picture; once the daemon is lost it folds to NO CARRIER. */}
          <Carrier daemon={daemon} plane={plane} />
          {!isLost(daemon) && <GlassCaption page={hover} />}
          <Eye daemon={daemon} motion={motion} lights={LIGHTS} />
          <Spiral />
          {motion === "full" && <canvas ref={dust} className={styles.dust} data-fx="dust" aria-hidden="true" />}
        </Room>
        {intro && <div className={styles.shade} data-intro-shade aria-hidden="true" />}
        <Gourds current={ON_AIR?.id} plane={plane} daemon={daemon} motion={motion} onHover={setHover} />
        <ChatStrip plane={plane} motion={motion} paused={isLost(daemon)} />
        <StatusBar
          plane={plane}
          daemon={isLost(daemon) ? "lost" : "online"}
          channel={CHANNEL}
          badge={badge}
          controls={controls}
        />
      </World>
    </section>
  );
}
