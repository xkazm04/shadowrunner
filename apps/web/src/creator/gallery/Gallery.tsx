// The replay gallery (creator requirement 4): ready-made fictional characters a judge with no keys
// can adopt at once. Adopting copies the character into the library as a new record that can be
// customised. Reachable from the forge's quota state and from the library.
import { useEffect, useState } from "react";
import { loadGallery, type GalleryEntry } from "./entries";
import styles from "./Gallery.module.css";

export interface GalleryProps {
  /** Ids already in the library. */
  inLibrary: ReadonlySet<string>;
  onAdopt: (entry: GalleryEntry) => Promise<void>;
  onClose: () => void;
  /** Default: the committed recordings. */
  load?: () => Promise<GalleryEntry[]>;
}

export function Gallery({ inLibrary, onAdopt, onClose, load = loadGallery }: GalleryProps) {
  const [entries, setEntries] = useState<GalleryEntry[] | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [errorFor, setErrorFor] = useState<string | undefined>(undefined);

  useEffect(() => {
    let live = true;
    load().then(
      (list) => live && setEntries(list),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [load]);

  const adopt = async (entry: GalleryEntry): Promise<void> => {
    setBusy(entry.id);
    setErrorFor(undefined);
    try {
      await onAdopt(entry);
    } catch {
      setErrorFor(entry.id);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <section className={styles.gallery} aria-labelledby="gallery-title">
      <header className={styles.head}>
        <h3 id="gallery-title" className={styles.title}>
          Replay gallery
        </h3>
        <span className={styles.stamp}>RECORDED</span>
        <button type="button" className={styles.close} onClick={onClose}>
          Close
        </button>
      </header>
      <p className={styles.note}>Characters forged ahead of time, all invented. Adopt one to dress it, voice it and put it on air.</p>
      {entries === undefined && !failed && <p className={styles.note}>Opening the recordings…</p>}
      {failed && <p className={styles.note}>The recordings could not be opened.</p>}
      {entries !== undefined && entries.length === 0 && <p className={styles.note}>No recorded characters are on this build.</p>}
      {entries !== undefined && entries.length > 0 && (
        <ul className={styles.list}>
          {entries.map((entry) => {
            const kept = inLibrary.has(entry.id);
            return (
              <li key={entry.id} className={styles.card}>
                {entry.portraitUrl !== undefined && <img className={styles.portrait} src={entry.portraitUrl} alt="" loading="lazy" />}
                <div className={styles.body}>
                  <h4 className={styles.name}>{entry.name}</h4>
                  <p className={styles.meta}>
                    {entry.origin} · {entry.layers} layers · fictional
                  </p>
                  {entry.prompt !== undefined && <p className={styles.prompt}>{entry.prompt}</p>}
                  <button
                    type="button"
                    className={styles.adopt}
                    disabled={kept || busy !== undefined}
                    aria-label={kept ? `${entry.name} is in your library` : `Adopt ${entry.name}`}
                    onClick={() => void adopt(entry)}
                  >
                    {kept ? "In your library" : busy === entry.id ? "Adopting…" : "Adopt"}
                  </button>
                  {errorFor === entry.id && <p className={styles.error}>Its images could not be read. Try again.</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
