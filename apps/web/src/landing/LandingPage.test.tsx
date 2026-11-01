import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LandingPage } from "./LandingPage";
import { TRAY } from "./slides";

/** Index of `needle` in `html`, failing the test when it is missing. */
function at(html: string, needle: string): number {
  const i = html.indexOf(needle);
  expect(i, needle).toBeGreaterThan(-1);
  return i;
}

describe("LandingPage (static)", () => {
  it("lays the cellar, the throw, the face, the walls, the tray and the bar in the world, back to front", () => {
    const html = renderToString(<LandingPage />);
    const order = [
      'data-page="landing"',
      "data-world=",
      "data-cellar",
      "_proj_",
      "data-apparition",
      "data-pitch",
      "data-chat=",
      "_floor_",
      "data-legend",
      "data-status-bar",
      "data-lamp=",
    ].map((n) => at(html, n));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain('data-daemon="online"');
  });

  it("removes every gourd and pumpkin: no gourd row, no carved eye, no spiral, no pumpkin plates", () => {
    const html = renderToString(<LandingPage />).toLowerCase();
    for (const gone of ["gourd", "pumpkin", "root-eye", "root-pile", "cellar-wide", "spiral", "data-eye"]) {
      expect(html, gone).not.toContain(gone);
    }
  });

  it("hangs the lightbox ON AIR, and writes the channel over the pitch with the Forge's real key", () => {
    const html = renderToString(<LandingPage />);
    expect(html).toMatch(/data-lamp="on"[^>]*>ON AIR</);
    expect(html).toContain("CH 2 · On air · the cellar set");
    expect(html).toMatch(/<a[^>]*href="\/creator"[^>]*><kbd>3<\/kbd> Forge yours<\/a>/);
  });

  it("lays the status bar over the cellar with the shell's badge and controls", () => {
    const html = renderToString(
      <LandingPage badge={<p data-badge="recorded">RECORDED</p>} controls={<button type="button">Theme</button>} />,
    );
    const status = at(html, "data-status-bar");
    expect(status).toBeGreaterThan(at(html, "data-cellar"));
    expect(at(html, ">Theme</button>")).toBeGreaterThan(status);
    expect(at(html, ">RECORDED</p>")).toBeGreaterThan(status);
  });

  it("lays one slide per channel in the tray, as links, the page you are on marked, nothing projected yet", () => {
    const html = renderToString(<LandingPage />);
    const slides = [...html.matchAll(/<a[^>]*data-slide="([^"]+)"[^>]*>/g)];
    expect(slides.map((m) => m[1])).toEqual(TRAY.map((p) => p.id));
    for (const [tag] of slides) expect(tag).toMatch(/href="\//);
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*data-slide="landing"|<a[^>]*data-slide="landing"[^>]*aria-current="page"/);
    expect(html).not.toContain("data-projection=");
    expect(html).toContain('data-lantern="lit"');
    expect(html).not.toContain("data-hint");
  });

  it("chalks the chat on the wall, scripted on replay", () => {
    const html = renderToString(<LandingPage />);
    expect(html).toContain('aria-label="Live chat (simulated)"');
    expect(html).toContain("first time here. why is it 3am in here");
    expect(renderToString(<LandingPage plane="live" />)).toContain('aria-label="Live chat"');
  });
});
