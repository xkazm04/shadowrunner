// CH 6, the root vault (costume task 5.1): the room painter. The plate is drawn once, graded, and
// relit every frame by a quarter-resolution light map multiplied over it: the swinging bulb (warm,
// following the swing) and the moon through the grate (always; alone once the daemon is lost).
// The carrier travels up the roots as dashes of light; with dead air, dark tendrils reach for the
// empty socket (DaemonVault.tendrilPath, a pure function of dead-air seconds). The painter also
// swings the bulb rig, draws its filament and throws the floor word's shadow, all through refs and
// CSS variables, so React never renders per frame. Reduced motion: no rAF; `paint()` on demand.
// Colours are the theme's roles, read from the section's computed style.
import type { Motion } from "../app/theme";
import { isLost, type DaemonState } from "../landing/daemon";
import {
  bulbAt,
  coverFit,
  filamentPath,
  foldLight,
  GRATE,
  MOON_POOL,
  parseColour,
  rootGrowth,
  ROOTS,
  swingDeg,
  TENDRILS,
  tendrilPath,
  toView,
  VAULT_PLATE,
  type Cover,
  type Point,
} from "./DaemonVault";

export interface RoomParts {
  section: HTMLElement;
  canvas: HTMLCanvasElement;
  pendulum: HTMLElement;
  filament: SVGPathElement;
  word: HTMLElement;
  /** The plate's URL (assets/plates/root-vault.webp). */
  plateSrc: string;
}

export interface RoomClock {
  state(): DaemonState;
  /** performance.now() when the current state was entered. */
  since(): number;
  /** Seconds of dead air, fractional (0 while online). */
  dead(): number;
  motion(): Motion;
}

