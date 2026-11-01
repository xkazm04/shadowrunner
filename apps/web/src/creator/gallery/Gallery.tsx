// The replay gallery (creator requirement 4): ready-made fictional characters a judge with no keys
// can adopt at once. Adopting copies the character into the library as a new record that can be
// customised. Reachable from the forge's quota state and from the library.
// Since creator task 9 it is a grid of portrait cards that fits the sheet (scrolling only as a
// fallback), each naming what the character shows off; one already in the library can be put on
// the stage from here.
import type { LayerKind } from "@sr/rig";
import { useEffect, useState } from "react";
import { loadGallery, type GalleryEntry } from "./entries";
import styles from "./Gallery.module.css";

export interface GalleryProps {
  /** Ids already in the library. */
  inLibrary: ReadonlySet<string>;
  onAdopt: (entry: GalleryEntry) => Promise<void>;
  /** Puts a character that is already in the library on the stage. */
  onShow?: (id: string) => void;
  onClose: () => void;
  /** Default: the committed recordings. */
  load?: () => Promise<GalleryEntry[]>;
}

const KIND_LABEL: Record<LayerKind, string> = {
  static: "backdrop",
  body: "body",
  head: "head",
  jaw: "jaw",
  eye: "eyes",
  accessory: "accessory",
  crown: "crown",
};

/** What a card says the character shows off: the notes' signature layer, else its rig's kinds. */
export function showsOffLine(entry: Pick<GalleryEntry, "showsOff" | "kinds">): string {
  return entry.showsOff ?? entry.kinds.map((k) => KIND_LABEL[k]).join(" · ");
}

export function Gallery({ inLibrary, onAdopt, onShow, onClose, load = loadGallery }: GalleryProps) {
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
    <section className={styles.gallery} aria-labelledby="gallery-title" data-gallery="">
      <header className={styles.head}>
        <h3 id="gallery-title" className={styles.title}>
          Replay gallery
        </h3>
        <span className={styles.stamp}>RECORDED</span>
        <button type="button" className={styles.close} onClick={onClose}>
          Close
        </button>
      </header>
      {entries === undefined && !failed && <p className={styles.note}>Opening the recordings…</p>}
      {failed && <p className={styles.note}>The recordings could not be opened.</p>}
      {entries !== undefined && entries.length === 0 && <p className={styles.note}>No recorded characters are on this build.</p>}
      {entries !== undefined && entries.length > 0 && (
        <ul className={styles.list}>
          {entries.map((entry) => {
            const kept = inLibrary.has(entry.id);
            const shows = showsOffLine(entry);
            const disabled = kept ? onShow === undefined : busy !== undefined;
            return (
              <li key={entry.id} className={styles.item}>
                <button
                  type="button"
                  className={styles.card}
                  data-kept={kept ? "" : undefined}
                  disabled={disabled}
                  aria-label={kept ? `${entry.name} is in your library${onShow === undefined ? "" : ". Put it on the stage"}` : `Adopt ${entry.name}`}
                  title={`${entry.name} · ${entry.origin} · ${entry.layers} layers`}
                  onClick={() => (kept ? onShow?.(entry.id) : void adopt(entry))}
                >
                  {entry.portraitUrl !== undefined && <img className={styles.portrait} src={entry.portraitUrl} alt="" loading="lazy" />}
                  <span className={kept ? `${styles.chip} ${styles.kept}` : styles.chip} aria-hidden="true">
                    {kept ? "In library" : busy === entry.id ? "Adopting…" : "+ Adopt"}
                  </span>
                  <span className={styles.caption}>
                    <span className={styles.name}>{entry.name}</span>
                  </span>
                </button>
                <p className={styles.shows}>
                  {entry.origin === "hand-rigged" && <span className={styles.origin}>Hand-rigged: </span>}
                  {shows}
                </p>
                {errorFor === entry.id && <p className={styles.error}>Its images could not be read. Try again.</p>}
              </li>
            );
          })}
        </ul>
      )}
      <p className={styles.note}>Forged ahead of time, all invented. Each one shows off a different part of the rig.</p>
    </section>
  );
}
