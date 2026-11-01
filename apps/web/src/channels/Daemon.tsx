// CH 6, the root vault (costume task 5.1; requirement 6; r2/daemon-c.html "The Root Vault"). The
// Filament hangs from the grate of a root-choked vault and the plate is relit every frame from the
// bulb's position (DaemonRoom.ts); the filament is the carrier trace; the state word lies on the
// wet floor in perspective, catching the swing's shadow. Readings and "the cellar remembers" are
// bound to the real health (the shell's read, plus this page's own re-reads of /api/health through
// apiFetch) and the daemon state machine (landing/daemon.ts). The chain and D cut and re-seat the
// daemon: both are the shell's replay sample (the chain presses the shell's D), so on live the
// chain is slack and the daemon is the real one. Lost: only moonlight; the roots grow toward the
// empty socket with the dead-air seconds (DaemonVault.rootGrowth).
import { useEffect, useRef, useState } from "react";
import rootVault from "../../../../assets/plates/root-vault.webp";
import { apiFetch, fetchHealth, type Health, type Plane } from "../app/plane";
import { usePreferences, type Motion } from "../app/theme";
import { createDaemon, isLost, type DaemonState } from "../landing/daemon";
import { daemonOf, hms, UP_AT_OPEN } from "../landing/StatusBar";
import styles from "./Daemon.module.css";
import deck from "./DaemonDeck.module.css";
import { startRoom } from "./DaemonRoom";
import {
  filamentPath,
  healthEvent,
  remember,
  rootReachCm,
  ROOTS,
  stateEvents,
  vaultReadings,
  type VaultEvent,
} from "./DaemonVault";

/** How often the vault re-reads /api/health while it is open. */
export const REREAD_MS = 30_000;

/** Pure: the centre's lines for the state the vault is in. */
export function vaultCopy(plane: Plane, lost: boolean): { pull: string; note: string; pullable: boolean } {
  if (plane !== "replay") {
    return {
      pull: "THE CHAIN IS SLACK · LIVE",
      note: lost ? "no carrier · waiting for the daemon to return" : "on live the daemon is the real one",
      pullable: false,
    };
  }
  return lost
    ? { pull: "PULL IT AGAIN · RE-SEAT", note: "only the moon comes through the grate · press D to re-seat it", pullable: true }
    : { pull: "PULL THE CHAIN", note: "the roots carry the carrier up into the socket", pullable: true };
}

/** The daemon machine on this page: its state, and when it was entered (performance.now). */
function useVaultDaemon(lost: boolean, motion: Motion) {
  const [state, setState] = useState<DaemonState>(lost ? "dark" : "online");
  const since = useRef(0);
  const driver = useRef<ReturnType<typeof createDaemon> | undefined>(undefined);
  useEffect(() => {
    const d = createDaemon((next) => {
      since.current = performance.now();
      setState(next);
    }, ROOTS.length);
    driver.current = d;
    return () => d.dispose();
  }, []);
  useEffect(() => {
    driver.current?.health(lost, motion);
  }, [lost, motion]);
  return { state, since };
}

