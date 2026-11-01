import fc from "fast-check";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { channelPages, PAGES } from "../app/pages";
import {
  cropBackground,
  GOURD_CROPS,
  Gourds,
  lightOf,
  PILE,
  SKIN,
  SKIN_RADIUS,
  type Crop,
  type GourdsProps,
} from "./Gourds";

const DIAL = channelPages(PAGES);

function row(over: Partial<GourdsProps> = {}): string {
  return renderToString(<Gourds current="landing" plane="replay" {...over} />);
}

/** Every <button ...> opening tag in the html. */
function buttons(html: string): string[] {
  return html.match(/<button[^>]*>/g) ?? [];
}

const crop: fc.Arbitrary<Crop> = fc
  .record({ r: fc.double({ min: 20, max: 200, noNaN: true }) })
  .chain(({ r }) =>
    fc.record({
      r: fc.constant(r),
      cx: fc.double({ min: r, max: PILE.width - r, noNaN: true }),
      cy: fc.double({ min: r, max: PILE.height - r, noNaN: true }),
    }),
  );

describe("cropBackground", () => {
  it("puts the crop's centre at the skin's centre and its radius at SKIN_RADIUS", () => {
    fc.assert(
      fc.property(crop, (c) => {
        const bg = cropBackground(c);
        // CSS: a background-position of p% offsets the image by p% of (box - image).
        const width = (bg.size / 100) * SKIN.width;
        const scale = width / PILE.width;
        const height = PILE.height * scale;
        const offsetX = (bg.x / 100) * (SKIN.width - width);
        const offsetY = (bg.y / 100) * (SKIN.height - height);
        expect((SKIN.width / 2 - offsetX) / scale).toBeCloseTo(c.cx, 6);
        expect((SKIN.height / 2 - offsetY) / scale).toBeCloseTo(c.cy, 6);
        expect(c.r * scale).toBeCloseTo(SKIN_RADIUS, 6);
      }),
    );
  });

  it("refuses a crop the skin cannot show", () => {
    expect(() => cropBackground({ cx: 10, cy: 10, r: 0 })).toThrow(RangeError);
    expect(() => cropBackground({ cx: 10, cy: 10, r: Number.NaN })).toThrow(RangeError);
    expect(() => cropBackground({ cx: 10, cy: 10, r: 10_000 })).toThrow(RangeError);
  });

  it("has a crop of root-pile for every channel on the dial, inside the photo", () => {
    for (const page of DIAL) {
      const c = GOURD_CROPS[page.channel ?? -1];
      expect(c, `channel ${page.channel}`).toBeDefined();
      if (!c) continue;
      expect(c.cx - c.r).toBeGreaterThanOrEqual(0);
      expect(c.cy - c.r).toBeGreaterThanOrEqual(0);
      expect(c.cx + c.r).toBeLessThanOrEqual(PILE.width);
      expect(c.cy + c.r).toBeLessThanOrEqual(PILE.height);
    }
  });
});

describe("lightOf", () => {
  it("burns exactly the current channel; every other gourd holds an ember", () => {
    fc.assert(
      fc.property(fc.constantFrom(...DIAL), fc.constantFrom(...PAGES.map((p) => p.id), undefined), (page, current) => {
        expect(lightOf(page, current)).toBe(page.id === current ? "burn" : "ember");
      }),
    );
  });
});

describe("Gourds", () => {
  it("renders the five channels as real buttons, ascending, named 'Channel n, Title'", () => {
    const tags = buttons(row());
    expect(tags).toHaveLength(DIAL.length);
    DIAL.forEach((page, i) => {
      const tag = tags[i] ?? "";
      expect(tag).toContain('type="button"');
      expect(tag).toContain(`aria-label="Channel ${page.channel}, ${page.title}"`);
      expect(tag).toContain(`data-channel="${page.channel}"`);
      // Focusable as buttons are: never disabled, never taken out of the tab order.
      expect(tag).not.toMatch(/disabled|tabindex/i);
    });
    expect(DIAL.map((p) => p.channel)).toEqual([2, 3, 4, 6, 9]);
  });

  it("writes each label and carved number from the manifest", () => {
    const html = row();
    for (const page of DIAL) {
      expect(html).toContain(`>${page.title}</span>`);
      expect(html).toMatch(new RegExp(`<text[^>]*>${page.channel}</text>`));
    }
    expect(html).toContain(">Forge</span>");
    expect(html).not.toContain("The Forge");
  });

  it("burns the current channel's gourd and marks it current; the light moves with the channel", () => {
    for (const current of DIAL) {
      const tags = buttons(row({ current: current.id }));
      DIAL.forEach((page, i) => {
        const tag = tags[i] ?? "";
        const on = page.id === current.id;
        expect(tag).toContain(`data-light="${on ? "burn" : "ember"}"`);
        expect(tag.includes('aria-current="page"')).toBe(on);
      });
    }
  });

  it("holds an ember on every gourd off the dial (the stage)", () => {
    for (const tag of buttons(row({ current: "air" }))) expect(tag).toContain('data-light="ember"');
  });

  it("shows the legend from the keymap: channel keys, the dial, Esc, and D only on replay", () => {
    const replay = row({ plane: "replay" });
    for (const page of DIAL) expect(replay).toContain(`<kbd>${page.hotkey}</kbd>`);
    for (const key of ["←", "→", "Esc", "D"]) expect(replay).toContain(`<kbd>${key}</kbd>`);
    expect(replay).toContain("Stylised photos · simulated chat");

    const live = row({ plane: "live" });
    expect(live).not.toContain("<kbd>D</kbd>");
    expect(live).toContain("<kbd>Esc</kbd>");
    expect(live).toContain("Stylised photos · live chat");
  });
});
