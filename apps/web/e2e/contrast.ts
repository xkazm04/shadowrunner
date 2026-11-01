// Contrast measured on the rendered page, not on tokens (landing tasks 5.2 and 11): text colours
// come from computed style, backgrounds from screenshots taken with the text hidden, so the
// glass's picture, grade and glare and the gourd's mottled skin are all in the measurement.
import type { Locator, Page } from "@playwright/test";

export type Rgb = readonly [number, number, number];

/** WCAG 2 relative luminance of an 8-bit sRGB colour. */
export function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2 contrast ratio of two luminances. */
export function ratio(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** A computed `rgb(r, g, b)` / `rgba(...)` colour as Rgb. */
export function parseRgb(css: string): Rgb {
  const m = /rgba?\((\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)/.exec(css);
  if (!m) throw new Error(`not an rgb() colour: ${css}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The pixels of a screenshot of `clip` (page px at device scale 1), decoded by the browser. */
export async function pixels(page: Page, clip: Box): Promise<Rgb[]> {
  const png = await page.screenshot({ clip, animations: "disabled", caret: "hide", scale: "css" });
  const flat = await page.evaluate(async (b64: string) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2D context to decode the screenshot");
    ctx.drawImage(img, 0, 0);
    return Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
  }, png.toString("base64"));
  const out: Rgb[] = [];
  for (let i = 0; i < flat.length; i += 4) out.push([flat[i] ?? 0, flat[i + 1] ?? 0, flat[i + 2] ?? 0]);
  return out;
}

/** The computed text colour of the first element matching `locator`. */
export async function textColour(locator: Locator): Promise<Rgb> {
  return parseRgb(await locator.first().evaluate((el) => getComputedStyle(el).color));
}

/** Runs `measure` with a style sheet applied, then removes it. */
export async function withStyle<T>(page: Page, css: string, measure: () => Promise<T>): Promise<T> {
  const handle = await page.addStyleTag({ content: css });
  try {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    return await measure();
  } finally {
    await handle.evaluate((el) => el.parentNode?.removeChild(el));
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }
}

/** The box of `locator`, shrunk by `inset` page px on every side. */
export async function boxOf(locator: Locator, inset = 0): Promise<Box> {
  const b = await locator.first().boundingBox();
  if (!b) throw new Error("element has no box");
  return { x: b.x + inset, y: b.y + inset, width: Math.max(1, b.width - 2 * inset), height: Math.max(1, b.height - 2 * inset) };
}

/** Worst case for light text on a band: the contrast against the band's brightest pixel. */
export function worstOnBackground(text: Rgb, background: readonly Rgb[]): number {
  const brightest = Math.max(...background.map(luminance));
  return ratio(luminance(text), brightest);
}

/**
 * A carved numeral against the cut behind it: the glyph's core pixels are those where the shot
 * with the numeral differs most from the shot without it. Returns the contrast of the median core
 * pixel against the brightest 10% of the cut behind the core (a conservative read of the cut).
 */
export function carvedContrast(lit: readonly Rgb[], cut: readonly Rgb[]): number {
  const diffs = lit.map((p, i) => Math.abs(luminance(p) - luminance(cut[i] ?? [0, 0, 0])));
  const top = Math.max(...diffs);
  if (top < 0.02) throw new Error("no numeral found: the two shots do not differ");
  const core = diffs.flatMap((d, i) => (d >= top * 0.6 ? [i] : []));
  const fg = core.map((i) => luminance(lit[i] ?? [0, 0, 0])).sort((a, b) => a - b);
  const bg = core.map((i) => luminance(cut[i] ?? [0, 0, 0])).sort((a, b) => a - b);
  const median = fg[Math.floor(fg.length / 2)] ?? 0;
  const brightCut = bg[Math.min(bg.length - 1, Math.floor(bg.length * 0.9))] ?? 0;
  return ratio(median, brightCut);
}
