// The Chat tab (spec flashhead-live, task 3.3): a conversation turn goes as `chat`; the server's
// LLM answers and Iris speaks it, sentence by sentence, and each `reply-text` joins the thread.
// The key stays on the server: this page only ever sends the message text.
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from "react";
import type { ChatTurn } from "./log";
import list from "./Log.module.css";
import styles from "./Live.module.css";

export interface ChatTabProps {
  turns: readonly ChatTurn[];
  onChat: (text: string) => boolean;
  blocked: string | undefined;
}

export function ChatTab({ turns, onChat, blocked }: ChatTabProps): ReactElement {
  const [text, setText] = useState("");
  const end = useRef<HTMLLIElement>(null);
  const ready = blocked === undefined && text.trim() !== "";
  const lastReply = turns.at(-1)?.reply.length ?? 0;

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "nearest" });
  }, [turns.length, lastReply]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (ready && onChat(text.trim())) setText("");
  };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className={styles.tabBody}>
      {turns.length === 0 ? (
        <p className={styles.hint}>Say something to Iris; she answers out loud, on the stream.</p>
      ) : (
        <ol className={list.thread} aria-label="Conversation" data-live="thread">
          {turns.map((turn, i) => (
            <li key={turn.id} ref={i === turns.length - 1 ? end : undefined} className={list.turn} data-turn={turn.id} data-state={turn.status}>
              <p className={list.you}>
                <span className={list.who}>You</span> {turn.text}
              </p>
              <p className={list.iris}>
                <span className={list.who}>Iris</span>{" "}
                {turn.status === "error" ? turn.error : turn.reply.length > 0 ? turn.reply.join(" ") : turn.status === "waiting" ? "…" : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
      <form className={styles.compose} onSubmit={submit}>
        <label className={styles.field}>
          <span>Message</span>
          <textarea className={styles.text} rows={2} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} data-live="chat-text" />
        </label>
        <div className={styles.actions}>
          <button type="submit" className={styles.button} disabled={!ready} data-live="send">
            Send
          </button>
          {blocked !== undefined && <span className={styles.hint}>{blocked}</span>}
        </div>
      </form>
    </div>
  );
}
