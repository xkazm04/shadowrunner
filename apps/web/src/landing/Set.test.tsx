// The set (landing task 5.2): plate placement, the knob, and the glass it hosts.
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { channelPages, PAGES } from "../app/pages";
import { KNOB_ANGLE, nextChannel, plateBox, TvSet } from "./Set";
import { PLATE } from "./superellipse";
import { SET_PLATE } from "./World";

const DIAL = channelPages(PAGES);

describe("plateBox", () => {
  it("is the set's plate (SET_PLATE) as percentages of each world", () => {
    const sizes = { landscape: [1600, 900], portrait: [420, 910] } as const;
    for (const layout of ["landscape", "portrait"] as const) {
      const [w, h] = sizes[layout];
      const p = SET_PLATE[layout];
      const box = plateBox(layout);
      expect((box.x / 100) * w).toBeCloseTo(p.x, 6);
      expect((box.y / 100) * h).toBeCloseTo(p.y, 6);
      expect((box.width / 100) * w).toBeCloseTo(PLATE.width * p.scale, 6);
      expect((box.height / 100) * h).toBeCloseTo(PLATE.height * p.scale, 6);
    }
  });
});

describe("nextChannel", () => {
  it("turns the dial one channel on and wraps from the last to the first", () => {
    expect(nextChannel(2)?.channel).toBe(3);
    expect(nextChannel(6)?.channel).toBe(9);
    expect(nextChannel(9)?.channel).toBe(DIAL[0]?.channel);
  });

  it("has a knob angle for every channel on the dial", () => {
    for (const page of DIAL) expect(KNOB_ANGLE[page.channel ?? -1]).toBeTypeOf("number");
  });
});

describe("TvSet", () => {
  const html = renderToString(<TvSet daemon="online" plane="replay" />);

  it("stands the CRT plate with an accessible description, faded at the base", () => {
    expect(html).toContain("data-set");
    expect(html).toMatch(/<img[^>]*alt="A 1950s walnut television standing on the cellar floor \(stylised photo\)"/);
    expect(html).toContain("crt-frontal");
  });

  it("hosts the glass with Malakor live on it", () => {
    expect(html).toContain("data-glass");
    expect(html).toContain("LIVE · Arch-Lich Malakor");
    expect(html.replace(/<[^>]*>/g, "")).toContain("AI characters who stream · you are the only viewer");
  });

  it("has a channel knob that names the channel it turns to", () => {
    expect(html).toMatch(/<button[^>]*type="button"[^>]*aria-label="Channel knob: turn to channel 3, Forge"/);
    expect(html).toContain("--knob:-70deg");
  });

  it("carries the daemon's state for the cabinet's shade", () => {
    expect(renderToString(<TvSet daemon="dark" plane="replay" />)).toMatch(/data-set[^>]*data-daemon="dark"/);
  });
});
