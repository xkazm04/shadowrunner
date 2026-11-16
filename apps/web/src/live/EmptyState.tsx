// The control page with no live server (spec flashhead-live, task 3.3): how to start it, with a
// copy button, and when the page tries again. A refused origin (close 4403) names the flag that
// lets this page in.
import { useEffect, useState, type ReactElement } from "react";
import type { ConnectionStatus } from "./client";
import styles from "./Live.module.css";

export const START_COMMAND = "uv run th live";

/** The command that starts a server this page can reach (its port, and its origin when refused). */
export function startCommand(server: string, origin: string | undefined, refused: boolean): string {
  let port = "";
  try {
    const url = new URL(server);
    if (url.port !== "" && url.port !== "8765") port = ` --port ${url.port}`;
  } catch {
    // A malformed server URL: the plain command.
  }
  const allow = refused && origin !== undefined ? ` --allow-origin ${origin}` : "";
  return `${START_COMMAND}${port}${allow}`;
}

export function EmptyState({ status, server }: { status: ConnectionStatus; server: string }): ReactElement {
  const refused = status.kind === "refused";
  const origin = typeof window === "undefined" ? undefined : window.location.origin;
  const command = startCommand(server, origin, refused);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    void navigator.clipboard?.writeText(command).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <div className={styles.empty} data-live="empty">
      <h2 className={styles.heading}>{refused ? "The live server refused this page" : "No live server"}</h2>
      <p className={styles.command}>
        {refused ? "Restart it with this page's origin allowed:" : "Start the live server:"} <code className={styles.code}>{command}</code>{" "}
        <button type="button" className={styles.small} onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </p>
      <p className={styles.hint}>
        Run it in <code className={styles.code}>tools/talking-head</code>; it loads FlashHead Lite on the GPU (about 6.4 GB) and listens on{" "}
        <code className={styles.code}>{server}</code>.
        {status.kind === "down" && ` Trying again in ${Math.round(status.retryInMs / 100) / 10} s.`}
      </p>
      <span className={styles.hidden} role="status" aria-live="polite">
        {copied ? "Command copied." : ""}
      </span>
    </div>
  );
}
