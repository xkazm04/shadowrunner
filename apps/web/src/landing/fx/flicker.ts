// Flame flicker (landing requirement 4.5): light on top of the photographs, never a drawn prop.
// Every `[data-flame]` under the root (the torch, the lantern's projection, the face's spill) gets
// its own phase of the reference's three-sine flicker. The daemon's states are untouched, so a
// light that is out stays out. Motion only: the chunk is never loaded otherwise.
// Paint cost (perfection-pass task 11): a flame whose light layers are marked `data-flicker` (the
// cellar: its dark and torch layers scale, its spill fades) flickers on the compositor, as a Web
// Animations loop of the same curve; writing `--flicker` into their gradients 30 times a second
// re-rasterised the whole world. Any other flame (the projection) still gets `--flicker` from a
// requestAnimationFrame loop, which stops while the document is hidden.

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
/** The compositor loop: this many seconds of the curve, sampled every FRAME_MS, then again. */
export const LOOP_MS = 30_000;
/** The flicker the CSS rests at without motion (Cellar.module.css paints its layers for it). */
export const REST_FLICKER = 0.83;
/** The spill's gradient is painted at the flicker's peak; its opacity takes it down from there. */
export const PEAK_FLICKER = 1.03;

/** What a `data-flicker` layer animates for a flicker value `f`. */
export const LAYER_VALUE = {
  /** The torch's radius, 20.625rem x (0.9 + 0.12 f), as a scale of the radius painted at rest. */
  scale: (f: number) => (0.9 + 0.12 * f) / (0.9 + 0.12 * REST_FLICKER),
  opacity: (f: number) => f / PEAK_FLICKER,
} as const;

type LayerKind = keyof typeof LAYER_VALUE;
const isKind = (v: string | undefined): v is LayerKind => v === "scale" || v === "opacity";

/** Pure: one compositor loop of the curve at `phase` for a layer kind, LOOP_MS long. */
export function flickerKeyframes(kind: LayerKind, phase: number): Keyframe[] {
  const steps = Math.round(LOOP_MS / FRAME_MS);
  const frames: Keyframe[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const f = flickerAt(((i % steps) * FRAME_MS) / 1000, phase);
    frames.push({ [kind]: LAYER_VALUE[kind](f).toFixed(4), offset: i / steps });
  }
  return frames;
}

export function startFlicker(root: HTMLElement): () => void {
  const flames = [
    ...(root.matches("[data-flame]") ? [root] : []),
    ...root.querySelectorAll<HTMLElement>("[data-flame]"),
  ];
  const animations: Animation[] = [];
  const looped: { el: HTMLElement; phase: number }[] = [];
  flames.forEach((el, i) => {
    const phase = i * 2.1 + 0.4;
    const layers = [...el.querySelectorAll<HTMLElement>("[data-flicker]")];
    if (layers.length === 0) {
      looped.push({ el, phase });
      return;
    }
    for (const layer of layers) {
      const kind = layer.dataset.flicker;
      if (isKind(kind) && typeof layer.animate === "function") {
        const animation = layer.animate(flickerKeyframes(kind, phase), { duration: LOOP_MS, iterations: Infinity });
        // cancel() rejects `finished` with an AbortError; stopping is expected, not an error.
        animation.finished.catch(() => undefined);
        animations.push(animation);
      }
    }
  });

  let frame = 0;
  let last = -Infinity;
  const tick = (now: number) => {
    frame = 0;
    // Hidden: the loop stops (perfection-pass 11.3); `wake` restarts it. The flicker is a function
    // of the clock, so it resumes where the candle would be, not where it stopped.
    if (document.hidden) return;
    frame = requestAnimationFrame(tick);
    if (now - last < FRAME_MS) return;
    last = now;
    const t = now / 1000;
    for (const { el, phase } of looped) el.style.setProperty("--flicker", flickerAt(t, phase).toFixed(3));
  };
  const wake = () => {
    if (looped.length > 0 && !document.hidden && frame === 0) frame = requestAnimationFrame(tick);
  };
  document.addEventListener("visibilitychange", wake);
  wake();
  return () => {
    document.removeEventListener("visibilitychange", wake);
    cancelAnimationFrame(frame);
    for (const a of animations) a.cancel();
    for (const { el } of looped) el.style.removeProperty("--flicker");
  };
}
