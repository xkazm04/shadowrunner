// Flame flicker (landing requirement 4.5): light on top of the photographs, never a drawn prop.
// Every `[data-flame]` under the root (the torch, the lantern's projection, the face's spill) gets
// its own phase of the reference's three-sine flicker as `--flicker`, which the CSS multiplies into
// what it draws. The daemon's states are untouched, so a light that is out stays out. Motion only:
// the chunk is never loaded otherwise.

/** Pure: the reference's candle, about 0.82 on average, within [0.61, 1.03]. */
export function flickerAt(seconds: number, phase: number): number {
  return (
    0.82 +
    0.1 * Math.sin(seconds * 7.3 + phase) +
    0.06 * Math.sin(seconds * 12.9 + phase * 3) +
    0.05 * Math.sin(seconds * 2.1 + phase)
  );
}

/** About 30 updates a second is enough for a candle and halves the style work. */
const FRAME_MS = 33;

export function startFlicker(root: HTMLElement): () => void {
  const flames = [
    ...(root.matches("[data-flame]") ? [root] : []),
    ...root.querySelectorAll<HTMLElement>("[data-flame]"),
  ];
  let frame = 0;
  let last = -Infinity;
  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    if (document.hidden || now - last < FRAME_MS) return;
    last = now;
    const t = now / 1000;
    flames.forEach((el, i) => el.style.setProperty("--flicker", flickerAt(t, i * 2.1 + 0.4).toFixed(3)));
  };
  frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame);
    for (const el of flames) el.style.removeProperty("--flicker");
  };
}
