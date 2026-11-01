// The landing's header row (landing requirement 2). On the set it is the only header: it sits in
// the world as an overlay, as in the reference. Left to right: wordmark (tagged RECORDED on
// replay), ON AIR lamp, viewers, channel, the live-since clock (or the dead-air timer), the theme
// icon, the daemon pill. In portrait it folds into two rows (task 5.0, StatusBar.module.css).
// The lamp, the clock and the pill follow the daemon state the composition root derives from
// GET /api/health (daemonOf); the D key shows only on replay, where the sample toggle lives
// (task 8 wires the toggle itself).
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

/**
 * Seconds of uptime, and seconds of dead air since the daemon was lost. Both start from the
 * page's first render (UP_AT_OPEN and 0), so a server render is deterministic.
 */
function useBroadcastClock(daemon: DaemonHealth): { up: number; dead: number } {
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
  /** The channel on the set: number and manifest title. */
  channel: { number: number; title: string };
  /** The shell's RECORDED badge (the shell keeps owning it), shown as a tag after the wordmark. */
  badge?: ReactNode;
  /** The shell's other controls (the theme toggle), between the stats and the pill. */
  controls?: ReactNode;
}

export function StatusBar({ plane, daemon, channel, badge, controls }: StatusBarProps) {
  const { up, dead } = useBroadcastClock(daemon);
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
        <span className={styles.lamp} data-lamp={on ? "on" : "off"}>
          {on ? "ON AIR" : "OFF AIR"}
        </span>
        <span>
          Viewers <b>1</b>
          <span className={styles.opt}>{on ? " (you)" : " still you"}</span>
        </span>
        <span className={styles.sep} aria-hidden="true" />
        <span>
          <span className={styles.opt}>Channel </span>
          <b>{`${channel.number} · ${channel.title}`}</b>
        </span>
        <span className={styles.sep} aria-hidden="true" />
        {on ? (
          <span>
            <span className={styles.opt}>Live </span>since <b>{ON_AIR_SINCE}</b>
            <span className={styles.opt}>
              {" · up "}
              <b className={styles.clock}>{hms(up)}</b>
            </span>
          </span>
        ) : (
          <span>
            Dead air for <b className={styles.clock}>{hms(dead)}</b>
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
