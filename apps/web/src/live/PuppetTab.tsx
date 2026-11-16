// The Puppet tab (spec flashhead-live, task 3.3): Iris lip-syncs to your microphone. Start sends
// `source: mic` and streams 0x10 frames (16 kHz PCM16, 40 ms); Stop sends `source: text`. Typed
// lines and chat are refused by the server meanwhile. A lost connection stops the mic.
import { useEffect, useRef, useState, type ReactElement } from "react";
import type { ClientMessage } from "./protocol";
import { startPuppet, type Puppet } from "./puppet";
import list from "./Log.module.css";
import styles from "./Live.module.css";

const LEVEL_EVERY_MS = 100;

export interface PuppetTabProps {
  open: boolean;
  /** The server's `state.source` is mic. */
  mic: boolean;
  send: (message: ClientMessage) => boolean;
  sendBinary: (data: ArrayBuffer) => boolean;
}

type Phase = { kind: "off" } | { kind: "starting" } | { kind: "on" } | { kind: "error"; error: string };

export function PuppetTab({ open, mic, send, sendBinary }: PuppetTabProps): ReactElement {
  const [phase, setPhase] = useState<Phase>({ kind: "off" });
  const [level, setLevel] = useState(0);
  const puppet = useRef<Puppet | undefined>(undefined);
  const latest = useRef(0);
  const attempt = useRef(0);

  const stop = (tell: boolean) => {
    attempt.current += 1;
    puppet.current?.stop();
    puppet.current = undefined;
    if (tell) send({ type: "source", source: "text" });
    setPhase({ kind: "off" });
    setLevel(0);
  };

  const start = async () => {
    const mine = ++attempt.current;
    setPhase({ kind: "starting" });
    const result = await startPuppet((frame) => void sendBinary(frame), (l) => (latest.current = l));
    if (mine !== attempt.current) {
      if (result.ok) result.puppet.stop();
      return;
    }
    if (!result.ok) return setPhase({ kind: "error", error: result.error });
    puppet.current = result.puppet;
    send({ type: "source", source: "mic" });
    setPhase({ kind: "on" });
  };

  // The meter reads the latest level ten times a second (the worklet reports far more often).
  useEffect(() => {
    if (phase.kind !== "on") return;
    const timer = window.setInterval(() => setLevel(latest.current), LEVEL_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [phase.kind]);

  // A dropped connection ends puppet mode; leaving the page stops the mic.
  useEffect(() => {
    // stop() only touches refs and setters, so `open` is the one dependency.
    if (!open && puppet.current !== undefined) stop(false);
  }, [open]);
  useEffect(
    () => () => {
      attempt.current += 1;
      puppet.current?.stop();
    },
    [],
  );

  const on = phase.kind === "on";
  return (
    <div className={styles.tabBody}>
      <p className={styles.hint}>
        Iris mouths what you say into the microphone. Your voice goes to the server only; this page does not play it back.
      </p>
      <div className={styles.actions}>
        {on || phase.kind === "starting" ? (
          <button type="button" className={styles.button} onClick={() => stop(true)} data-live="mic-stop">
            Stop the microphone
          </button>
        ) : (
          <button type="button" className={styles.button} onClick={() => void start()} disabled={!open} data-live="mic-start">
            Start the microphone
          </button>
        )}
        <label className={list.meterLabel}>
          <span>Level</span>
          <meter className={list.meter} min={0} max={0.5} value={Math.min(0.5, level)} />
        </label>
      </div>
      <p className={styles.hint} aria-live="polite" data-live="puppet-state">
        {phase.kind === "starting" ? "Asking for the microphone…" : phase.kind === "error" ? phase.error : on ? (mic ? "Puppet mode is on." : "Turning puppet mode on…") : "Puppet mode is off."}
      </p>
    </div>
  );
}
