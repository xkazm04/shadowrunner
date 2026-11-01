import fc from "fast-check";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ENGINE_STATES, PLANES, type Health } from "@sr/engine";
import { daemonOf, hms, StatusBar, UP_AT_OPEN, type StatusBarProps } from "./StatusBar";

const CHANNEL = { number: 2, title: "On air" };

function bar(over: Partial<StatusBarProps> = {}): string {
  return renderToString(<StatusBar plane="replay" daemon="online" channel={CHANNEL} {...over} />);
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
  it("online: ON AIR, viewers, channel, live-since clock and the daemon pill, left to right", () => {
    const html = bar();
    expect(html).toContain('data-daemon="online"');
    const order = [
      at(html, ">Shadowrunner</a>"),
      at(html, ">ON AIR</span>"),
      at(html, "Viewers"),
      at(html, "2 · On air"),
      at(html, "since"),
      at(html, ">03:00</b>"),
      at(html, ">03:12:40</b>"),
      at(html, "Daemon online"),
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain("(you)");
    for (const absent of ["OFF AIR", "Dead air", "DAEMON LOST", "re-seat"]) expect(html).not.toContain(absent);
  });

  it("daemon lost: OFF AIR, dead-air timer from zero, and the re-seat pill", () => {
    const html = bar({ daemon: "lost" });
    expect(html).toContain('data-daemon="lost"');
    const order = [at(html, ">OFF AIR</span>"), at(html, "Dead air for"), at(html, ">00:00:00</b>"), at(html, "DAEMON LOST")];
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

  it("names the channel it is given", () => {
    expect(bar({ channel: { number: 6, title: "Daemon" } })).toContain("6 · Daemon");
  });

  it("places the shell's controls between the stats and the daemon pill", () => {
    const html = bar({ controls: <button type="button">Theme</button> });
    expect(at(html, ">03:12:40</b>")).toBeLessThan(at(html, ">Theme</button>"));
    expect(at(html, ">Theme</button>")).toBeLessThan(at(html, "Daemon online"));
  });
});
