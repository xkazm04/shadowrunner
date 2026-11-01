import fc from "fast-check";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ENGINE_STATES, PLANES, type Health } from "@sr/engine";
import { daemonOf, hms, StatusBar, UP_AT_OPEN, type StatusBarProps } from "./StatusBar";

function bar(over: Partial<StatusBarProps> = {}): string {
  return renderToString(<StatusBar plane="replay" daemon="online" {...over} />);
}

/** Index of `needle` in `html`, failing the test when it is missing. */
function at(html: string, needle: string): number {
  const i = html.indexOf(needle);
  expect(i, needle).toBeGreaterThan(-1);
  return i;
}

describe("hms", () => {
  it("writes whole seconds as hh:mm:ss that read back to the same count", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 * 3600 - 1 }), (s) => {
        const text = hms(s);
        expect(text).toMatch(/^\d{2}:\d{2}:\d{2}$/);
        const [h, m, sec] = text.split(":").map(Number);
        expect(m).toBeLessThan(60);
        expect(sec).toBeLessThan(60);
        expect((h ?? 0) * 3600 + (m ?? 0) * 60 + (sec ?? 0)).toBe(s);
      }),
    );
    expect(hms(UP_AT_OPEN)).toBe("03:12:40");
  });

  it("never shows a negative or broken time", () => {
    for (const s of [-1, -3600, Number.NaN, Number.NEGATIVE_INFINITY]) expect(hms(s)).toBe("00:00:00");
    expect(hms(59.9)).toBe("00:00:59");
  });
});

describe("daemonOf", () => {
  it("is lost exactly when health names the engine offline; no health yet is online", () => {
    const health: fc.Arbitrary<Health | undefined> = fc.option(
      fc.record({ plane: fc.constantFrom(...PLANES), engine: fc.constantFrom(...ENGINE_STATES), version: fc.string() }),
      { nil: undefined },
    );
    fc.assert(
      fc.property(health, (h) => {
        expect(daemonOf(h)).toBe(h?.engine === "offline" ? "lost" : "online");
      }),
    );
  });
});

describe("StatusBar", () => {
  it("online: viewers, live-since clock and the daemon pill, left to right (the lamp hangs from the beam now)", () => {
    const html = bar();
    expect(html).toContain('data-daemon="online"');
    expect(html).not.toContain("data-lamp");
    const order = [
      at(html, ">Shadowrunner</a>"),
      at(html, "Viewers"),
      at(html, "since"),
      at(html, ">03:00</b>"),
      at(html, ">03:12:40</b>"),
      at(html, "Daemon online"),
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain("(you)");
    for (const absent of ["OFF AIR", "Dead air", "DAEMON LOST", "re-seat"]) expect(html).not.toContain(absent);
  });

  it("daemon lost: dead-air timer from the clock it is given, and the re-seat pill", () => {
    const html = bar({ daemon: "lost", clock: { up: UP_AT_OPEN + 20, dead: 12 } });
    expect(html).toContain('data-daemon="lost"');
    const order = [at(html, "Dead air for"), at(html, ">00:00:12</b>"), at(html, "DAEMON LOST")];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain("re-seat");
    expect(html).toContain("still you");
    for (const absent of [">ON AIR<", "since", "Daemon online", "03:12:40"]) expect(html).not.toContain(absent);
  });

  it("announces the daemon state politely, and keeps the ticking clock out of the live region", () => {
    for (const daemon of ["online", "lost"] as const) {
      const html = bar({ daemon });
      const live = html.match(/<p[^>]*role="status"[^>]*>(.*?)<\/p>/);
      expect(live?.[1]).toContain(daemon === "online" ? "Daemon online" : "DAEMON LOST");
      expect(live?.[1]).not.toMatch(/\d{2}:\d{2}:\d{2}/);
    }
  });

  it("shows the D key on the pill only on replay, where the sample toggle lives", () => {
    expect(bar({ plane: "replay" })).toContain("<kbd>D</kbd>");
    expect(bar({ plane: "live" })).not.toContain("<kbd>D</kbd>");
  });

  it("shows the uptime it is given, and opens on the reference's uptime without one", () => {
    expect(bar({ clock: { up: UP_AT_OPEN + 5, dead: 0 } })).toContain(">03:12:45</b>");
    expect(bar()).toContain(">03:12:40</b>");
  });

  it("tags the wordmark with the shell's badge, before the stats", () => {
    const html = bar({ badge: <p data-badge="recorded">RECORDED</p> });
    expect(at(html, ">Shadowrunner</a>")).toBeLessThan(at(html, ">RECORDED</p>"));
    expect(at(html, ">RECORDED</p>")).toBeLessThan(at(html, "Viewers"));
    expect(bar()).not.toContain("RECORDED");
  });

  it("places the shell's controls between the stats and the daemon pill", () => {
    const html = bar({ controls: <button type="button">Theme</button> });
    expect(at(html, ">03:12:40</b>")).toBeLessThan(at(html, ">Theme</button>"));
    expect(at(html, ">Theme</button>")).toBeLessThan(at(html, "Daemon online"));
  });
});
