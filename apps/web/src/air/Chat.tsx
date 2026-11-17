// The chat column (voice-and-air 4.1, 4.5; costume 8.2): a niche in the catacomb wall. The header
// reads the chat velocity that lights the wall candles (eight wicks, lit by the corridor heat, and
// the count of the last 30 s). Messages: the simulated audience on replay, the character's
// replies, the visitor's own; every message he has answered keeps an "answered" mark, and the one
// he is answering right now is lit. Newest at the bottom; the list follows the newest message.
// perfection-pass 5.1: a visitor's message says "queued" until a pick takes it, then "answering"
// while its reply is on the way, then the marks above once he speaks it.
// challenge-2026-11-17 air/A: the marks come whole from the show (chatMarks.ts), one per message;
// a visitor's message a pick went by without answering it says "passed by".
// challenge-2026-11-17 air/B: a message nobody has answered carries a cue button (the producer
// desk, showDesk.ts): pressed, the character answers it next.
import type { ChatMsg } from "@sr/engine";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CANDLE_COUNT } from "./candles";
import type { ChatMarks } from "./chatMarks";
import type { AirMsg } from "./showModel";
import styles from "./Chat.module.css";

export interface ChatProps {
  chat: readonly AirMsg[];
  self: string;
  /** Returns false when the message was empty. */
  onPost(text: string): boolean;
  /** One lifecycle mark per message (show.ts snapshot `marks`); a message without one is plain. */
  marks?: ChatMarks;
  /** The producer desk: the message the next pick takes, and cueing one (false when refused). */
  cued?: string;
  onCue?(id: string): boolean;
  maxLength: number;
  /** Messages in the last 30 s, and the corridor heat they make (0..1). */
  velocity?: number;
  heat?: number;
}

function kindOf(msg: ChatMsg, self: string): "self" | "visitor" | "audience" {
  if (msg.user === self) return "self";
  return msg.fromVisitor ? "visitor" : "audience";
}

const WICKS = Array.from({ length: CANDLE_COUNT }, (_, i) => i);

export function Chat({ chat, self, onPost, marks, cued, onCue, maxLength, velocity = 0, heat = 0 }: ChatProps) {
  const [draft, setDraft] = useState("");
  const list = useRef<HTMLOListElement>(null);
  const newest = chat.at(-1)?.id;
  const lit = Math.round(heat * CANDLE_COUNT);

  useEffect(() => {
    const el = list.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [newest]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (onPost(draft)) setDraft("");
  };

  return (
    <section className={styles.chat} aria-label="Chat">
      <header className={styles.head}>
        <h2 className={styles.chatTitle}>Chat</h2>
        <p className={styles.vel} title="Chat velocity feeds the wall candles; each chatter's candle flares when they post">
          <span>candles</span>
          <span className={styles.wicks} aria-hidden="true">
            {WICKS.map((i) => (
              <span key={i} className={styles.wick} data-on={i < lit ? "" : undefined} />
            ))}
          </span>
          <span>
            <b className={styles.velCount}>{velocity}</b> / 30 s
          </span>
        </p>
      </header>
      <ol ref={list} className={styles.messages} aria-live="off">
        {chat.map((msg) => {
          const mark = marks?.[msg.id] ?? "none";
          const done = mark === "answered" || mark === "answering";
          const isCued = msg.id === cued;
          const cueable = onCue !== undefined && msg.user !== self && (mark === "none" || mark === "queued" || mark === "passed");
          return (
            <li
              key={msg.id}
              data-id={msg.id}
              className={styles.message}
              data-kind={kindOf(msg, self)}
              data-answered={done ? "" : undefined}
              data-answering={mark === "answering" ? "" : undefined}
              data-queued={mark === "queued" ? "" : undefined}
              data-pending={mark === "pending" ? "" : undefined}
              data-passed={mark === "passed" ? "" : undefined}
              data-cued={isCued ? "" : undefined}
            >
              <span className={styles.user}>{msg.user}</span> <span className={styles.text}>{msg.text}</span>
              {done && <span className={styles.mark}> answered</span>}
              {mark === "queued" && <span className={styles.waitMark}> queued</span>}
              {mark === "pending" && <span className={styles.waitMark}> answering</span>}
              {mark === "passed" && <span className={styles.waitMark}> passed by</span>}
              {cueable && (
                <button type="button" className={styles.cue} data-cue="" aria-pressed={isCued} aria-label={`Answer next: ${msg.user}`} onClick={() => onCue(msg.id)}>
                  {isCued ? "cued" : "cue"}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      <form className={styles.compose} onSubmit={submit}>
        <label className={styles.composeLabel} htmlFor="air-say">
          Say something to {self}
        </label>
        <div className={styles.composeRow}>
          <input
            id="air-say"
            className={styles.input}
            value={draft}
            maxLength={maxLength}
            autoComplete="off"
            placeholder="Ask him anything"
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" className={styles.send}>
            Send
          </button>
        </div>
        <p className={styles.keys}>
          <kbd>C</kbd> channels <kbd>H</kbd> hold <kbd>S</kbd> skip
        </p>
      </form>
    </section>
  );
}
