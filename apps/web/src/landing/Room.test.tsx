import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Eye } from "./Eye";
import { Room } from "./Room";
import { Spiral, SpiralThrow, THROW_DOTS } from "./Spiral";

function scene(): string {
  return renderToString(
    <Room>
      <SpiralThrow />
      <div data-slot="set" />
      <Eye />
      <Spiral />
    </Room>,
  );
}

describe("Room (static)", () => {
  it("leads with the cellar plate as a described, high-priority image", () => {
    const html = scene();
    const img = html.match(/<img[^>]*>/)?.[0] ?? "";
    expect(html.indexOf("<img")).toBeLessThan(html.indexOf('data-slot="set"'));
    expect(img).toContain('fetchPriority="high"');
    expect(img).toMatch(/alt="A root cellar[^"]*\(stylised photo\)"/);
    expect(img).toMatch(/src="[^"]*cellar-wide[^"]*\.webp"/);
  });

  it("composites children between the back light and the front shade, in the reference order", () => {
    const html = scene();
    const at = (needle: string) => {
      const i = html.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    const order = [
      "cellar",
      "gourdGlow",
      "ceiling",
      "throw",
      'data-slot="set"',
      "_eye",
      "_spiral",
      "spill",
      "vignette",
      "floorShade",
      "edges",
    ].map(at);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("keeps every decorative layer out of the accessibility tree", () => {
    const html = scene();
    for (const layer of ["gourdGlow", "ceiling", "throw", "eye", "spiral", "spill", "vignette", "floorShade", "edges"]) {
      const tag = html.match(new RegExp(`<(div|svg) class="_${layer}_[^"]*"[^>]*>`))?.[0];
      expect(tag, layer).toContain('aria-hidden="true"');
    }
    // One image is announced (the cellar); nothing else carries a name.
    expect(html.match(/alt="/g)).toHaveLength(1);
    expect(html).not.toMatch(/aria-label=/);
  });

  it("throws 40 light dots and draws the pupil without animation", () => {
    const html = scene();
    expect(THROW_DOTS).toHaveLength(40);
    expect(html.match(/<ellipse/g)?.length).toBe(40 + 3);
    expect(html).not.toMatch(/<animate|animation/);
  });
});
