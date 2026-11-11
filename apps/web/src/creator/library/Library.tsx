// The library region (creator requirement 2): the characters kept on this computer, the active one
// marked, a confirm step before a delete (never offered for the seeded Malakor), damaged records
// listed but never rendered, the private-mode notice, and the way to the replay gallery.
// Since creator task 9 the whole cast lives here, so the strip is a grid of portrait tiles that
// shows every character at once (it wraps rather than scrolls).
// Avatar packs (spec avatar-pack): an Export key on every card but Malakor's, and "Import pack" in
// the header (or a pack dropped anywhere on the region).
import { useState, type ReactNode } from "react";
import { ExportSheet } from "./ExportSheet";
import { ImportButton, usePackImport } from "./ImportPack";
import type {
  CharacterRecord,
  LibraryEntry,
  RemoveResult,
} from "./libraryStore";
import { canExport } from "./packing";
import { thumbUrl } from "./thumbnail";
import styles from "./Library.module.css";

/** A gallery character not in the library yet: a tile in the strip that adopts it on a press. */
export interface LibraryOffer {
  id: string;
  name: string;
  portraitUrl?: string;
  /** "companion" (companion-lanes): a pack from /packs/ outside the cast (Iris, Bun); default a gallery character. */
  kind?: "gallery" | "companion";
  adopt(): Promise<void>;
}

export interface LibraryProps {
  entries: readonly LibraryEntry[];
  activeId?: string;
  persistent: boolean;
  status: "loading" | "ready" | "failed";
  onSelect: (id: string) => void;
  onRemove: (id: string) => Promise<RemoveResult>;
  onOpenGallery: () => void;
  /** Keeps an imported pack's record; without it there is no Import pack. */
  onImport?: (record: CharacterRecord) => Promise<void>;
  /** The strip's last slot (the Forge's "+ Forge new"). */
  extra?: ReactNode;
  /** Gallery characters not kept yet, after the kept ones (the cast-forge eight). */
  offers?: readonly LibraryOffer[];
  /** "reel" under the glass (default), or "bar": one row of small stills in the frame's bar. */
  variant?: "reel" | "bar";
}

/**
 * The record's stored still (perfection-pass task 9: made once by useLibrary, kept on the record),
 * or its initial until there is one. A still a little behind the look is shown until the new one
 * is made; a rename keeps the same Blob, so nothing is made or decoded again.
 */
function Thumb({ record }: { record: CharacterRecord }) {
  const url =
    record.thumb === undefined
      ? undefined
      : thumbUrl(record.id, record.thumb.blob);
  return url === undefined ? (
    <span className={styles.initial} aria-hidden="true">
      {record.rig.name.replace(/^(the|arch-lich)\s+/i, "").charAt(0)}
    </span>
  ) : (
    <img className={styles.thumb} src={url} alt="" />
  );
}

