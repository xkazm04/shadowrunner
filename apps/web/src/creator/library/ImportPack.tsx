// Import pack (spec .kiro/specs/avatar-pack, design "Creator"): one .srpack from the file picker or
// dropped on the Library joins it as a new character (a copy when its id is taken); a failed import
// says why and changes nothing.
import { readPack } from "@sr/pack";
import { useRef, useState, type DragEvent } from "react";
import type { CharacterRecord } from "./libraryStore";
import { importError, recordOfPack } from "./packing";

export type ImportNotice = { kind: "done" | "failed"; text: string };

export interface PackImportOptions {
  /** Every id in the library (damaged ones too): an imported pack never replaces one. */
  takenIds: ReadonlySet<string>;
  onImport?: (record: CharacterRecord) => Promise<void>;
}

export interface PackImport {
  enabled: boolean;
  busy: boolean;
  dragging: boolean;
  notice?: ImportNotice;
  importFiles(files: FileList | readonly File[] | null): Promise<void>;
  dropProps: {
    onDragEnter(event: DragEvent): void;
    onDragOver(event: DragEvent): void;
    onDragLeave(event: DragEvent): void;
    onDrop(event: DragEvent): void;
  };
}

const carriesFiles = (event: DragEvent): boolean => [...event.dataTransfer.types].includes("Files");

export function usePackImport({ takenIds, onImport }: PackImportOptions): PackImport {
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<ImportNotice | undefined>(undefined);
  // dragenter/dragleave fire for every child crossed; count them so the highlight does not flicker.
  const depth = useRef(0);
  const enabled = onImport !== undefined;

  const importFiles = async (files: FileList | readonly File[] | null): Promise<void> => {
    const list = files === null ? [] : [...files];
    if (onImport === undefined || list.length === 0) return;
    const file = list[0];
    if (list.length > 1 || file === undefined) {
      setNotice({ kind: "failed", text: "Drop one pack at a time." });
      return;
    }
    setBusy(true);
    try {
      const result = await readPack(file);
      if (!result.ok) {
        setNotice({ kind: "failed", text: importError(result.error) });
        return;
      }
      const record = recordOfPack(result.pack, takenIds);
      await onImport(record);
      setNotice({ kind: "done", text: `Imported ${record.rig.name}` });
    } catch {
      setNotice({ kind: "failed", text: "That pack could not be kept in the library." });
    } finally {
      setBusy(false);
    }
  };

  const dropProps: PackImport["dropProps"] = {
    onDragEnter: (event) => {
      if (!enabled || !carriesFiles(event)) return;
      event.preventDefault();
      depth.current += 1;
      setDragging(true);
    },
    onDragOver: (event) => {
      if (!enabled || !carriesFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: () => {
      if (!enabled) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    onDrop: (event) => {
      if (!enabled) return;
      event.preventDefault();
      depth.current = 0;
      setDragging(false);
      void importFiles(event.dataTransfer.files);
    },
  };

  return { enabled, busy, dragging, ...(notice === undefined ? {} : { notice }), importFiles, dropProps };
}

/** The header's "Import pack" button and its hidden file input. */
export function ImportButton({ pack, className, short }: { pack: PackImport; className: string | undefined; short: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className={className}
        aria-label="Import pack"
        aria-busy={pack.busy}
        disabled={pack.busy}
        data-import-pack=""
        onClick={() => input.current?.click()}
      >
        {pack.busy ? "Importing…" : short ? "Import" : "Import pack"}
      </button>
      <input
        ref={input}
        type="file"
        accept=".srpack,.zip"
        hidden
        tabIndex={-1}
        aria-hidden="true"
        data-import-input=""
        onChange={(event) => {
          const files = event.currentTarget.files;
          void pack.importFiles(files === null ? null : [...files]).finally(() => {
            if (input.current !== null) input.current.value = "";
          });
        }}
      />
    </>
  );
}
