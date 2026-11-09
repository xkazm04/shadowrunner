// The cellar's lights move on the compositor (perfection-pass 11.2): the flicker is a Web
// Animations loop of the light layers' scale and opacity (fx/flicker.ts), so the CSS never reads
// `--flicker`; the torch's place (`--mx`, `--my`) reaches them only through translate, never
// through a gradient, whose every change re-rasterised the whole world. Reads Cellar.module.css
// as text (as landing/ChatStrip.test does).
import { describe, expect, it } from "vitest";

interface Fs {
  readFileSync(path: URL, encoding: "utf8"): string;
}
const NODE_FS = ["node", "fs"].join(":");
const fs: Fs = await import(/* @vite-ignore */ NODE_FS);
const css = fs.readFileSync(new URL("./Cellar.module.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every `property: value` declaration as [selector, property, value]. */
function declarations(text: string): [string, string, string][] {
  const out: [string, string, string][] = [];
  for (const rule of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (rule[1] ?? "").trim();
    for (const decl of (rule[2] ?? "").split(/;(?![^(]*\))/)) {
      const at = decl.indexOf(":");
      if (at > 0) out.push([selector, decl.slice(0, at).trim(), decl.slice(at + 1).trim()]);
    }
  }
  return out;
}

const LIVE = /var\(--(flicker|mx|my)\b/;
/** What the torch's place may drive: the layers' translate, the flame's own small box. */
const ALLOWED = new Set(["translate", "inset-block-start", "inset-inline-start"]);

describe("Cellar paint cost", () => {
  it("never reads the flicker, and moves the lights to the torch by translate only", () => {
    expect(css).not.toContain("--flicker");
    const live = declarations(css).filter(([, , value]) => LIVE.test(value));
    expect(live.length).toBeGreaterThan(0);
    for (const [selector, property] of live) expect({ selector, property, allowed: ALLOWED.has(property) }).toMatchObject({ allowed: true });
    // The flame's place is its own small box, never a gradient's centre.
    for (const [selector, property] of live.filter(([, p]) => p.startsWith("inset"))) expect({ selector, property }).toMatchObject({ selector: ".flame" });
  });

  it("paints every gradient once: none reads the flicker or the torch's place", () => {
    for (const [selector, property, value] of declarations(css)) {
      if (property === "background-image") expect({ selector, live: LIVE.test(value) }).toEqual({ selector, live: false });
    }
  });

  it("promotes exactly the layers it moves", () => {
    const promoted = declarations(css).filter(([, p]) => p === "will-change");
    expect(promoted.map(([s, , v]) => `${s}: ${v}`).sort()).toEqual([".dark,\n.torch: translate, scale", ".spillLight: opacity"]);
  });
});
