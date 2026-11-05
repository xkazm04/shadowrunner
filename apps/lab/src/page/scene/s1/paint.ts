// S1's recorded half: paints a SceneFrame into the 1920x1080 composite. `back` (under the avatar)
// is the backlight; `front` (over it) is the darkness, the candles, the card, the poll and the
// caption. Colours and fonts are theme roles resolved once from the stage (palette.ts).
import type { CaptionStyle, SceneFrame } from "./model.js";
import type { Palette } from "./palette.js";

/** The part of a 2D context S1 paints with (the composite's context is one; so is a test mock). */
export type Canvas2D = Pick<
  CanvasRenderingContext2D,
  | "fillStyle"
  | "strokeStyle"
  | "globalAlpha"
  | "font"
  | "lineWidth"
  | "textAlign"
  | "textBaseline"
  | "fillRect"
  | "fillText"
  | "ellipse"
  | "roundRect"
  | "beginPath"
  | "fill"
  | "stroke"
  | "measureText"
  | "createRadialGradient"
> & { readonly canvas: { readonly width: number; readonly height: number } };
type G = Canvas2D;

/** Candle x positions as a fraction of the stage width (clear of the face, both sides). */
export const CANDLE_X = [0.06, 0.12, 0.18, 0.82, 0.88, 0.94] as const;
/** Sizes in stage pixels, matching the live view (theme scale x2, s1.module.css). */
const PAD = 32;
/** Caption band width: between the inner candles (58% of the stage, as the live view). */
const CAPTION_W = 1114;

export function paintBack(g: G, f: SceneFrame, p: Palette): void {
  const { width: w, height: h } = g.canvas;
  g.globalAlpha = 1;
  g.fillStyle = p.surface0;
  g.fillRect(0, 0, w, h);
  const glow = (colour: string, alpha: number): void => {
    if (alpha <= 0.002) return;
    const r = g.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.45, h * 0.65);
    r.addColorStop(0, colour);
    r.addColorStop(1, "transparent");
    g.globalAlpha = Math.min(1, alpha);
    g.fillStyle = r;
    g.fillRect(0, 0, w, h);
  };
  glow(p.ember, f.light.level * f.light.warmth);
  glow(p.cold, f.light.level * (1 - f.light.warmth));
  g.globalAlpha = 1;
}

export function paintFront(g: G, f: SceneFrame, p: Palette): void {
  const { width: w, height: h } = g.canvas;
  if (f.light.dark > 0.002) {
    g.globalAlpha = f.light.dark;
    g.fillStyle = p.surface0;
    g.fillRect(0, 0, w, h);
  }
  paintCandles(g, f.candles, p, w, h);
  if (f.card !== undefined) paintCard(g, f.card, p);
  if (f.poll !== undefined) paintPoll(g, f.poll, p, w);
  if (f.caption !== undefined) paintCaption(g, f.caption, p, w, h);
  g.globalAlpha = 1;
}

function paintCandles(g: G, c: SceneFrame["candles"], p: Palette, w: number, h: number): void {
  const base = h - 40;
  c.flames.forEach((size, i) => {
    const x = w * (CANDLE_X[i] ?? 0.5);
    const waxH = 70 + (i % 3) * 18;
    g.globalAlpha = 1;
    g.fillStyle = p.paper;
    g.fillRect(x - 13, base - waxH, 26, waxH);
    if (size <= 0.01) return;
    const top = base - waxH;
    if (c.glow > 0) {
      const halo = g.createRadialGradient(x, top - 20, 0, x, top - 20, 110 * Math.max(c.glow, size));
      halo.addColorStop(0, p.ember);
      halo.addColorStop(1, "transparent");
      g.globalAlpha = Math.min(0.55, 0.3 * c.glow + 0.1);
      g.fillStyle = halo;
      g.fillRect(x - 220, top - 240, 440, 440);
    }
    const fh = 44 * size;
    g.globalAlpha = 1;
    g.fillStyle = p.ember;
    g.beginPath();
    g.ellipse(x, top - fh * 0.5, 10 * Math.min(1.6, 0.6 + size * 0.5), fh * 0.5, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = p.flame;
    g.beginPath();
    g.ellipse(x, top - fh * 0.35, 5 * Math.min(1.6, 0.6 + size * 0.5), fh * 0.3, 0, 0, Math.PI * 2);
    g.fill();
  });
}

/** Word-wraps `text` to `max` pixels in the current font, at most `lines` lines (ellipsis after). */
export function wrap(g: G, text: string, max: number, lines: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line === "" ? word : `${line} ${word}`;
    if (g.measureText(next).width <= max || line === "") line = next;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line !== "") out.push(line);
  if (out.length <= lines) return out;
  const kept = out.slice(0, lines);
  kept[lines - 1] = `${kept[lines - 1] ?? ""}…`;
  return kept;
}