function OfferTile({ offer }: { offer: LibraryOffer }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const adopt = async (): Promise<void> => {
    setBusy(true);
    setFailed(false);
    try {
      await offer.adopt();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const name = offer.name.replace(/^the\s+/i, "");
  const companion = offer.kind === "companion";
  return (
    <li className={styles.item} data-offer={offer.id} data-offer-kind={companion ? "companion" : undefined}>
      <button
        type="button"
        className={`${styles.card} ${styles.offer}`}
        aria-busy={busy}
        aria-label={`${offer.name}: ${failed ? "could not be read, press to try again" : companion ? "add from the companion packs" : "adopt from the gallery"}`}
        title={companion ? `Companion · ${offer.name}` : offer.name}
        disabled={busy}
        onClick={() => void adopt()}
      >
        {offer.portraitUrl === undefined ? (
          <span className={styles.initial} aria-hidden="true">
            {name.charAt(0)}
          </span>
        ) : (
          <img
            className={styles.thumb}
            src={offer.portraitUrl}
            alt=""
            loading="lazy"
            decoding="async"
          />
        )}
        <span className={styles.name}>{name}</span>
        <span className={styles.plus} aria-hidden="true">
          {busy ? "…" : failed ? "!" : "+"}
        </span>
      </button>
    </li>
  );
}

export function Library({
  entries,
  activeId,
  persistent,
  status,
  onSelect,
  onRemove,
  onOpenGallery,
  onImport,
  extra,
  offers = [],
  variant = "reel",
}: LibraryProps) {
  const [confirming, setConfirming] = useState<string | undefined>(undefined);
  const [refused, setRefused] = useState<string | undefined>(undefined);
  const [exportId, setExportId] = useState<string | undefined>(undefined);
  const count = entries.filter((e) => e.kind === "ok").length;
  const takenIds = new Set(entries.map((e) => (e.kind === "ok" ? e.record.id : e.id)));
  const pack = usePackImport({ takenIds, ...(onImport === undefined ? {} : { onImport }) });
  const exporting = entries.find((e) => e.kind === "ok" && e.record.id === exportId);

  const remove = async (id: string): Promise<void> => {
    const result = await onRemove(id);
    setConfirming(undefined);
    setRefused(result === "refused" ? id : undefined);
  };

  return (
    <section
      className={`${styles.library} ${variant === "bar" ? styles.bar : ""}`}
      aria-labelledby="library-title"
      data-region="library"
      data-variant={variant}
      data-dropping={pack.dragging ? "" : undefined}
      {...pack.dropProps}
    >
      <header className={styles.head}>
        <h2 id="library-title" className={styles.title}>
          Characters{" "}
          <span className={styles.count}>
            {status === "loading" ? "…" : count}
          </span>
        </h2>
        {pack.enabled && (
          <ImportButton
            pack={pack}
            className={styles.galleryButton}
            short={variant === "bar"}
          />
        )}
        <button
          type="button"
          className={styles.galleryButton}
          onClick={onOpenGallery}
          aria-label="Replay gallery"
        >
          {variant === "bar" ? "Gallery" : "Replay gallery"}
        </button>
      </header>
      {!persistent && status !== "loading" && (
        <p className={styles.notice} role="status">
          This window keeps nothing: characters last until the tab closes.
        </p>
      )}
      {pack.notice !== undefined && (
        <p
          className={pack.notice.kind === "done" ? styles.done : styles.notice}
          role="status"
          data-import-notice={pack.notice.kind}
        >
          {pack.notice.text}
        </p>
      )}
      {status === "loading" && (
        <p className={styles.note}>Opening the library…</p>
      )}
      {status !== "loading" && count === 0 && (
        <p className={styles.note}>
          No characters yet. Forge one, or adopt one from the replay gallery.
        </p>
      )}
      <ul className={styles.list}>
        {entries.map((entry) => {
          if (entry.kind === "damaged") {
            return (
              <li
                key={`damaged-${entry.id}`}
                className={styles.damaged}
                data-damaged=""
              >
                <span className={styles.damagedText}>
                  <b>{entry.name ?? entry.id}</b> is damaged and cannot be shown
                  ({entry.reason}).
                </span>
                <button
                  type="button"
                  className={styles.small}
                  onClick={() => void remove(entry.id)}
                >
                  Remove
                </button>
              </li>
            );
          }
          const { record } = entry;
          const name = record.rig.name;
          return (
            <li
              key={record.id}
              className={styles.item}
              data-character={record.id}
            >
              <button
                type="button"
                className={styles.card}
                aria-pressed={record.id === activeId}
                aria-label={`${name}${record.id === activeId ? ", on the stage" : ""}`}
                title={name}
                onClick={() => onSelect(record.id)}
              >
                <Thumb record={record} />
                <span className={styles.name}>
                  {name.replace(/^the\s+/i, "")}
                </span>
              </button>
              {canExport(record) && confirming !== record.id && (
                <button
                  type="button"
                  className={`${styles.small} ${styles.export}`}
                  aria-label={`Export ${name}`}
                  title={`Export ${name}`}
                  data-export=""
                  onClick={() => setExportId(record.id)}
                >
                  ↓
                </button>
              )}
              {confirming === record.id ? (
                <span
                  className={styles.confirm}
                  role="group"
                  aria-label={`Delete ${name}?`}
                >
                  <button
                    type="button"
                    className={`${styles.small} ${styles.danger}`}
                    onClick={() => void remove(record.id)}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    className={styles.small}
                    onClick={() => setConfirming(undefined)}
                  >
                    Keep
                  </button>
                </span>
              ) : record.seeded === true ? (
                refused === record.id && (
                  <span className={styles.house}>
                    The house character stays.
                  </span>
                )
              ) : (
                <button
                  type="button"
                  className={`${styles.small} ${styles.remove}`}
                  aria-label={`Delete ${name}`}
                  title={`Delete ${name}`}
                  onClick={() => setConfirming(record.id)}
                >
                  ✕
                </button>
              )}
            </li>
          );
        })}
        {offers.map((offer) => (
          <OfferTile key={offer.id} offer={offer} />
        ))}
        {extra !== undefined && <li className={styles.item}>{extra}</li>}
      </ul>
      {exporting?.kind === "ok" && (
        <ExportSheet
          record={exporting.record}
          onClose={() => setExportId(undefined)}
        />
      )}
    </section>
  );
}
