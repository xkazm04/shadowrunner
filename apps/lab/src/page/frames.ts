// Frame timing for metrics: every frame's instantaneous fps, flushed once a second as frameStats.
// A frame that took longer than 1.5 vsyncs counts the vsyncs it missed as dropped.

const VSYNC_MS = 1000 / 60;

export interface FrameMeter {
  /** Call once per animation frame with its timestamp. */
  tick(now: number): void;
  /** The samples since the last flush. */
  flush(): { fps: number[]; dropped: number };
}

export function createFrameMeter(): FrameMeter {
  let last: number | undefined;
  let fps: number[] = [];
  let dropped = 0;
  return {
    tick(now) {
      if (last !== undefined) {
        const dt = now - last;
        if (dt > 0) fps.push(Math.round((1000 / dt) * 10) / 10);
        if (dt > VSYNC_MS * 1.5) dropped += Math.round(dt / VSYNC_MS) - 1;
      }
      last = now;
    },
    flush() {
      const out = { fps, dropped };
      fps = [];
      dropped = 0;
      return out;
    },
  };
}