function panel(g: G, x: number, y: number, w: number, h: number, fill: string, line?: string): void {
  g.fillStyle = fill;
  g.beginPath();
  g.roundRect(x, y, w, h, 14);
  g.fill();
  if (line !== undefined) {
    g.strokeStyle = line;
    g.lineWidth = 3;
    g.stroke();
  }
}

function paintCard(g: G, c: NonNullable<SceneFrame["card"]>, p: Palette): void {
  const x = 96;
  const y = 120 + c.rise;
  const w = 620;
  g.font = `700 40px ${p.fontDisplay}`;
  const title = wrap(g, c.title, w - PAD * 2, 2);
  g.font = `32px ${p.fontBody}`;
  const body = c.body === undefined ? [] : wrap(g, c.body, w - PAD * 2, 5);
  const h = PAD * 2 + title.length * 50 + (body.length > 0 ? 14 + body.length * 42 : 0);
  g.globalAlpha = c.alpha * 0.96;
  panel(g, x, y, w, h, p.paper, p.inkSignal);
  g.globalAlpha = c.alpha;
  g.fillStyle = p.paperInk;
  g.textBaseline = "top";
  g.textAlign = "left";
  g.font = `700 40px ${p.fontDisplay}`;
  title.forEach((t, i) => g.fillText(t, x + PAD, y + PAD + i * 50));
  g.font = `32px ${p.fontBody}`;
  const top = y + PAD + title.length * 50 + 14;
  body.forEach((t, i) => g.fillText(t, x + PAD, top + i * 42));
}

function paintPoll(g: G, poll: NonNullable<SceneFrame["poll"]>, p: Palette, stageW: number): void {
  const w = 600;
  const x = stageW - 96 - w;
  const y = 120;
  g.font = `700 40px ${p.fontDisplay}`;
  const question = wrap(g, poll.question, w - PAD * 2, 3);
  const h = PAD * 2 + question.length * 48 + 16 + poll.options.length * 58 + (poll.closed ? 56 : 0);
  g.globalAlpha = poll.alpha * 0.92;
  panel(g, x, y, w, h, p.surface2, p.line);
  g.globalAlpha = poll.alpha;
  g.textBaseline = "top";
  g.textAlign = "left";
  g.fillStyle = p.textStrong;
  question.forEach((t, i) => g.fillText(t, x + PAD, y + PAD + i * 48));
  g.font = `32px ${p.fontBody}`;
  const top = y + PAD + question.length * 48 + 16;
  poll.options.forEach((o, i) => {
    g.globalAlpha = poll.alpha * (poll.closed ? 0.55 : 1);
    panel(g, x + PAD, top + i * 58, 44, 44, p.surface3, p.accent);
    g.fillStyle = p.accent;
    g.fillText(String(i + 1), x + PAD + 13, top + i * 58 + 6);
    g.fillStyle = p.text;
    g.fillText(o, x + PAD + 64, top + i * 58 + 6);
  });
  if (poll.closed) {
    g.globalAlpha = poll.alpha;
    g.font = `700 40px ${p.fontDisplay}`;
    g.fillStyle = p.onair;
    g.fillText("POLL CLOSED", x + PAD, top + poll.options.length * 58 + 8);
  }
}

/** Font, colour and band per caption style. */
export function captionLook(style: CaptionStyle, p: Palette): { font: string; colour: string; band: number; upper: boolean; size: number } {
  if (style === "whisper") return { font: `italic 32px ${p.fontBody}`, colour: p.textMuted, band: 0.4, upper: false, size: 32 };
  if (style === "shout") return { font: `800 80px ${p.fontDisplay}`, colour: p.onair, band: 0.82, upper: true, size: 80 };
  return { font: `40px ${p.fontBody}`, colour: p.textStrong, band: 0.7, upper: false, size: 40 };
}

function paintCaption(g: G, c: NonNullable<SceneFrame["caption"]>, p: Palette, w: number, h: number): void {
  const look = captionLook(c.style, p);
  g.font = look.font;
  const lines = wrap(g, look.upper ? c.text.toUpperCase() : c.text, CAPTION_W - PAD * 2, 3);
  const lineH = Math.round(look.size * 1.25);
  const bandH = lines.length * lineH + PAD;
  const y = h - 56 - bandH;
  g.globalAlpha = c.alpha * look.band;
  panel(g, (w - CAPTION_W) / 2 + c.shake, y, CAPTION_W, bandH, p.surface1);
  g.globalAlpha = c.alpha;
  g.fillStyle = look.colour;
  g.textAlign = "center";
  g.textBaseline = "top";
  lines.forEach((t, i) => g.fillText(t, w * 0.5 + c.shake, y + PAD / 2 + i * lineH));
  g.textAlign = "left";
}
