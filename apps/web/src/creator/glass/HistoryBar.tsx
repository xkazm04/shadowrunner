// The look's history under the glass (perfection-pass task 7): Undo, Redo and a press-and-hold
// Compare, beside Reset look. The keys (Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y) live in useLookHistory.
// - Compare shows the look as opened only while it is held: pointer down until up, cancel or a
//   lost capture; Space or Enter until released; focus leaving ends it too. It is a button with
//   aria-pressed, disabled while there is nothing to compare (the look is the one opened).
// - The "before" tag on the glass is BeforeTag; under reduced motion it appears without a fade, and
//   the glass swaps looks without a crossfade in every mode (the renderer draws one look).
import { memo, useEffect, type KeyboardEvent } from "react";
import styles from "./History.module.css";

export interface HistoryBarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** False while the look is the one opened. */
  canCompare: boolean;
  comparing: boolean;
  onCompare: (holding: boolean) => void;
}

const HOLD_KEYS = new Set([" ", "Enter"]);

/** Memoised (perfection-pass task 9): a drag past its first step leaves every prop as it was. */
export const HistoryBar = memo(function HistoryBar({ canUndo, canRedo, onUndo, onRedo, canCompare, comparing, onCompare }: HistoryBarProps) {
  // Nothing to compare any more (an undo back to the start) lets go.
  useEffect(() => {
    if (!canCompare && comparing) onCompare(false);
  }, [canCompare, comparing, onCompare]);

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
