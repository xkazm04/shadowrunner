// Dust drifting through the tube's light (landing requirement 4.5), the reference's 46 motes on a
// half-resolution canvas over the room. Motes show only near the glass and only while the set
// has a picture: `active()` is read every frame and the dust fades with it (the daemon's fold).
// Drawn in the theme's `phosphor-spill`, read from the canvas's computed style. Motion only.

export interface Mote {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  ph: number;
}

export const MOTES = 46;

/** The glass centre as a share of the world (World.tsx SET_PLATE, plate centre 597 x 427). */
export const DUST_CENTRE = { landscape: { x: 0.4986, y: 0.4316 }, portrait: { x: 0.4986, y: 0.2992 } } as const;

/** Canvas pixels per world px (the reference's 0.5). */
const RESOLUTION = 0.5;
const WORLD = { landscape: { width: 1600, height: 900 }, portrait: { width: 420, height: 910 } } as const;

export function makeMotes(random: () => number = Math.random, count = MOTES): Mote[] {
  return Array.from({ length: count }, () => ({
    x: random(),
    y: random(),
    z: 0.3 + random() * 0.7,
    vx: (random() - 0.5) * 0.004,
    vy: -0.002 - random() * 0.004,
    ph: random() * 6,
  }));
}

/** Pure: a mote's alpha, brightest at the glass and gone 0.47 of the world away from it. */
export function moteAlpha(mote: Pick<Mote, "x" | "y" | "z">, centre: { x: number; y: number }, level: number): number {
  const d = Math.hypot((mote.x - centre.x) * 1.2, mote.y - centre.y);
  return Math.max(0, 0.75 - d * 1.6) * mote.z * Math.max(0, Math.min(1, level));
}

/** Pure: one step of drift over `dt` 60 Hz frames at time `t` (s), wrapping at the edges. */
export function drift(mote: Mote, t: number, dt: number, random: () => number = Math.random): void {
  mote.x += (mote.vx + Math.sin(t * 0.3 + mote.ph) * 0.002) * dt;
  mote.y += mote.vy * dt * 0.6;
  if (mote.y < -0.05) {
    mote.y = 1.05;
    mote.x = random();
  }
  if (mote.x < -0.05) mote.x = 1.05;
  if (mote.x > 1.05) mote.x = -0.05;
}

export interface DustOptions {
  canvas: HTMLCanvasElement;
  /** Whether the set has a picture now (the daemon is online or relighting). */
  active: () => boolean;
}

export function startDust({ canvas, active }: DustOptions): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => undefined;
  const motes = makeMotes();
  let colour = "";
  let level = 0;
  let last = 0;
  let frames = 0;
  let frame = 0;
  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    if (document.hidden) return;
    const dt = Math.min(6, last ? (now - last) / (1000 / 60) : 1);
    last = now;
    const layout = canvas.closest("[data-world]")?.getAttribute("data-world") === "portrait" ? "portrait" : "landscape";
    const width = Math.round(WORLD[layout].width * RESOLUTION);
    const height = Math.round(WORLD[layout].height * RESOLUTION);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    // The theme can change under us: re-read the colour about once a second.
    if (frames++ % 60 === 0) colour = getComputedStyle(canvas).getPropertyValue("--sr-phosphor-spill").trim();
    level += ((active() ? 1 : 0) - level) * Math.min(1, dt * 0.08);
    ctx.clearRect(0, 0, width, height);
    if (level < 0.01 || colour === "") return;
    ctx.fillStyle = colour;
    const centre = DUST_CENTRE[layout];
    const t = now / 1000;
    for (const mote of motes) {
      drift(mote, t, dt);
      const alpha = moteAlpha(mote, centre, level);
      if (alpha < 0.02) continue;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(mote.x * width, mote.y * height, ((0.6 + mote.z * 1.6) * width) / 700, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };
  frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };
}
