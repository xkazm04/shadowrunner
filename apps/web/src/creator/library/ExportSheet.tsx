// The Export sheet (spec .kiro/specs/avatar-pack, design "Creator"): author (remembered on this
// device) and licence, then the character downloads as `<name>.srpack` with its look and voice as
// saved. A dialog over the page: Escape or Cancel closes it and focus goes back where it was.
import { LICENCE_LABELS, PACK_LICENCES, packFileName, writePack, type PackLicence } from "@sr/pack";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { CharacterRecord } from "./libraryStore";
import { packInputOf } from "./packing";
import styles from "./ExportSheet.module.css";

export const AUTHOR_KEY = "sr-pack-author";
const AUTHOR_MAX = 60;

function readAuthor(): string {
  try {
    return window.localStorage.getItem(AUTHOR_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeAuthor(author: string): void {
  try {
    if (author === "") window.localStorage.removeItem(AUTHOR_KEY);
    else window.localStorage.setItem(AUTHOR_KEY, author);
  } catch {
    // A per-device convenience only.
  }
}

/** Hands the bytes to the browser as a download named `fileName`. */
export function downloadPack(bytes: Uint8Array, fileName: string): void {
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export interface ExportSheetProps {
  record: CharacterRecord;
  onClose: () => void;
  /** Test seam; default: `downloadPack`. */
  download?: (bytes: Uint8Array, fileName: string) => void;
}

export function ExportSheet({ record, onClose, download = downloadPack }: ExportSheetProps) {
  const [author, setAuthor] = useState(readAuthor);
  const [licence, setLicence] = useState<PackLicence>("all-rights-reserved");
  const [state, setState] = useState<"idle" | "writing" | "error">("idle");
  const first = useRef<HTMLInputElement>(null);
  const name = record.rig.name;

  useEffect(() => {
    // Focus returns to whatever opened the sheet (the card's Export key, the channel action).
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    first.current?.focus();
    return () => {
      if (opener?.isConnected === true) opener.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  const save = async (): Promise<void> => {
    const by = author.trim();
    writeAuthor(by);
    setState("writing");
    try {
      const bytes = await writePack(packInputOf(record, { licence, author: by }));
      download(bytes, packFileName(name));
      onClose();
    } catch {
      setState("error");
    }
  };

  return createPortal(
    <div className={styles.scrim} onKeyDown={onKeyDown} data-export-sheet="">
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={`Export ${name}`}>
        <h2 className={styles.title}>
          Export pack
        </h2>
        <p className={styles.lead}>
          <b>{name}</b> leaves as one <code>.srpack</code> file, with the look and voice as saved now.
        </p>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            if (state !== "writing") void save();
          }}
        >
          <label className={styles.field}>
            <span className={styles.label}>Author</span>
            <input
              ref={first}
              className={styles.input}
              type="text"
              name="author"
              value={author}
              maxLength={AUTHOR_MAX}
              autoComplete="name"
              placeholder="Your name (optional)"
              onChange={(event) => setAuthor(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Licence</span>
            <select
              className={styles.input}
              name="licence"
              value={licence}
              onChange={(event) => setLicence(event.target.value as PackLicence)}
            >
              {PACK_LICENCES.map((id) => (
                <option key={id} value={id}>
                  {LICENCE_LABELS[id]}
                </option>
              ))}
            </select>
          </label>
          {state === "error" && (
            <p className={styles.error} role="alert">
              The pack could not be written. Try again.
            </p>
          )}
          <div className={styles.buttons}>
            <button type="submit" className={styles.primary} disabled={state === "writing"} aria-busy={state === "writing"}>
              {state === "writing" ? "Packing..." : state === "error" ? "Try again" : "Download"}
            </button>
            <button type="button" className={styles.secondary} onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
