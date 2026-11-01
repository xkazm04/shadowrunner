// The live chat (landing requirement 6): a paper strip tacked under the rafter on the right
// (stacked last in the portrait world). Real HTML text on opaque `paper`, the host's lines in
// `paper-ink-signal`. The lines sit in their own clipped box inside the paper, bottom-anchored,
// with the older ones fading under a top mask, so no text can run under the strip's head or the
// status bar (the reference's defect).
// On replay the reference's script plays: viewer lines land whole and the host's are typed in.
// With reduced motion the strip is static (chatScript staticChat). On live the lines come from
// the engine (spec voice-and-air) through `feed`; until that lands the paper waits, empty.
import { useEffect, useRef, useState } from "react";
import type { Plane } from "../app/plane";
import type { Motion } from "../app/theme";
import styles from "./ChatStrip.module.css";
import {
  HOST_TAG,
  initialChat,
  isTyping,
  START_MS,
  staticChat,
  type ChatLine,
  type ChatState,
  type ShownLine,
} from "./chatScript";

/**
 * Replay with motion: the script on its clock, played by the typewriter in the lazy fx chunk.
 * Reduced motion: the static twin, no timer, no chunk. While not `enabled` (live, or the daemon
 * lost) the paper holds still and resumes where it stopped.
 */
function useScriptedChat(motion: Motion, enabled: boolean): ChatState {
  const [state, setState] = useState<ChatState>(() => (motion === "full" ? initialChat() : staticChat()));
  const current = useRef(state);
  const started = useRef(false);
  // Declared first, so on a motion change the reset lands before the player below restarts.
  useEffect(() => {
    const fresh = motion === "full" ? initialChat() : staticChat();
    current.current = fresh;
    started.current = false;
    setState(fresh);
  }, [motion]);
  useEffect(() => {
    if (!enabled || motion !== "full") return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import("./fx").then((fx) => {
      if (cancelled) return;
      stop = fx.playChat(
        current.current,
        (next) => {
          started.current = true;
          current.current = next;
          setState(next);
        },
        started.current ? undefined : START_MS,
      );
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [enabled, motion]);
  return state;
}

function Line({ shown, host }: { shown: ShownLine; host: string }) {
  const { line, typed } = shown;
  if (line.kind === "viewer") {
    return (
      <p className={styles.line} data-chat-line="viewer">
        <b>{line.user}</b> <span className={styles.rank}>{`· ${line.rank}`}</span>
        <br />
        {line.text}
      </p>
    );
  }
  const typing = isTyping(shown);
  return (
    <p className={`${styles.line} ${styles.host}`} data-chat-line="host" data-typing={typing || undefined}>
      <b>{host}</b>
      <br />
      {line.text.slice(0, typed)}
      {typing && <span className={styles.caret} aria-hidden="true" />}
    </p>
  );
}

export interface ChatStripProps {
  plane: Plane;
  motion: Motion;
  /** The host's name tag on the paper. */
  host?: string;
  /** Live lines from the engine (spec voice-and-air). Ignored on replay. */
  feed?: readonly ChatLine[];
  /** The daemon is lost: the host cannot answer, so the script holds where it is. */
  paused?: boolean;
}

export function ChatStrip({ plane, motion, host = HOST_TAG, feed, paused = false }: ChatStripProps) {
  const replay = plane === "replay";
  const scripted = useScriptedChat(motion, replay && !paused);
  const lines: readonly ShownLine[] = replay
    ? scripted.lines
    : (feed ?? []).map((line, id) => ({ id, line, typed: line.text.length }));
  return (
    <section className={styles.strip} aria-label={replay ? "Live chat (simulated)" : "Live chat"} data-chat>
      <div className={styles.head}>
        <span>
          <span className={styles.dot} aria-hidden="true">
            ●
          </span>{" "}
          LIVE CHAT
        </span>
        <span>{host}</span>
      </div>
      <span className={`${styles.tack} ${styles.tackStart}`} aria-hidden="true" />
      <span className={`${styles.tack} ${styles.tackEnd}`} aria-hidden="true" />
      <div className={styles.paper} data-chat-paper>
        <div className={styles.lines} data-chat-lines aria-live="off">
          {lines.length === 0 ? (
            <p className={styles.line} data-chat-line="empty">
              Waiting for the first message.
            </p>
          ) : (
            lines.map((shown) => <Line key={shown.id} shown={shown} host={host} />)
          )}
        </div>
      </div>
    </section>
  );
}
