// The chat column (voice-and-air requirements 4.1, 4.5): the simulated audience on replay, the
// character's replies, and the visitor's own messages, which the picker may answer. Newest at the
// bottom; the list follows the newest message.
import type { ChatMsg } from "@sr/engine";
import { useEffect, useRef, useState, type FormEvent } from "react";
import styles from "./Chat.module.css";

export interface ChatProps {
  chat: readonly ChatMsg[];
  self: string;
  /** Returns false when the message was empty. */
  onPost(text: string): boolean;
  /** The message the character is answering right now. */
  answeredId?: string;
  maxLength: number;
}

function kindOf(msg: ChatMsg, self: string): "self" | "visitor" | "audience" {
  if (msg.user === self) return "self";
  return msg.fromVisitor ? "visitor" : "audience";
}

export function Chat({ chat, self, onPost, answeredId, maxLength }: ChatProps) {
  const [draft, setDraft] = useState("");
  const list = useRef<HTMLOListElement>(null);
  const newest = chat.at(-1)?.id;

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
      <h2 className={styles.chatTitle}>Chat</h2>
      <ol ref={list} className={styles.messages} aria-live="off">
        {chat.map((msg) => (
          <li key={msg.id} className={styles.message} data-kind={kindOf(msg, self)} data-answered={msg.id === answeredId ? "" : undefined}>
            <span className={styles.user}>{msg.user}</span> <span className={styles.text}>{msg.text}</span>
          </li>
        ))}
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
      </form>
    </section>
  );
}
