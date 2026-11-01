// CH 6, the root vault (costume task 5.1; requirement 6). The tendrils' growth is a pure function
// of dead-air seconds (property: zero without dead air, bounded, never shrinking while the dead air
// goes on, never reaching the socket); the readings and events are the health and daemon state;
// the page renders the vault, the word on the floor and the chain in both states.
import fc from "fast-check";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Daemon, vaultCopy } from "./Daemon";
import {
  coverFit,
  filamentPath,
  foldLight,
  healthEvent,
  parseColour,
  remember,
  rootGrowth,
  rootReachCm,
  stateEvents,
  swingDeg,
  TENDRILS,
  tendrilPath,
  tendrilPoint,
  tendrilReach,
  vaultReadings,
} from "./DaemonVault";

/** Server HTML without the empty comments React puts between adjacent text nodes. */
const ssr = (node: Parameters<typeof renderToString>[0]) => renderToString(node).replace(/<!-- -->/g, "");

const seconds = fc.double({ min: 0, max: 1e6, noNaN: true });

describe("rootGrowth: the roots grow toward the empty socket with dead air", () => {
  it("is zero without dead air (and for nonsense input)", () => {
    for (const s of [0, -1, -Infinity, Number.NaN]) expect(rootGrowth(s)).toBe(0);
  });

  it("stays in [0, 1): the roots never reach the socket", () => {
    fc.assert(
      fc.property(seconds, (s) => {
        const g = rootGrowth(s);
        expect(g).toBeGreaterThanOrEqual(0);
        expect(g).toBeLessThan(1);
      }),
    );
  });

  it("never shrinks while the dead air goes on, and grows within the first minutes", () => {
    fc.assert(
      fc.property(seconds, seconds, (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(rootGrowth(lo)).toBeLessThanOrEqual(rootGrowth(hi));
      }),
    );
    fc.assert(
      fc.property(fc.double({ min: 0, max: 300, noNaN: true }), fc.double({ min: 0.5, max: 60, noNaN: true }), (s, d) => {
        expect(rootGrowth(s + d)).toBeGreaterThan(rootGrowth(s));
      }),
    );
  });

  it("grows second by second through the first five minutes and never falls back in the hour", () => {
    for (let t = 0; t < 3600; t += 0.25) {
      if (t < 300) expect(rootGrowth(t + 0.25)).toBeGreaterThan(rootGrowth(t));
      else expect(rootGrowth(t + 0.25)).toBeGreaterThanOrEqual(rootGrowth(t));
    }
  });

  it("every tendril's reach follows the growth, in [0, 1)", () => {
    fc.assert(
      fc.property(seconds, seconds, fc.integer({ min: 0, max: TENDRILS.length - 1 }), (a, b, i) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        const r = tendrilReach(rootGrowth(lo), i);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThan(1);
        expect(r).toBeLessThanOrEqual(tendrilReach(rootGrowth(hi), i));
      }),
    );
  });

  it("a tendril starts at its root and lengthens along one fixed path", () => {
    const cover = coverFit(1440, 900);
    const socket = [720, 200] as const;
    fc.assert(
      fc.property(seconds, fc.integer({ min: 0, max: TENDRILS.length - 1 }), (s, i) => {
        const t = TENDRILS[i];
        if (!t) return;
        const pts = tendrilPath(t, i, rootGrowth(s), cover, socket, 1, 24);
        expect(pts).toHaveLength(25);
        const root = tendrilPath(t, i, 0, cover, socket, 1, 24);
        expect(root.every((p) => p[0] === root[0]?.[0] && p[1] === root[0]?.[1])).toBe(true);
        expect(pts[0]).toEqual(root[0]);
        // Every point lies on the one fixed path, at its share of the reach: the grown part is a prefix.
        const reach = tendrilReach(rootGrowth(s), i);
        pts.forEach((p, k) => expect(p).toEqual(tendrilPoint(t, i, (k / 24) * reach, cover, socket, 1)));
      }),
    );
  });

  it("writes the reach in centimetres, one decimal, from whole seconds", () => {
    expect(rootReachCm(0)).toBe("0.0");
    expect(rootReachCm(20.9)).toBe("2.0");
    expect(rootReachCm(-5)).toBe("0.0");
  });
});

describe("the bulb", () => {
  it("swings within 6 degrees, and hangs still under reduced motion", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1e7, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (ms, amp) => {
        expect(Math.abs(swingDeg(ms, amp, "full"))).toBeLessThanOrEqual(6);
        expect(swingDeg(ms, amp, "reduced")).toBe(0);
      }),
    );
  });

  it("its filament is the carrier: a wave alive, a flat wire dead", () => {
    const alive = filamentPath(500, 1, false);
    const dead = filamentPath(500, 1, true);
    expect(alive.startsWith("M22.0 ")).toBe(true);
    expect(new Set(alive.match(/ (\d+\.\d)/g)).size).toBeGreaterThan(3);
    expect(new Set(dead.match(/ (\d+\.\d)/g))).toEqual(new Set([" 60.0"]));
  });

  it("flickers out over the fold and stays out", () => {
    expect(foldLight(0)).toBe(1);
    expect(foldLight(0.12)).toBeLessThan(0.5);
    expect(foldLight(0.62)).toBe(0);
    expect(foldLight(5)).toBe(0);
  });

  it("reads role colours in either computed form", () => {
    expect(parseColour("#ffb347")).toEqual([255, 179, 71]);
    expect(parseColour(" rgb(150, 180, 255)")).toEqual([150, 180, 255]);
    expect(parseColour("var(--x)")).toBeUndefined();
  });
});

