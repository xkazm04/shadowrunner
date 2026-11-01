// The library region (creator requirement 2): the characters kept on this computer, the active one
// marked, a confirm step before a delete (never offered for the seeded Malakor), damaged records
// listed but never rendered, the private-mode notice, and the way to the replay gallery.
// Since creator task 9 the whole cast lives here, so the strip is a grid of portrait tiles that
// shows every character at once (it wraps rather than scrolls).
import { useEffect, useState, type ReactNode } from "react";
import type { CharacterRecord, LibraryEntry, RemoveResult } from "./libraryStore";
import { thumbnailOf } from "./thumbnail";
import styles from "./Library.module.css";

export interface LibraryProps {
  entries: readonly LibraryEntry[];
  activeId?: string;
  persistent: boolean;
  status: "loading" | "ready" | "failed";
  onSelect: (id: string) => void;
  onRemove: (id: string) => Promise<RemoveResult>;
  onOpenGallery: () => void;
  /** The strip's last slot (the Forge's "+ Forge new"). */
  extra?: ReactNode;
}

function Thumb({ record }: { record: CharacterRecord }) {
  const [url, setUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void thumbnailOf(`${record.id}@${record.createdAt}`, record.rig, record.assets).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [record]);
  return url === undefined ? (
    <span className={styles.initial} aria-hidden="true">
      {record.rig.name.replace(/^(the|arch-lich)\s+/i, "").charAt(0)}
    </span>
  ) : (
    <img className={styles.thumb} src={url} alt="" />
  );
}

export function Library({ entries, activeId, persistent, status, onSelect, onRemove, onOpenGallery, extra }: LibraryProps) {
  const [confirming, setConfirming] = useState<string | undefined>(undefined);
  const [refused, setRefused] = useState<string | undefined>(undefined);
  const count = entries.filter((e) => e.kind === "ok").length;

  const remove = async (id: string): Promise<void> => {
    const result = await onRemove(id);
    setConfirming(undefined);
    setRefused(result === "refused" ? id : undefined);
  };

  return (
    <section className={styles.library} aria-labelledby="library-title" data-region="library">
      <header className={styles.head}>
        <h2 id="library-title" className={styles.title}>
          Characters <span className={styles.count}>{status === "loading" ? "…" : count}</span>
        </h2>
        <button type="button" className={styles.galleryButton} onClick={onOpenGallery}>
          Replay gallery
        </button>
      </header>
      {!persistent && status !== "loading" && (
        <p className={styles.notice} role="status">
          This window keeps nothing: characters last until the tab closes.
        </p>
      )}
      {status === "loading" && <p className={styles.note}>Opening the library…</p>}
      {status !== "loading" && count === 0 && (
        <p className={styles.note}>
          No characters yet. Forge one, or adopt one from the replay gallery.
        </p>
      )}
      <ul className={styles.list}>
        {entries.map((entry) => {
          if (entry.kind === "damaged") {
            return (
              <li key={`damaged-${entry.id}`} className={styles.damaged} data-damaged="">
                <span className={styles.damagedText}>
                  <b>{entry.name ?? entry.id}</b> is damaged and cannot be shown ({entry.reason}).
                </span>
                <button type="button" className={styles.small} onClick={() => void remove(entry.id)}>
                  Remove
                </button>
              </li>
            );
          }
          const { record } = entry;
          const name = record.rig.name;
          return (
            <li key={record.id} className={styles.item} data-character={record.id}>
              <button
                type="button"
                className={styles.card}
                aria-pressed={record.id === activeId}
                aria-label={`${name}${record.id === activeId ? ", on the stage" : ""}`}
                onClick={() => onSelect(record.id)}
              >
                <Thumb record={record} />
                <span className={styles.name}>{name.replace(/^the\s+/i, "")}</span>
              </button>
              {confirming === record.id ? (
                <span className={styles.confirm} role="group" aria-label={`Delete ${name}?`}>
                  <button type="button" className={`${styles.small} ${styles.danger}`} onClick={() => void remove(record.id)}>
                    Delete
                  </button>
                  <button type="button" className={styles.small} onClick={() => setConfirming(undefined)}>
                    Keep
                  </button>
                </span>
              ) : record.seeded === true ? (
                refused === record.id && <span className={styles.house}>The house character stays.</span>
              ) : (
                <button type="button" className={`${styles.small} ${styles.remove}`} aria-label={`Delete ${name}`} title={`Delete ${name}`} onClick={() => setConfirming(record.id)}>
                  ✕
                </button>
              )}
            </li>
          );
        })}
        {extra !== undefined && <li className={styles.item}>{extra}</li>}
      </ul>
    </section>
  );
}
