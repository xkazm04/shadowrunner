// The landing's header row (landing requirement 2; costume task 2). On the set it is the only
// header: it sits in the world as an overlay, as in the prototype. Left to right: wordmark (tagged
// RECORDED on replay), viewers, the live-since clock (or the dead-air timer), the theme icon, the
// daemon pill. The ON AIR lamp hangs from the beam now (Lightbox.tsx) and the channel is chalked
// over the pitch (Pitch.tsx). In portrait the bar folds into two rows (StatusBar.module.css).
// The clock and the pill follow the daemon state the composition root derives from
// GET /api/health (daemonOf); the D key shows only on replay, where the sample toggle lives.
import { useEffect, useState, type ReactNode } from "react";
import type { Health, Plane } from "../app/plane";
import { handleLinkClick } from "../app/router";
import styles from "./StatusBar.module.css";

export type DaemonHealth = "online" | "lost";

/** Pure: the daemon is lost when health names the engine offline. No health (yet) is online. */
export function daemonOf(health: Health | undefined): DaemonHealth {
  return health?.engine === "offline" ? "lost" : "online";
}

/** The show went on air at three in the morning; the uptime the page opens on (reference). */
export const ON_AIR_SINCE = "03:00";
export const UP_AT_OPEN = 3 * 3600 + 12 * 60 + 40;

const pad = (n: number) => String(n).padStart(2, "0");

/** Pure: whole seconds as hh:mm:ss. Negative or non-finite input is 00:00:00. */
export function hms(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

export interface BroadcastClock {
  /** Seconds the show has been up. */
  up: number;
  /** Seconds of dead air since the daemon was lost (0 while it is online). */
  dead: number;
}

/**
 * Seconds of uptime, and seconds of dead air since the daemon was lost. Both start from the
 * page's first render (UP_AT_OPEN and 0), so a server render is deterministic. The composition
 * root runs one clock for the bar and the ghost note, so the two never disagree.
 */
export function useBroadcastClock(daemon: DaemonHealth): BroadcastClock {
  const [elapsed, setElapsed] = useState(0);
  const [lostAt, setLostAt] = useState<number | undefined>(daemon === "lost" ? 0 : undefined);
  useEffect(() => {
    const start = Date.now();
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);
  // The dead-air timer restarts each time the daemon is lost (state from the previous render).
  if (daemon === "lost" && lostAt === undefined) setLostAt(elapsed);
  if (daemon === "online" && lostAt !== undefined) setLostAt(undefined);
  return { up: UP_AT_OPEN + elapsed, dead: lostAt === undefined ? 0 : elapsed - lostAt };
}

export interface StatusBarProps {
  plane: Plane;
  daemon: DaemonHealth;
  /** The broadcast clock (useBroadcastClock); a fresh one (open, no dead air) when absent. */
  clock?: BroadcastClock;
  /** The shell's RECORDED badge (the shell keeps owning it), shown as a tag after the wordmark. */
  badge?: ReactNode;
  /** The shell's other controls (the theme toggle), between the stats and the pill. */
  controls?: ReactNode;
}

export function StatusBar({ plane, daemon, clock = { up: UP_AT_OPEN, dead: 0 }, badge, controls }: StatusBarProps) {
  const { up, dead } = clock;
  const on = daemon === "online";
  return (
    <header className={styles.bar} data-status-bar data-daemon={daemon}>
      <div className={styles.mark}>
        <a href="/" className={styles.brand} onClick={(event) => handleLinkClick(event, "/")}>
          Shadowrunner
        </a>
        {badge && <span className={styles.tag}>{badge}</span>}
      </div>
      <div className={styles.stats}>
        <span>
          Viewers <b>1</b>
          <span className={styles.opt}>{on ? " (you)" : " still you"}</span>
        </span>
        <span className={styles.sep} aria-hidden="true" />
        {on ? (
          <span>
            <span className={styles.opt}>Live </span>since <b>{ON_AIR_SINCE}</b>
            <span className={styles.opt}>
              {" · up "}
              <b className={styles.clock} data-clock>
                {hms(up)}
              </b>
            </span>
          </span>
        ) : (
          <span>
            Dead air for{" "}
            <b className={styles.clock} data-clock>
              {hms(dead)}
            </b>
          </span>
        )}
      </div>
      {controls && <div className={styles.controls}>{controls}</div>}
      <p className={styles.pill} role="status" data-pill={daemon}>
        <span className={styles.dot} aria-hidden="true" />
        {on ? (
          "Daemon online"
        ) : (
          // One flex item, so the pill's gap does not open between the state and its action.
          <span>
            DAEMON LOST<span className={styles.act}> · re-seat</span>
          </span>
        )}
        {plane === "replay" && <kbd>D</kbd>}
      </p>
    </header>
  );
}
