// CH 6 Daemon (landing requirement 8.2; design.md "Files"): the carrier's status, read off the
// same health the set reads (GET /api/health through usePlane/useHealth) and the shell's replay
// sample (key D). The reference tunes it on the tube as a test card: "DAEMON online, carrier
// steady, uptime, press D to cut it". Every row is bound to a real state; nothing is invented:
// there is one health read per visit, so the row says when it was read, not a heartbeat.
import { useEffect, useState } from "react";
import type { Health, Plane } from "../app/plane";
import { hms, ON_AIR_SINCE, UP_AT_OPEN } from "../landing/StatusBar";
import styles from "./Daemon.module.css";
import { Tube } from "./Tube";

export interface DaemonRow {
  key: string;
  value: string;
  /** The row carries the alarm (the lost daemon). */
  alarm?: boolean;
}

export interface DaemonReading {
  health: Health | undefined;
  plane: Plane;
  /** The daemon is lost: health names the engine offline, or the replay sample says so. */
  lost: boolean;
  /** Seconds since the page opened. */
  elapsed: number;
  /** Seconds since the daemon was lost (0 while online). */
  dead: number;
}

/** Pure: the test card's rows, top to bottom. */
export function daemonRows({ health, plane, lost, elapsed, dead }: DaemonReading): DaemonRow[] {
  const rows: DaemonRow[] = [
    lost ? { key: "DAEMON", value: "LOST", alarm: true } : { key: "DAEMON", value: "online" },
    { key: "carrier", value: lost ? "none" : "steady" },
    { key: "plane", value: plane === "replay" ? "replay · recorded" : "live" },
    { key: "engine", value: health === undefined ? "no answer · replay" : health.engine },
    lost ? { key: "dead air", value: hms(dead) } : { key: "uptime", value: hms(UP_AT_OPEN + elapsed) },
    {
      key: "quota",
      value: plane === "replay" ? "none spent · replay" : "not reported by health",
    },
  ];
  if (health !== undefined) rows.push({ key: "version", value: health.version });
  return rows;
}

/** Pure: the one action line. The sample key exists only on replay. */
export function daemonAction(plane: Plane, lost: boolean): string {
  if (plane !== "replay") return lost ? "waiting for the daemon to return" : `on air since ${ON_AIR_SINCE}`;
  return lost ? "press D to re-seat it" : "press D to cut it";
}

function useSeconds(lost: boolean): { elapsed: number; dead: number } {
  const [elapsed, setElapsed] = useState(0);
  const [lostAt, setLostAt] = useState<number | undefined>(lost ? 0 : undefined);
  useEffect(() => {
    const start = Date.now();
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (lost && lostAt === undefined) setLostAt(elapsed);
  if (!lost && lostAt !== undefined) setLostAt(undefined);
  return { elapsed, dead: lostAt === undefined ? 0 : elapsed - lostAt };
}

export interface DaemonProps {
  health: Health | undefined;
  plane: Plane;
  lost: boolean;
}

export function Daemon({ health, plane, lost }: DaemonProps) {
  const { elapsed, dead } = useSeconds(lost);
  const rows = daemonRows({ health, plane, lost, elapsed, dead });
  return (
    <section className={styles.page} data-page="daemon" data-daemon={lost ? "lost" : "online"} aria-labelledby="page-title">
      <Tube label="Channel 6 on the tube: the daemon's test card" picture="reticle">
        <h1 id="page-title" className={styles.kick}>
          Channel 6
        </h1>
        <dl className={styles.card}>
          {rows.map((row) => (
            <div key={row.key} className={styles.row} data-alarm={row.alarm || undefined}>
              <dt>{row.key}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
        <p className={styles.action} aria-live="polite">
          {daemonAction(plane, lost)}
        </p>
      </Tube>
    </section>
  );
}
