// The chat column (voice-and-air 4.1, 4.5; costume 8.2): a niche in the catacomb wall. The header
// reads the chat velocity that lights the wall candles (eight wicks, lit by the corridor heat, and
// the count of the last 30 s). Messages: the simulated audience on replay, the character's
// replies, the visitor's own; every message he has answered keeps an "answered" mark, and the one
// he is answering right now is lit. Newest at the bottom; the list follows the newest message.
import type { ChatMsg } from "@sr/engine";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CANDLE_COUNT } from "./candles";
import styles from "./Chat.module.css";

export interface ChatProps {
  chat: readonly ChatMsg[];
  self: string;
  /** Returns false when the message was empty. */
  onPost(text: string): boolean;
  /** The message the character is answering right now. */
  answeredId?: string;
  /** Every message he has answered so far. */
  answered?: ReadonlySet<string>;
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

export function Chat({ chat, self, onPost, answeredId, answered, maxLength, velocity = 0, heat = 0 }: ChatProps) {
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
          const done = msg.id === answeredId || answered?.has(msg.id) === true;
          return (
            <li
              key={msg.id}
              className={styles.message}
              data-kind={kindOf(msg, self)}
              data-answered={done ? "" : undefined}
              data-answering={msg.id === answeredId ? "" : undefined}
            >
              <span className={styles.user}>{msg.user}</span> <span className={styles.text}>{msg.text}</span>
              {done && <span className={styles.mark}> answered</span>}
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
          <kbd>C</kbd> channels
        </p>
      </form>
    </section>
  );
}
