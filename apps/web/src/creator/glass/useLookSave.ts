// Keeping the look (perfection-pass task 7, requirement 7.4): written to the library SAVE_DELAY_MS
// after the last change, only when it differs from the stored one, and never dropped. Before this
// the timer was cleared on unmount, so an edit made inside the delay was lost on a character
// switch (the editor is keyed by the character) or when the page closed.
// - The pending look is written at once on unmount and on `pagehide`; `flush()` lets a caller
//   (Duplicate) write it before reading the record back. The write is started synchronously, so an
//   IndexedDB transaction opened after it (the duplicate's) sees it.
// - The voice is written when chosen (no delay), so there is no voice save to flush.
// - The library's saveLook is read through a ref: its identity changes on every library render,
//   which used to restart the timer.
import type { Look } from "@sr/rig";
import { useCallback, useEffect, useRef } from "react";

/** How long after the last change a look is written to the library. */
export const SAVE_DELAY_MS = 400;

/** `look` as first given is taken to be the stored one (the editor opens on the record's look). */
export function useLookSave(id: string, look: Look, saveLook: (id: string, look: Look) => Promise<void>): () => Promise<void> {
  const kept = useRef<Look>(look);
  const pending = useRef<Look | undefined>(undefined);
  const save = useRef(saveLook);
  useEffect(() => {
    save.current = saveLook;
  });

  const flush = useCallback((): Promise<void> => {
    const look = pending.current;
    if (look === undefined) return Promise.resolve();
    pending.current = undefined;
    kept.current = look;
    return save.current(id, look);
  }, [id]);

  useEffect(() => {
    if (look === kept.current) {
      pending.current = undefined;
      return undefined;
    }
    pending.current = look;
    const timer = setTimeout(() => void flush(), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [look, flush]);

  useEffect(() => {
    const onHide = (): void => void flush();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      void flush();
    };
  }, [flush]);

  return flush;
}
