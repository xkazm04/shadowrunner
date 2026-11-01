import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LandingPage } from "./LandingPage";

describe("LandingPage (static)", () => {
  it("puts the room inside the world, with the throw, the eye and the spiral in reference order", () => {
    const html = renderToString(<LandingPage />);
    const at = (needle: string) => {
      const i = html.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    const order = ['data-page="landing"', "data-world=", "data-room", "_throw", "_eye", "_spiral", "_vignette"].map(at);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("lays the status bar over the room, inside the world, on channel 2 with the daemon online", () => {
    const html = renderToString(
      <LandingPage badge={<p data-badge="recorded">RECORDED</p>} controls={<button type="button">Theme</button>} />,
    );
    const world = html.indexOf("data-world=");
    const room = html.indexOf("data-room");
    const status = html.indexOf("data-status-bar");
    expect(world).toBeGreaterThan(-1);
    expect(status).toBeGreaterThan(room);
    expect(html).toContain('data-daemon="online"');
    expect(html).toContain("2 · On air");
    expect(html.indexOf(">Theme</button>")).toBeGreaterThan(status);
    expect(html.indexOf(">RECORDED</p>")).toBeGreaterThan(status);
  });

  it("puts the gourd row and its legend in the world over the room's shading, with channel 2 burning", () => {
    const html = renderToString(<LandingPage />);
    const shade = html.indexOf("_floorShade");
    const nav = html.indexOf('aria-label="Channels: five carved gourds in front of the set"');
    const legend = html.indexOf("data-legend");
    expect(shade).toBeGreaterThan(-1);
    expect(nav).toBeGreaterThan(shade);
    expect(legend).toBeGreaterThan(nav);
    expect(html.indexOf("data-status-bar")).toBeGreaterThan(legend);
    expect(html).toMatch(/<button[^>]*data-channel="2"[^>]*data-light="burn"/);
    // Nothing is written on the glass until a gourd is hovered or focused.
    expect(html).not.toContain("data-glass-caption");
  });

  it("hangs the chat strip in the world after the legend and under the status bar, scripted on replay", () => {
    const html = renderToString(<LandingPage />);
    const legend = html.indexOf("data-legend");
    const chat = html.indexOf("data-chat=");
    expect(chat).toBeGreaterThan(legend);
    expect(html.indexOf("data-status-bar")).toBeGreaterThan(chat);
    expect(html).toContain('aria-label="Live chat (simulated)"');
    expect(html).toContain("first time here. why is it 3am in here");
    expect(renderToString(<LandingPage plane="live" />)).toContain('aria-label="Live chat"');
  });
});
