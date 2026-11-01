// Composition root of the landing, "The Lantern Slides" (costume task 2; prototype
// assets/_incoming/costume/r2/landing-c.html). A torch-lit cellar (Cellar) in one scaled world
// (World): Malakor projected out of the dark as the live rig (Apparition), his gaze on the visitor's
// torch; the ON AIR lightbox hanging from the beam (Lightbox); the pitch chalked on the left wall
// (Pitch) and the chat on the right (ChatStrip); at his feet the tray of magic-lantern slides that
// is the channel menu (SlideTray), whose pulled slide the lantern throws on the wall behind him
// (Projection); the status bar over all of it (on the set it is the header; the shell renders none).
// The daemon's state (daemon.ts) comes from health, or from the replay sample (key D, owned by the
// shell); every lit thing reads it. The torch follows the pointer and keyboard focus through CSS
// variables and refs, never a React render per move. With motion the effects chunk (fx/) adds the
// flicker, and the cellar opens in a short intro that any key or click skips.
import type { LookAtPoint } from "@sr/avatar";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type ReactNode, type RefObject } from "react";
import type { PageDef } from "../app/pages";
import { useHealth, type Plane } from "../app/plane";
import { usePreferences, type Motion } from "../app/theme";
import { Apparition } from "./Apparition";
import type { OnAirCharacter } from "./cast";
import { Cellar, Flame } from "./Cellar";
import { ChatStrip } from "./ChatStrip";
import { createDaemon, isLost, type DaemonDriver, type DaemonState } from "./daemon";
import styles from "./LandingPage.module.css";
import { Lightbox } from "./Lightbox";
import { Pitch } from "./Pitch";
import { Projection } from "./Projection";
import { SlideTray } from "./SlideTray";
import { LIGHTS } from "./slides";
import { daemonOf, StatusBar, useBroadcastClock } from "./StatusBar";
import { gazeAt, SLIDE_REACH, slideLight, TORCH_REST } from "./torch";
import { World } from "./World";

const CURRENT = "landing" as const;

/** The intro hands over control by then at the latest (requirement 9.3: within 4 s). */
export const INTRO_MS = 3500;

/** The intro plays once per page load: coming back to the set never replays it. */
let introPlayed = false;

/** Test hook: forget that the intro has played. */
export function resetIntro(): void {
  introPlayed = false;
}

