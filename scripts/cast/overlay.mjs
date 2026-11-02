// Draws named-part polygons over a portrait, each labelled with its name (cast-forge design.md
// "How a character is decomposed", step 2: check the polygons by eye). Also the review-sheet
// captions. Pure: Rgba in, Rgba out; a 5x7 bitmap font so no font or canvas library is needed.

/** 5x7 glyphs, rows top to bottom, '#' = ink. */
const GLYPHS = {
  a: [" ### ", "#   #", "#   #", "#####", "#   #", "#   #", "#   #"],
  b: ["#### ", "#   #", "#   #", "#### ", "#   #", "#   #", "#### "],
  c: [" ####", "#    ", "#    ", "#    ", "#    ", "#    ", " ####"],
  d: ["#### ", "#   #", "#   #", "#   #", "#   #", "#   #", "#### "],
  e: ["#####", "#    ", "#    ", "#### ", "#    ", "#    ", "#####"],
  f: ["#####", "#    ", "#    ", "#### ", "#    ", "#    ", "#    "],
  g: [" ####", "#    ", "#    ", "#  ##", "#   #", "#   #", " ### "],
  h: ["#   #", "#   #", "#   #", "#####", "#   #", "#   #", "#   #"],
  i: [" ### ", "  #  ", "  #  ", "  #  ", "  #  ", "  #  ", " ### "],
  j: ["  ###", "   # ", "   # ", "   # ", "   # ", "#  # ", " ##  "],
  k: ["#   #", "#  # ", "# #  ", "##   ", "# #  ", "#  # ", "#   #"],
  l: ["#    ", "#    ", "#    ", "#    ", "#    ", "#    ", "#####"],
  m: ["#   #", "## ##", "# # #", "# # #", "#   #", "#   #", "#   #"],
  n: ["#   #", "##  #", "# # #", "#  ##", "#   #", "#   #", "#   #"],
  o: [" ### ", "#   #", "#   #", "#   #", "#   #", "#   #", " ### "],
  p: ["#### ", "#   #", "#   #", "#### ", "#    ", "#    ", "#    "],
  q: [" ### ", "#   #", "#   #", "#   #", "# # #", "#  # ", " ## #"],
  r: ["#### ", "#   #", "#   #", "#### ", "# #  ", "#  # ", "#   #"],
  s: [" ####", "#    ", "#    ", " ### ", "    #", "    #", "#### "],
  t: ["#####", "  #  ", "  #  ", "  #  ", "  #  ", "  #  ", "  #  "],
  u: ["#   #", "#   #", "#   #", "#   #", "#   #", "#   #", " ### "],
  v: ["#   #", "#   #", "#   #", "#   #", "#   #", " # # ", "  #  "],
  w: ["#   #", "#   #", "#   #", "# # #", "# # #", "## ##", "#   #"],
  x: ["#   #", "#   #", " # # ", "  #  ", " # # ", "#   #", "#   #"],
  y: ["#   #", "#   #", " # # ", "  #  ", "  #  ", "  #  ", "  #  "],
  z: ["#####", "    #", "   # ", "  #  ", " #   ", "#    ", "#####"],
  0: [" ### ", "#   #", "#  ##", "# # #", "##  #", "#   #", " ### "],
  1: ["  #  ", " ##  ", "  #  ", "  #  ", "  #  ", "  #  ", " ### "],
  2: [" ### ", "#   #", "    #", "   # ", "  #  ", " #   ", "#####"],
  3: ["#### ", "    #", "    #", " ### ", "    #", "    #", "#### "],
  4: ["#   #", "#   #", "#   #", "#####", "    #", "    #", "    #"],
  5: ["#####", "#    ", "#    ", "#### ", "    #", "    #", "#### "],
  6: [" ### ", "#    ", "#    ", "#### ", "#   #", "#   #", " ### "],
  7: ["#####", "    #", "   # ", "  #  ", "  #  ", "  #  ", "  #  "],
  8: [" ### ", "#   #", "#   #", " ### ", "#   #", "#   #", " ### "],
  9: [" ### ", "#   #", "#   #", " ####", "    #", "    #", " ### "],
  _: ["     ", "     ", "     ", "     ", "     ", "     ", "#####"],
  ".": ["     ", "     ", "     ", "     ", "     ", "     ", "  #  "],
  "=": ["     ", "     ", "#####", "     ", "#####", "     ", "     "],
  "-": ["     ", "     ", "     ", "#####", "     ", "     ", "     "],
  " ": ["     ", "     ", "     ", "     ", "     ", "     ", "     "],
};

/** Distinct, bright label colours (a review aid; never shipped UI, so no theme tokens apply). */
export const COLOURS = [[255, 80, 80], [80, 220, 255], [255, 210, 60], [120, 255, 120], [255, 120, 255], [255, 160, 60], [160, 140, 255], [60, 255, 210]];

export const copy = (img) => ({ width: img.width, height: img.height, data: img.data.slice() });

function plot(img, x, y, [r, g, b], a = 1) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const at = (Math.floor(y) * img.width + Math.floor(x)) * 4;
  img.data[at] = img.data[at] * (1 - a) + r * a;
  img.data[at + 1] = img.data[at + 1] * (1 - a) + g * a;
  img.data[at + 2] = img.data[at + 2] * (1 - a) + b * a;
  img.data[at + 3] = 255;
}

export function line(img, [x0, y0], [x1, y1], colour, width = 2) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) + 1;
  for (let k = 0; k <= n; k++) {
    const x = x0 + ((x1 - x0) * k) / n;
    const y = y0 + ((y1 - y0) * k) / n;
    for (let dy = 0; dy < width; dy++) for (let dx = 0; dx < width; dx++) plot(img, x + dx - width / 2, y + dy - width / 2, colour);
  }
}

/** Text at (x, y) top-left, `scale` px per font pixel, on a dark plate for legibility. */
export function text(img, str, x, y, colour = [255, 255, 255], scale = 2) {
  const s = String(str).toLowerCase();
  const w = s.length * 6 * scale;
  for (let yy = -scale; yy < 8 * scale; yy++) for (let xx = -scale; xx < w; xx++) plot(img, x + xx, y + yy, [0, 0, 0], 0.7);
  [...s].forEach((ch, k) => {
    const glyph = GLYPHS[ch] ?? GLYPHS[" "];
    glyph.forEach((row, gy) => {
      [...row].forEach((cell, gx) => {
        if (cell !== "#") return;
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) plot(img, x + (k * 6 + gx) * scale + dx, y + gy * scale + dy, colour);
      });
    });
  });
}

/** Model polygon ([y, x] 0..1000) -> canvas [x, y]. */
const canvasOf = (poly, width, height) => poly.map(([y, x]) => [(x * width) / 1000, (y * height) / 1000]);

/** The portrait darkened a little, every part's polygon outlined in its colour, its name at its first point. */
export function partsOverlay(portrait, parts) {
  const out = copy(portrait);
  for (let i = 0; i < out.data.length; i += 4) for (let c = 0; c < 3; c++) out.data[i + c] *= 0.75;
  parts.forEach((part, k) => {
    const colour = COLOURS[k % COLOURS.length];
    const pts = canvasOf(part.poly, portrait.width, portrait.height);
    pts.forEach((p, i) => line(out, p, pts[(i + 1) % pts.length], colour));
    const top = pts.reduce((a, b) => (b[1] < a[1] ? b : a));
    text(out, `${part.name}`, Math.min(top[0] + 4, out.width - 6 * 2 * part.name.length - 4), Math.max(2, top[1] - 18 + (k % 2) * 10), colour);
  });
  return out;
}