type Rgb = readonly [number, number, number];
const FALLBACK: Rgb = [128, 128, 128];
const rgba = ([r, g, b]: Rgb, a: number, k = 1) =>
  `rgba(${Math.round(Math.min(255, r * k))},${Math.round(Math.min(255, g * k))},${Math.round(Math.min(255, b * k))},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function startRoom(parts: RoomParts, clock: RoomClock): { paint(): void; stop(): void } {
  const { section, canvas, pendulum, filament, word, plateSrc } = parts;
  const plate = new Image();
  const cx = canvas.getContext("2d");
  const graded = document.createElement("canvas");
  const gx = graded.getContext("2d");
  const light = document.createElement("canvas");
  const lx = light.getContext("2d");
  if (!cx || !gx || !lx) return { paint: () => undefined, stop: () => undefined };

  let VW = 0;
  let VH = 0;
  let cover: Cover = coverFit(1, 1);
  let rigScale = 1;
  let grate: Point = [0, 0];
  let ready = false;
  let bulb: Rgb = FALLBACK;
  let moon: Rgb = FALLBACK;
  let ink: Rgb = FALLBACK;
  let shade: Rgb = [0, 0, 0];
  let amp = 1;
  let lum = 1;
  let grow = 0;
  let raf = 0;
  let frames = 0;

  function readColours() {
    const css = getComputedStyle(section);
    bulb = parseColour(css.getPropertyValue("--sr-ember")) ?? FALLBACK;
    moon = parseColour(css.getPropertyValue("--sr-phosphor-spill")) ?? FALLBACK;
    ink = parseColour(css.getPropertyValue("--sr-text-strong")) ?? FALLBACK;
    shade = parseColour(css.getPropertyValue("--sr-surface-0")) ?? [0, 0, 0];
  }

  function layout() {
    VW = window.innerWidth;
    VH = window.innerHeight;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    canvas.width = Math.round(VW * dpr);
    canvas.height = Math.round(VH * dpr);
    cx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    cover = coverFit(VW, VH);
    rigScale = Math.max(0.72, Math.min(1, VH / 960));
    grate = toView(cover, GRATE);
    const bulbBottom = grate[1] + 226 * rigScale;
    section.style.setProperty("--vault-gx", `${grate[0].toFixed(1)}px`);
    section.style.setProperty("--vault-gy", `${grate[1].toFixed(1)}px`);
    section.style.setProperty("--vault-rs", rigScale.toFixed(3));
    section.style.setProperty("--vault-stop", `${(bulbBottom + 14).toFixed(1)}px`);
    section.style.setProperty("--vault-ctop", `${Math.max(bulbBottom + 84, VH * 0.42).toFixed(1)}px`);
    light.width = Math.ceil(VW / 4);
    light.height = Math.ceil(VH / 4);
    readColours();
    if (plate.complete && plate.naturalWidth > 0 && gx) {
      graded.width = VW;
      graded.height = VH;
      gx.filter = "brightness(1.55) contrast(1.08) saturate(.62) sepia(.12)";
      gx.drawImage(plate, cover.ox, cover.oy, VAULT_PLATE.width * cover.scale, VAULT_PLATE.height * cover.scale);
      gx.filter = "none";
      ready = true;
    }
  }

  function trace(ctx: CanvasRenderingContext2D, pts: readonly Point[]) {
    ctx.beginPath();
    pts.forEach((p, i) => {
      const [x, y] = toView(cover, p);
      const prev = pts[i - 1];
      if (prev === undefined) ctx.moveTo(x, y);
      else {
        const [px, py] = toView(cover, prev);
        ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
      }
    });
    const last = pts[pts.length - 1];
    if (last) ctx.lineTo(...toView(cover, last));
  }

  function lightMap(bx: number, by: number, lost: boolean) {
    if (!lx) return;
    const w = light.width;
    const h = light.height;
    const q = 0.25;
    const S = cover.scale;
    lx.globalCompositeOperation = "source-over";
    lx.fillStyle = rgba(mix(moon, bulb, lum), 1, 0.05 + 0.1 * lum);
    lx.fillRect(0, 0, w, h);
    lx.globalCompositeOperation = "lighter";
    if (lum > 0.01) {
      const g = lx.createRadialGradient(bx * q, by * q, 0, bx * q, by * q, VH * 0.95 * q);
      g.addColorStop(0, rgba(mix(bulb, [255, 255, 255], 0.6), lum));
      g.addColorStop(0.28, rgba(bulb, 0.85 * lum, 0.92));
      g.addColorStop(0.6, rgba(bulb, 0.55 * lum, 0.47));
      g.addColorStop(1, rgba(bulb, 0, 0));
      lx.fillStyle = g;
      lx.fillRect(0, 0, w, h);
    }
    const [mx, my] = grate;
    const [fx, fy] = toView(cover, MOON_POOL);
    const m = lost ? 1 : 0.45;
    const g2 = lx.createRadialGradient(mx * q, my * q, 0, mx * q, my * q, 170 * S * q);
    g2.addColorStop(0, rgba(moon, 0.75 * m, 0.9));
    g2.addColorStop(1, rgba(moon, 0, 0));
    lx.fillStyle = g2;
    lx.fillRect(0, 0, w, h);
    lx.save();
    lx.beginPath();
    lx.moveTo((mx - 70 * S) * q, my * q);
    lx.lineTo((mx + 70 * S) * q, my * q);
    lx.lineTo((fx + 260 * S) * q, fy * q);
    lx.lineTo((fx - 260 * S) * q, fy * q);
    lx.closePath();
    const g3 = lx.createLinearGradient(0, my * q, 0, fy * q);
    g3.addColorStop(0, rgba(moon, 0.7 * m, 0.78));
    g3.addColorStop(1, rgba(moon, 0.42 * m, 0.55));
    lx.fillStyle = g3;
    lx.filter = "blur(6px)";
    lx.fill();
    lx.restore();
    lx.filter = "none";
    const g4 = lx.createRadialGradient(fx * q, fy * q, 0, fx * q, fy * q, 300 * S * q);
    g4.addColorStop(0, rgba(moon, 0.45 * m, 0.6));
    g4.addColorStop(1, rgba(moon, 0, 0));
    lx.fillStyle = g4;
    lx.fillRect(0, 0, w, h);
  }

  function draw(t: number, bx: number, by: number, lost: boolean) {
    if (!cx) return;
    if (!ready) {
      cx.fillStyle = rgba(shade, 1);
      cx.fillRect(0, 0, VW, VH);
      return;
    }
    const S = cover.scale;
    lightMap(bx, by, lost);
    cx.globalCompositeOperation = "source-over";
    cx.drawImage(graded, 0, 0, VW, VH);
    cx.globalCompositeOperation = "multiply";
    cx.drawImage(light, 0, 0, VW, VH);
    cx.globalCompositeOperation = "lighter";
    if (lum > 0.01) {
      const b = cx.createRadialGradient(bx, by, 0, bx, by, VH * 0.5);
      b.addColorStop(0, rgba(bulb, 0.16 * lum));
      b.addColorStop(1, rgba(bulb, 0, 0));
      cx.fillStyle = b;
      cx.fillRect(0, 0, VW, VH);
    }
    // The carrier, travelling up the roots (kept off the readings' corners).
    if (lum > 0.05) {
      cx.save();
      cx.beginPath();
      cx.rect(0, 0, VW, VH * 0.48);
      cx.rect(VW * 0.25, VH * 0.48, VW * 0.5, VH * 0.52);
      cx.clip();
      cx.lineCap = "round";
      ROOTS.forEach((root, i) => {
        trace(cx, root);
        cx.setLineDash([18 * S, 90 * S]);
        cx.lineDashOffset = (((t / 14 + i * 37) % 108) - 108) * S;
        cx.strokeStyle = rgba(bulb, 0.32 * lum, 1);
        cx.lineWidth = 9 * S;
        cx.shadowColor = rgba(bulb, 0.9);
        cx.shadowBlur = 22;
        cx.stroke();
        cx.setLineDash([10 * S, 98 * S]);
        cx.strokeStyle = rgba(mix(bulb, [255, 255, 255], 0.55), 0.45 * lum);
        cx.lineWidth = 2.2 * S;
        cx.shadowBlur = 8;
        cx.stroke();
      });
      cx.shadowBlur = 0;
      cx.setLineDash([]);
      cx.restore();
    }
    cx.globalCompositeOperation = "source-over";
    // Tendrils: moonlit, reaching for the empty socket with every second of dead air.
    if (grow > 0.001) {
      const socket: Point = [bx, by - 20 * rigScale];
      const still = clock.motion() === "reduced";
      TENDRILS.forEach((tendril, i) => {
        const pts = tendrilPath(tendril, i, grow, cover, socket, rigScale, 24, (u) => (still ? 0 : Math.sin(t / 1100 + i + u * 5) * 2));
        cx.lineCap = "round";
        cx.lineJoin = "round";
        for (let pass = 0; pass < 2; pass++) {
          for (let c = 0; c < 8; c++) {
            const f = 1 - c / 8;
            const from = c * 3;
            const to = Math.min(pts.length - 1, from + 4);
            if (from >= pts.length - 1) break;
            const o = pass ? (1 + 3 * f) * S : 0;
            cx.beginPath();
            const first = pts[from];
            if (!first) break;
            cx.moveTo(first[0] - o, first[1] - o * 0.6);
            for (let k = from + 1; k <= to; k++) {
              const p = pts[k];
              if (p) cx.lineTo(p[0] - o, p[1] - o * 0.6);
            }
            if (pass === 0) {
              cx.strokeStyle = rgba(shade, 0.97);
              cx.lineWidth = (3 + 11 * f) * S;
            } else {
              cx.strokeStyle = rgba(mix(moon, ink, 0.4), 0.14 + 0.3 * f);
              cx.lineWidth = (0.7 + 1.6 * f) * S;
            }
            cx.stroke();
          }
        }
      });
    }
  }

  function frame(t: number) {
    const state = clock.state();
    const motion = clock.motion();
    const reduced = motion === "reduced";
    const lost = isLost(state);
    amp += ((lost ? 0 : 1) - amp) * (reduced ? 1 : 0.05);
    if (state === "folding" && !reduced) lum = foldLight((performance.now() - clock.since()) / 1000);
    else if (state === "relighting" && !reduced) {
      lum += (1 - lum) * 0.08;
      if (Math.random() < 0.04) lum = 0.3;
    } else lum += ((lost ? 0 : 1) - lum) * (reduced ? 1 : 0.2);
    grow = lost ? rootGrowth(clock.dead()) : reduced ? 0 : grow * 0.92;
    const deg = swingDeg(t, amp, motion);
    pendulum.style.setProperty("--vault-swing", `${deg.toFixed(3)}deg`);
    const [bx, by] = bulbAt(grate, deg, rigScale);
    filament.setAttribute("d", filamentPath(reduced ? 0 : t, amp, lost, reduced ? () => 0 : () => Math.random() - 0.5));
    draw(t, bx, by, lost);
    // The floor word's shadow, thrown toward us and away from the bulb.
    if (!lost) {
      const r = word.getBoundingClientRect();
      const dx = Math.max(-1, Math.min(1, (r.left + r.width / 2 - bx) / (VW * 0.5)));
      word.style.filter = `drop-shadow(${(dx * 14).toFixed(1)}px 22px 14px color-mix(in srgb, var(--sr-surface-0) 85%, transparent))`;
    } else word.style.removeProperty("filter");
  }

  function loop(t: number) {
    if (frames++ % 60 === 0) readColours();
    frame(t);
    raf = clock.motion() === "reduced" ? 0 : window.requestAnimationFrame(loop);
  }

  const onResize = () => {
    layout();
    if (raf === 0) frame(0);
  };
  const onLoad = () => onResize();
  window.addEventListener("resize", onResize);
  plate.addEventListener("load", onLoad);
  plate.src = plateSrc;
  layout();
  if (clock.motion() === "reduced") frame(0);
  else raf = window.requestAnimationFrame(loop);

  return {
    paint() {
      if (raf === 0) {
        readColours();
        if (clock.motion() === "reduced") frame(0);
        else raf = window.requestAnimationFrame(loop);
      }
    },
    stop() {
      window.cancelAnimationFrame(raf);
      raf = 0;
      window.removeEventListener("resize", onResize);
      plate.removeEventListener("load", onLoad);
    },
  };
}
