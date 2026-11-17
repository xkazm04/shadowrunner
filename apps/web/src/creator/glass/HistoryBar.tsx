// The look's history under the glass (perfection-pass task 7): Undo, Redo and a press-and-hold
// Compare, beside Reset look. The keys (Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y) live in useLookHistory.
// - Compare shows the look as opened only while it is held: pointer down until up, cancel or a
//   lost capture; Space or Enter until released; focus leaving ends it too. It is a button with
//   aria-pressed, disabled while there is nothing to compare (the look is the one opened).
// - The "before" tag on the glass is BeforeTag; under reduced motion it appears without a fade, and
//   the glass swaps looks without a crossfade in every mode (the renderer draws one look).
// - rig/B (challenge-2026-11-17): "nothing to compare" is no change since opened (@sr/rig
//   lookChanges), so a value dragged back to its start counts as none. Beside Compare, "Changes (n)"
//   opens ChangeList: one row per change (what, as opened -> now) with its own Revert, one undoable
//   step. The bar gets only the count, so a drag past its first step still leaves it as it was.
import type { LookChange, LookValue } from "@sr/rig";
import { memo, useEffect, type KeyboardEvent } from "react";
import styles from "./History.module.css";

export interface HistoryBarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** How many changes since the look was opened (0: nothing to compare). */
  changes: number;
  comparing: boolean;
  onCompare: (holding: boolean) => void;
  /** Whether the change list is open. */
  listing: boolean;
  onListing: (open: boolean) => void;
}

/** The id of the change list, for the toggle's aria-controls. */
export const CHANGE_LIST_ID = "look-changes";

const HOLD_KEYS = new Set([" ", "Enter"]);

/** Memoised (perfection-pass task 9): a drag past its first step leaves every prop as it was. */
export const HistoryBar = memo(function HistoryBar({ canUndo, canRedo, onUndo, onRedo, changes, comparing, onCompare, listing, onListing }: HistoryBarProps) {
  const canCompare = changes > 0;
  // Nothing to compare any more (an undo or the last revert back to the start) lets go and closes the list.
  useEffect(() => {
    if (!canCompare && comparing) onCompare(false);
    if (!canCompare && listing) onListing(false);
  }, [canCompare, comparing, onCompare, listing, onListing]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!HOLD_KEYS.has(event.key)) return;
    event.preventDefault();
    if (!event.repeat) onCompare(true);
  };
  const onKeyUp = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!HOLD_KEYS.has(event.key)) return;
    event.preventDefault();
    onCompare(false);
  };
  const end = (): void => {
    if (comparing) onCompare(false);
  };

  return (
    <span className={styles.bar} role="group" aria-label="Look history">
      <button type="button" className={styles.step} disabled={!canUndo} onClick={onUndo} aria-label="Undo look change" aria-keyshortcuts="Control+Z" title="Undo (Ctrl+Z)">
        Undo
      </button>
      <button type="button" className={styles.step} disabled={!canRedo} onClick={onRedo} aria-label="Redo look change" aria-keyshortcuts="Control+Shift+Z Control+Y" title="Redo (Ctrl+Shift+Z)">
        Redo
      </button>
      <button
        type="button"
        className={styles.compare}
        disabled={!canCompare}
        aria-pressed={comparing}
        aria-label="Hold to compare with the look as opened"
        title="Hold to see the look as opened"
        data-compare=""
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // No capture (an old engine): pointerleave still lets go.
          }
          onCompare(true);
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
        onPointerLeave={end}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={end}
        onContextMenu={(event) => event.preventDefault()}
      >
        Compare
      </button>
      <button
        type="button"
        className={styles.step}
        disabled={!canCompare}
        aria-expanded={listing && canCompare}
        aria-controls={CHANGE_LIST_ID}
        title="What changed since the look was opened"
        data-changes=""
        onClick={() => onListing(!listing)}
      >
        Changes ({changes})
      </button>
    </span>
  );
});

/** On the glass while Compare is held. */
export function BeforeTag() {
  return (
    <span className={styles.before} role="status" data-compare-tag="">
      Before · as opened
    </span>
  );
}

/** A side of a change, in words: a colour as written, hidden or shown, a number, or as painted. */
function shown(change: LookChange, value: LookValue | undefined): string {
  if (typeof value === "boolean") return change.area === "hidden" ? (value ? "hidden" : "shown") : value ? "retired" : "painted";
  if (value === undefined) return change.area === "region" || change.area === "shape" ? "as painted" : "default";
  if (typeof value === "object") return `size ${value.size}, turn ${value.rot}°`;
  return String(value);
}

export interface ChangeListProps {
  changes: readonly LookChange[];
  onRevert: (change: LookChange) => void;
}

/** Every change since the look was opened, each with its own Revert. */
export const ChangeList = memo(function ChangeList({ changes, onRevert }: ChangeListProps) {
  return (
    <ul id={CHANGE_LIST_ID} className={styles.changes} aria-label="Changes since the look was opened">
      {changes.map((change) => (
        <li key={`${change.area}:${change.key}`} className={styles.change} data-change={`${change.area}:${change.key}`}>
          <span className={styles.what}>{change.label}</span>
          <span className={styles.delta}>
            {shown(change, change.before)} <span aria-hidden="true">→</span>
            <span className={styles.hide}> to </span> {shown(change, change.after)}
          </span>
          <button type="button" className={styles.step} aria-label={`Revert ${change.label}`} onClick={() => onRevert(change)}>
            Revert
          </button>
        </li>
      ))}
    </ul>
  );
});
