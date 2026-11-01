// Audio level tap (avatar-renderer req 4.1): routes a voice through an AnalyserNode and reads the
// RMS of the latest time-domain frame, clamped to [0, 1], for the driver's `inputs.level`.
//
// Decisions the spec leaves open:
// - An `AudioNode` source is tapped in its own context and only gains a connection to the
//   analyser; whoever owns the node keeps routing it to the speakers.
// - An `HTMLMediaElement` can be wrapped by `createMediaElementSource` only once per lifetime, and
//   from then on it is silent unless that node reaches a destination. So the wrapper is created
//   once per element (in `options.context`, or a new AudioContext), cached, and always connected to
//   the destination; `detach()` removes only the analyser connection, so the voice keeps playing.
// - The level is the plain RMS of samples in [-1, 1] (no gain): speech typically measures
//   0.05-0.3, and the driver's floor and jaw curve take it from there.
// - After `detach()`, `level()` returns 0.

/** Samples per analysed frame (about 43 ms at 48 kHz, about one jaw attack). */
export const LEVEL_FFT_SIZE = 2048;

export interface AudioLevelTap {
  /** RMS of the latest audio frame in [0, 1]; 0 once detached. */
  level(): number;
  /** Disconnects the analyser. Idempotent. */
  detach(): void;
}

export interface AttachAudioOptions {
  /**
   * Context for an `HTMLMediaElement` source; a new AudioContext when absent. An element already
   * attached once keeps its first context.
   */
  context?: AudioContext;
}

interface ElementRoute {
  context: BaseAudioContext;
  node: AudioNode;
}

/** One media-element wrapper per element, for the element's lifetime. */
const elementRoutes = new WeakMap<HTMLMediaElement, ElementRoute>();

function routeElement(element: HTMLMediaElement, context: AudioContext | undefined): ElementRoute {
  const known = elementRoutes.get(element);
  if (known !== undefined) return known;
  const ctx = context ?? new AudioContext();
  const node = ctx.createMediaElementSource(element);
  node.connect(ctx.destination);
  const route = { context: ctx, node };
  elementRoutes.set(element, route);
  return route;
}

const isAudioNode = (source: AudioNode | HTMLMediaElement): source is AudioNode => "connect" in source && "context" in source;

/** Root mean square of `samples`, clamped to [0, 1]; non-finite results are 0. */
export function rms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i] ?? 0;
    sum += v * v;
  }
  const value = Math.sqrt(sum / samples.length);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** Taps `source` with an AnalyserNode; read `level()` once per frame. */
export function attachAudio(source: AudioNode | HTMLMediaElement, options: AttachAudioOptions = {}): AudioLevelTap {
  const { context, node } = isAudioNode(source) ? { context: source.context, node: source } : routeElement(source, options.context);
  const analyser = context.createAnalyser();
  analyser.fftSize = LEVEL_FFT_SIZE;
  node.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  let attached = true;
  return {
    level(): number {
      if (!attached) return 0;
      analyser.getFloatTimeDomainData(samples);
      return rms(samples);
    },
    detach(): void {
      if (!attached) return;
      attached = false;
      node.disconnect(analyser);
    },
  };
}
