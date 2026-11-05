// Image work for the mouth generator, through the system ffmpeg (on PATH; no image dependency is
// added to the workspace): compose the rest crop from the rig's face layers, flatten it for the
// image model, fit the model's answer back onto the crop, and draw the deterministic placeholder
// shapes. The generator takes these as an interface so its tests never run ffmpeg.
import { spawn } from "node:child_process";
import type { MouthParams } from "../page/lip/mouth/shapes.js";

export interface PlacedLayer {
  /** Image file on disk. */
  path: string;
  /** Where it sits inside the crop, px (may be negative), and its size. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The mouth inside the crop square, px: centre, rest width, largest opening. */
export interface CropMouth {
  cx: number;
  cy: number;
  width: number;
  maxOpen: number;
}

export interface ImageOps {
  /** The face layers at rest, cropped to a `side` square with transparency, as PNG at `out`. */
  composeRest(layers: readonly PlacedLayer[], side: number, out: string): Promise<void>;
  /** `restPath` flattened on black and scaled to `size` square: PNG bytes for the model. */
  flatten(restPath: string, size: number): Promise<Uint8Array>;
  /** The model's image scaled back to the `side` square, PNG at `out`. */
  fit(image: Uint8Array, side: number, out: string): Promise<void>;
  /** `restPath` with a flat stand-in mouth for `params` drawn on it, PNG at `out`. */
  placeholder(restPath: string, mouth: CropMouth, params: MouthParams, out: string): Promise<void>;
}

const FFMPEG = process.env.SR_FFMPEG ?? "ffmpeg";

function ffmpeg(args: readonly string[], input?: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (b: Buffer) => out.push(b));
    child.stderr.on("data", (b: Buffer) => err.push(b));
    child.on("error", (e) => reject(new Error(`ffmpeg could not start (${e.message}); L2's mouth generator needs ffmpeg on PATH.`)));
    child.on("close", (code) => {
      if (code === 0) resolve(new Uint8Array(Buffer.concat(out)));
      else reject(new Error(`ffmpeg failed (exit ${code}): ${Buffer.concat(err).toString().trim().split("\n").slice(-2).join(" ")}`));
    });
    if (input !== undefined) child.stdin.end(Buffer.from(input));
    else child.stdin.end();
  });
}

const r = (n: number): string => String(Math.round(n));

/** An ffmpeg expression: 1 inside the ellipse about (cx, cy) with radii rx, ry. */
const inside = (cx: number, cy: number, rx: number, ry: number): string =>
  `lte(pow((X-${cx.toFixed(2)})/${Math.max(0.5, rx).toFixed(2)},2)+pow((Y-${cy.toFixed(2)})/${Math.max(0.5, ry).toFixed(2)},2),1)`;

export const ffmpegImages: ImageOps = {
  async composeRest(layers, side, out) {
    const args = ["-f", "lavfi", "-i", `color=c=black@0.0:s=${side}x${side},format=rgba`];
    for (const l of layers) args.push("-i", l.path);
    const chain: string[] = [];
    let last = "0:v";
    layers.forEach((l, i) => {
      chain.push(`[${i + 1}:v]format=rgba,scale=${r(l.w)}:${r(l.h)}[l${i}]`);
      chain.push(`[${last}][l${i}]overlay=x=${r(l.x)}:y=${r(l.y)}:format=auto[c${i}]`);
      last = `c${i}`;
    });
    args.push("-filter_complex", chain.length === 0 ? "[0:v]null[out]" : `${chain.join(";")};[${last}]format=rgba[out]`, "-map", "[out]", "-frames:v", "1", out);
    await ffmpeg(args);
  },
  flatten(restPath, size) {
    return ffmpeg([
      "-f", "lavfi", "-i", "color=c=black:s=64x64",
      "-i", restPath,
      "-filter_complex", `[1:v]scale=${size}:${size}:flags=lanczos[f];[0:v]scale=${size}:${size}[b];[b][f]overlay=format=auto,format=rgb24[out]`,
      "-map", "[out]", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-",
    ]);
  },
  async fit(image, side, out) {
    await ffmpeg(["-f", "image2pipe", "-i", "-", "-vf", `scale=${side}:${side}:flags=lanczos,format=rgba`, "-frames:v", "1", out], image);
  },
  async placeholder(restPath, m, p, out) {
    // A flat, obviously synthetic mouth: lip ring, dark inside, a teeth band. Deterministic.
    const hw = (m.width / 2) * p.width;
    const open = Math.max(1.2, p.open * m.maxOpen);
    const cy = m.cy + open * 0.22;
    const ry = open / 2;
    const lip = m.width * 0.07;
    const inner = inside(m.cx, cy, hw, ry);
    const ring = inside(m.cx, cy, hw + lip * 0.6, ry + lip);
    const teethY = cy - ry + Math.min(open * 0.45, m.width * 0.09) * p.teeth;
    const channel = (c: "r" | "g" | "b", lipK: number) =>
      `if(${inner},if(lt(Y,${teethY.toFixed(2)}),210,22),if(${ring},${c}(X,Y)*${lipK},${c}(X,Y)))`;
    await ffmpeg(["-i", restPath, "-vf", `format=rgba,geq=r='${channel("r", 0.55)}':g='${channel("g", 0.5)}':b='${channel("b", 0.5)}':a='alpha(X,Y)'`, "-frames:v", "1", out]);
  },
};