/** Seconds since the page opened, and since the daemon was lost (fractional, for the painter). */
function useVaultClock(lost: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const lostAt = useRef<number | undefined>(undefined);
  useEffect(() => {
    const start = performance.now();
    const id = window.setInterval(() => setElapsed(Math.floor((performance.now() - start) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    if (lost && lostAt.current === undefined) lostAt.current = performance.now();
    if (!lost) lostAt.current = undefined;
  }, [lost]);
  const dead = () => (lostAt.current === undefined ? 0 : Math.max(0, (performance.now() - lostAt.current) / 1000));
  return { elapsed, dead };
}

/** This page's own reads of /api/health (through apiFetch), on open and every REREAD_MS. */
function useReread(onRead: (health: Health | undefined) => void): { read: Health | undefined; done: boolean } {
  const [read, setRead] = useState<{ read: Health | undefined; done: boolean }>({ read: undefined, done: false });
  const cb = useRef(onRead);
  useEffect(() => {
    cb.current = onRead;
  });
  useEffect(() => {
    let live = true;
    const once = () =>
      void fetchHealth(apiFetch).then((health) => {
        if (!live) return;
        setRead({ read: health, done: true });
        cb.current(health);
      });
    once();
    const id = window.setInterval(once, REREAD_MS);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, []);
  return read;
}

export interface DaemonProps {
  health: Health | undefined;
  plane: Plane;
  /** The shell's verdict: health says offline, or the replay sample (D) is on. */
  lost: boolean;
}

const LINKS = Array.from({ length: 8 }, (_, i) => i);

export function Daemon({ health, plane, lost: shellLost }: DaemonProps) {
  const { motion } = usePreferences();
  const [events, setEvents] = useState<VaultEvent[]>([]);
  const clockAt = useRef(() => hms(UP_AT_OPEN));
  // A read is remembered when it says something new (the first, or a change), not every 30 s.
  const lastRead = useRef<string | undefined>(undefined);
  const reread = useReread((h) => {
    const event = healthEvent(h, plane, clockAt.current());
    if (event.text === lastRead.current) return;
    lastRead.current = event.text;
    setEvents((list) => remember(list, [event]));
  });
  const latest = reread.done ? reread.read : health;
  const lost = shellLost || daemonOf(reread.read) === "lost";
  const { state, since } = useVaultDaemon(lost, motion);
  const { elapsed, dead } = useVaultClock(isLost(state));
  const up = UP_AT_OPEN + elapsed;
  clockAt.current = () => hms(up);
  const shown = isLost(state);
  const deadNow = Math.floor(dead());
  const copy = vaultCopy(plane, shown);

  // What the cellar remembers: the bulb lit on open, then every state the daemon enters.
  const prev = useRef<DaemonState | undefined>(undefined);
  useEffect(() => {
    const from = prev.current;
    prev.current = state;
    const at = hms(up);
    const add: VaultEvent[] =
      from === undefined
        ? [
            { at, text: "bulb lit under the grate" },
            ...(isLost(state) ? stateEvents("dark", "online", at) : [{ at, text: "carrier locked · rising through the roots" }]),
          ]
        : stateEvents(state, from, at);
    if (add.length > 0) setEvents((list) => remember(list, add));
    // `up` is read at the moment of the change, not a trigger.
  }, [state]);

  const section = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pendulum = useRef<HTMLDivElement>(null);
  const filament = useRef<SVGPathElement>(null);
  const word = useRef<HTMLParagraphElement>(null);
  const chain = useRef<HTMLSpanElement>(null);
  const live = useRef({ state, since, dead, motion });
  live.current = { state, since, dead, motion };
  const room = useRef<ReturnType<typeof startRoom> | undefined>(undefined);
  useEffect(() => {
    if (!section.current || !canvas.current || !pendulum.current || !filament.current || !word.current) return;
    const r = startRoom(
      { section: section.current, canvas: canvas.current, pendulum: pendulum.current, filament: filament.current, word: word.current, plateSrc: rootVault },
      {
        state: () => live.current.state,
        since: () => live.current.since.current,
        dead: () => live.current.dead(),
        motion: () => live.current.motion,
      },
    );
    room.current = r;
    return () => r.stop();
  }, []);
  // Reduced motion paints on demand: each second (the roots grow) and on every state change.
  useEffect(() => {
    room.current?.paint();
  }, [state, motion, elapsed]);

  const pull = () => {
    const c = chain.current;
    if (c && motion === "full") {
      c.dataset.tug = "";
      window.setTimeout(() => delete c.dataset.tug, 220);
    }
    // The chain is the shell's D key (the replay sample); the shell owns that state.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "d", cancelable: true }));
  };

  const readings = vaultReadings({ health: latest, plane, lost: shown, up, dead: deadNow, motion });
  return (
    <section ref={section} className={styles.vault} data-page="daemon" data-daemon={shown ? "lost" : "online"} data-state={state} data-lost={shown || undefined} aria-labelledby="page-title">
      <canvas ref={canvas} className={styles.room} aria-hidden="true" />

      <div className={styles.rig}>
        <div ref={pendulum} className={styles.pend}>
          <span className={styles.wire} />
          <span className={styles.sock} />
          <span className={styles.bulb} aria-hidden="true">
            <span className={styles.env} />
            <svg viewBox="0 0 92 116" focusable="false">
              <line className={styles.post} x1="36" y1="0" x2="22" y2="60" />
              <line className={styles.post} x1="56" y1="0" x2="70" y2="60" />
              <path ref={filament} className={styles.fil} d={filamentPath(0, shown ? 0 : 1, shown)} />
            </svg>
          </span>
          <span ref={chain} className={styles.chain}>
            {LINKS.map((i) => (
              <i key={i} />
            ))}
            <button
              type="button"
              className={styles.pull}
              disabled={!copy.pullable}
              onClick={pull}
              aria-label={shown ? "Pull the chain: re-seat the daemon (D)" : "Pull the chain: cut the daemon (D)"}
            />
          </span>
        </div>
      </div>

      <p className={deck.growing} data-show={state === "dark" || undefined} aria-hidden="true">
        THE ROOTS ARE STILL GROWING
        <small>{rootReachCm(deadNow)} cm toward the empty socket</small>
      </p>

      <div className={deck.centre}>
        <h1 id="page-title" className={deck.kick}>
          Channel 6 · the daemon is<span className={styles.sr}>{shown ? " gone" : " awake"}</span>
        </h1>
        <p className={deck.since}>
          {shown ? "dead air " : "awake for "}
          <b>{shown ? hms(deadNow) : hms(up)}</b>
        </p>
        <button type="button" className={deck.pullbtn} disabled={!copy.pullable} onClick={pull}>
          <span>{copy.pull}</span>
          {copy.pullable && <kbd>D</kbd>}
        </button>
        <p className={deck.note}>{copy.note}</p>
      </div>

      <div className={deck.floor} aria-hidden="true">
        <p ref={word} className={deck.word}>
          {shown ? "GONE" : "AWAKE"}
        </p>
      </div>

      <section className={deck.log} aria-labelledby="vault-log">
        <h2 id="vault-log">THE CELLAR REMEMBERS</h2>
        <ol>
          {events.map((e, i) => (
            <li key={`${i}-${e.at}-${e.text}`} data-tone={e.tone}>
              <time>{e.at}</time>
              {e.text}
            </li>
          ))}
        </ol>
        <p className={deck.fict}>broadcast clock · {plane} plane</p>
      </section>

      <dl className={deck.readings} aria-label="Readings">
        {readings.map((r) => (
          <div key={r.key} data-tone={shown ? r.tone : undefined}>
            <dt>{r.key}</dt>
            <dd>
              {r.value}
              <small>{r.note}</small>
            </dd>
          </div>
        ))}
      </dl>

      <p className={styles.sr} role="status">
        {shown ? "The daemon is gone. Only the moon comes through the grate. The roots are still growing." : "The daemon is awake."}
      </p>
    </section>
  );
}