describe("readings and memories: the real health and daemon state", () => {
  const live = { plane: "live", engine: "anthropic", version: "1.2.3" } as const;

  it("reads awake: carrier steady, the engine and version from health, uptime", () => {
    const rows = vaultReadings({ health: live, plane: "live", lost: false, up: 3 * 3600 + 12 * 60 + 47, dead: 0, motion: "full" });
    expect(rows.map((r) => `${r.key} ${r.value} · ${r.note}`)).toEqual([
      "carrier steady · locked · 6 roots",
      "engine anthropic · v1.2.3",
      "roots feeding · carrier rising",
      "uptime 03:12:47 · since 03:00",
      "light the bulb · swinging",
      "plane live · on air",
    ]);
    expect(rows.every((r) => r.tone === undefined)).toBe(true);
  });

  it("reads gone: no carrier, dead air counting, the roots reaching, moon only", () => {
    const rows = vaultReadings({ health: undefined, plane: "replay", lost: true, up: 0, dead: 65, motion: "reduced" });
    expect(rows.map((r) => `${r.key} ${r.value} · ${r.note} · ${r.tone ?? ""}`)).toEqual([
      "carrier none · lost · bad",
      "engine no answer · replay · tape · bad",
      "roots reaching · 6.5 cm grown · cold",
      "dead air 00:01:05 · counting · bad",
      "light moon only · through the grate · cold",
      "plane replay · recorded · ",
    ]);
  });

  it("remembers each state the daemon enters, and each health read", () => {
    expect(stateEvents("folding", "online", "03:12:50").map((e) => e.tone)).toEqual(["bad", "bad"]);
    expect(stateEvents("dark", "folding", "t")).toEqual([{ at: "t", text: "bulb out · the roots are still growing", tone: "cold" }]);
    expect(stateEvents("online", "relighting", "t")[0]?.text).toContain("the roots let go");
    expect(stateEvents("online", "online", "t")).toEqual([]);
    expect(healthEvent(undefined, "replay", "t").text).toBe("health read · no answer · replay");
    expect(healthEvent({ ...live, engine: "offline" }, "live", "t")).toEqual({ at: "t", text: "health read · live · offline · 1.2.3", tone: "bad" });
    const many = Array.from({ length: 12 }, (_, i) => ({ at: String(i), text: "x" }));
    expect(remember([], many).map((e) => e.at)).toEqual(["4", "5", "6", "7", "8", "9", "10", "11"]);
  });

  it("offers the chain only on replay; on live the daemon is the real one", () => {
    expect(vaultCopy("replay", false)).toMatchObject({ pull: "PULL THE CHAIN", pullable: true });
    expect(vaultCopy("replay", true)).toMatchObject({ pull: "PULL IT AGAIN · RE-SEAT", pullable: true });
    expect(vaultCopy("live", false).pullable).toBe(false);
    expect(vaultCopy("live", true).note).toContain("waiting for the daemon");
  });
});

describe("Daemon (CH 6) renders the root vault", () => {
  it("awake: the bulb, the word AWAKE on the floor, the readings, the chain with D", () => {
    const html = ssr(<Daemon health={undefined} plane="replay" lost={false} />);
    expect(html).toContain('data-page="daemon"');
    expect(html).toContain('data-daemon="online" data-state="online"');
    expect(html).toMatch(/<h1 id="page-title"[^>]*>Channel 6 · the daemon is<span[^>]*> awake<\/span><\/h1>/);
    expect(html).toContain(">AWAKE</p>");
    expect(html).toContain("awake for <b>03:12:40</b>");
    expect(html).toContain("THE CELLAR REMEMBERS");
    expect(html).toContain("<dt>carrier</dt><dd>steady<small>locked · 6 roots</small></dd>");
    expect(html).toMatch(/aria-label="Pull the chain: cut the daemon \(D\)"/);
    expect(html).toContain("<kbd>D</kbd>");
  });

  it("lost: GONE on the floor, dead air, the roots still growing", () => {
    const html = ssr(<Daemon health={{ plane: "live", engine: "offline", version: "9" }} plane="live" lost />);
    expect(html).toContain('data-daemon="lost" data-state="dark"');
    expect(html).toContain("data-lost");
    expect(html).toContain(">GONE</p>");
    expect(html).toContain("dead air <b>00:00:00</b>");
    expect(vaultCopy("replay", true).note).toContain("press D to re-seat it");
    expect(html).toContain("THE ROOTS ARE STILL GROWING");
    expect(html).toContain("0.0 cm toward the empty socket");
    expect(html).toContain("<dt>engine</dt><dd>offline<small>v9</small></dd>");
    expect(html).not.toContain("<kbd>D</kbd>");
    expect(html).toContain("THE CHAIN IS SLACK · LIVE");
  });
});