/**
 * True while the cellar opens (motion only). Any key or pointer press ends it at once, without
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

/** The flame's flicker from the lazy fx chunk, with motion only. */
function useFlicker(motion: Motion, root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (motion !== "full") return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import("./fx").then((fx) => {
      if (!cancelled && root.current) stop = fx.startFlicker(root.current);
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [motion, root]);
}

/** True when `el` shows keyboard focus (a click's focus leaves the torch with the pointer). */
function focusVisible(el: HTMLElement): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

/**
 * The torch: aims the light at a client point. Writes `--mx` / `--my` (percent of the world) on
 * the root, `--lit` on every slide (torch.ts slideLight) and the face's look-at point (torch.ts
 * gazeAt) into `lookAt`. Follows the pointer (one aim per frame at most) and keyboard focus, and
 * rests low in the middle of the room until the visitor moves it.
 */
function useTorch(root: RefObject<HTMLElement | null>, lookAt: { current: LookAtPoint | null }) {
  const aim = useCallback(
    (clientX?: number, clientY?: number) => {
      const el = root.current;
      const world = el?.querySelector<HTMLElement>("[data-world-box]");
      if (!el || !world) return;
      const box = world.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return;
      const x = clientX ?? box.left + box.width * TORCH_REST.x;
      const y = clientY ?? box.top + box.height * TORCH_REST.y;
      el.style.setProperty("--mx", `${(((x - box.left) / box.width) * 100).toFixed(2)}%`);
      el.style.setProperty("--my", `${(((y - box.top) / box.height) * 100).toFixed(2)}%`);
      // World px to client px.
      const scale = world.offsetWidth > 0 ? box.width / world.offsetWidth : 1;
      const face = el.querySelector("[data-apparition]")?.getBoundingClientRect();
      if (face) {
        lookAt.current = gazeAt(
          { x, y },
          { x: face.left + face.width / 2, y: face.top + face.height * 0.34, reachX: box.width * 0.45, reachY: box.height * 0.45 },
        );
      }
      for (const slide of el.querySelectorAll<HTMLElement>("[data-slide]")) {
        const glass = slide.firstElementChild?.getBoundingClientRect();
        if (!glass) continue;
        const d = Math.hypot(glass.left + glass.width / 2 - x, glass.top + glass.height / 2 - y) / scale;
        slide.style.setProperty("--lit", slideLight(d, SLIDE_REACH).toFixed(2));
      }
    },
    [root, lookAt],
  );

  useEffect(() => {
    let frame = 0;
    let px = 0;
    let py = 0;
    const move = (event: PointerEvent) => {
      px = event.clientX;
      py = event.clientY;
      if (frame === 0) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          aim(px, py);
        });
      }
    };
    const rest = () => aim();
    rest();
    window.addEventListener("pointermove", move);
    window.addEventListener("resize", rest);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("resize", rest);
    };
  }, [aim]);

  /** Keyboard focus carries the torch to the focused control. */
  return useCallback(
    (event: FocusEvent<HTMLElement>) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !focusVisible(target)) return;
      const r = (target.firstElementChild ?? target).getBoundingClientRect();
      aim(r.left + r.width / 2, r.top + r.height / 2);
    },
    [aim],
  );
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
  /**
   * The user's own character once they have put it on air (requirement 3.5): it is projected
   * instead of Malakor. The on-air flow (spec voice-and-air) supplies it; absent until then.
   */
  onAir?: OnAirCharacter;
}

export function LandingPage({ plane = "replay", badge, controls, daemonSample = false, onAir }: LandingPageProps) {
  const { motion } = usePreferences();
  const lost = daemonOf(useHealth()) === "lost" || (plane === "replay" && daemonSample);
  const daemon = useDaemon(lost, motion);
  const down = isLost(daemon);
  const clock = useBroadcastClock(down ? "lost" : "online");
  const intro = useIntro(motion);
  const [pulled, setPulled] = useState<PageDef | undefined>(undefined);
  const root = useRef<HTMLElement>(null);
  const lookAt = useRef<LookAtPoint | null>(null);
  useFlicker(motion, root);
  const onFocus = useTorch(root, lookAt);
  return (
    <section
      ref={root}
      data-page="landing"
      data-daemon={daemon}
      data-intro={intro || undefined}
      aria-label="On air"
      className={styles.landing}
      onFocus={onFocus}
    >
      <World className={styles.stage}>
        <Cellar daemon={daemon} motion={motion} />
        <Projection pulled={pulled} current={CURRENT} lit={!down} />
        <Apparition
          daemon={daemon}
          plane={plane}
          motion={motion}
          dead={clock.dead}
          lookAt={lookAt}
          {...(onAir === undefined ? {} : { character: onAir })}
        />
        <Pitch />
        <ChatStrip plane={plane} motion={motion} paused={down} />
        <div className={styles.floor} aria-hidden="true" />
        <SlideTray current={CURRENT} plane={plane} daemon={daemon} motion={motion} pulled={pulled} onPull={setPulled} />
        <StatusBar plane={plane} daemon={down ? "lost" : "online"} clock={clock} badge={badge} controls={controls} />
        <Lightbox daemon={daemon} />
        {motion === "full" && <Flame />}
        {intro && (
          <div className={styles.door} data-intro-shade aria-hidden="true">
            <p>You opened the cellar.</p>
          </div>
        )}
      </World>
    </section>
  );
}
