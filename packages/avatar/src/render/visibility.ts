// Whether an avatar can be seen (perfection-pass P1): the loops (AvatarCanvas, the player's own)
// stop stepping and drawing while it cannot, and resume on the next change.
//
// Decisions the spec leaves open:
// - Seen = the document is not hidden (`visibilitychange`) AND the element intersects the viewport
//   (IntersectionObserver, threshold 0, so "fully outside" pauses and one visible pixel runs). A
//   margin of OFFSCREEN_MARGIN_PX lets a face scrolled toward the viewport wake a frame early.
// - No IntersectionObserver (happy-dom, old engines) counts as in view; no document visibility
//   state counts as shown. Until the observer's first report the element counts as in view, so a
//   fresh mount draws its first frame at once.
// - `onChange` fires only when the combined answer flips.
/** Root margin of the viewport test, CSS px. */
export const OFFSCREEN_MARGIN_PX = 64;

export interface VisibilityWatch {
  /** The current answer. */
  visible(): boolean;
  dispose(): void;
}

/** Watches whether `element` can be seen; `onChange(visible)` on every flip. */
export function watchVisibility(element: Element, onChange: (visible: boolean) => void): VisibilityWatch {
  const doc = element.ownerDocument;
  const win = doc.defaultView;
  let shown = doc.visibilityState !== "hidden";
  let inView = true;
  let last = shown && inView;
  const update = (): void => {
    const now = shown && inView;
    if (now === last) return;
    last = now;
    onChange(now);
  };
  const onVisibility = (): void => {
    shown = doc.visibilityState !== "hidden";
    update();
  };
  doc.addEventListener("visibilitychange", onVisibility);
  const Observer = win?.IntersectionObserver;
  const observer =
    typeof Observer === "function"
      ? new Observer(
          (entries) => {
            const entry = entries[entries.length - 1];
            if (entry === undefined) return;
            inView = entry.isIntersecting;
            update();
          },
          { rootMargin: `${OFFSCREEN_MARGIN_PX}px` },
        )
      : undefined;
  observer?.observe(element);
  return {
    visible: () => last,
    dispose(): void {
      doc.removeEventListener("visibilitychange", onVisibility);
      observer?.disconnect();
    },
  };
}
