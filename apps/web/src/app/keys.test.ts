import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  buildKeymap,
  eventHotkey,
  findConflicts,
  GLOBAL_BINDINGS,
  normalizeHotkey,
  stepChannel,
  type Binding,
  type ManifestEntry,
} from "./keys";
import { channelPages, PAGES, type PageDef } from "./pages";
import { normalizePath } from "./router";

// Hotkeys drawn from a small alphabet (letters in both cases, digits, named keys, modifiers) so
// that random manifests collide often, including across case and with the global bindings.
const KEY = fc.constantFrom(..."aAbBdDkKoOtTxX0123456789".split(""), "ArrowLeft", "Escape", "esc", "F1");
const HOTKEY = fc
  .tuple(fc.constantFrom("", "Ctrl+", "ctrl+", "Alt+", "Shift+", "Ctrl+Alt+"), KEY)
  .map(([mod, key]) => `${mod}${key}`);
const SEGMENT = fc.constantFrom("creator", "air", "sealed", "x", "Air");
const PATH = fc
  .tuple(fc.array(SEGMENT, { maxLength: 2 }), fc.boolean())
  .map(([segs, slash]) => `/${segs.join("/")}${slash && segs.length > 0 ? "/" : ""}`);

const entries = (pairs: readonly (readonly [string, string])[]): ManifestEntry[] =>
  pairs.map(([hotkey, path], i) => ({ id: `p${i}`, hotkey, path }));

const GLOBAL_KEYS = new Set(GLOBAL_BINDINGS.map((b) => normalizeHotkey(b.hotkey)));

/** A manifest whose hotkeys and paths are unique after normalisation and clear of the globals. */
const UNIQUE_MANIFEST = fc
  .uniqueArray(fc.tuple(HOTKEY, PATH), {
    maxLength: 8,
    comparator: (a, b) => normalizeHotkey(a[0]) === normalizeHotkey(b[0]) || normalizePath(a[1]) === normalizePath(b[1]),
  })
  .filter((pairs) => pairs.every(([hotkey]) => !GLOBAL_KEYS.has(normalizeHotkey(hotkey))))
  .map(entries);

describe("manifest uniqueness (property)", () => {
  it("accepts every manifest with unique hotkeys and paths", () => {
    fc.assert(
      fc.property(UNIQUE_MANIFEST, (manifest) => {
        expect(findConflicts(manifest)).toEqual([]);
      }),
    );
  });

  it("rejects any manifest where two pages share a hotkey (in any letter case)", () => {
    const arb = UNIQUE_MANIFEST.filter((m) => m.length >= 2).chain((m) =>
      fc.tuple(fc.constant(m), fc.nat(m.length - 1), fc.nat(m.length - 2), fc.boolean()),
    );
    fc.assert(
      fc.property(arb, ([manifest, i, k, flipCase]) => {
        const j = k >= i ? k + 1 : k; // j != i
        const copied = manifest[i]?.hotkey ?? "";
        const dup = manifest.map((p, n) =>
          n === j ? { ...p, hotkey: flipCase ? copied.toLowerCase() : copied.toUpperCase() } : p,
        );
        const conflicts = findConflicts(dup);
        expect(conflicts.some((c) => c.kind === "hotkey" && c.owners.includes(`p${i}`) && c.owners.includes(`p${j}`))).toBe(true);
      }),
    );
  });

  it("rejects any manifest where two pages share a path (trailing slash or not)", () => {
    const arb = UNIQUE_MANIFEST.filter((m) => m.length >= 2).chain((m) =>
      fc.tuple(fc.constant(m), fc.nat(m.length - 1), fc.nat(m.length - 2), fc.boolean()),
    );
    fc.assert(
      fc.property(arb, ([manifest, i, k, slash]) => {
        const j = k >= i ? k + 1 : k;
        const copied = manifest[i]?.path ?? "/";
        const dup = manifest.map((p, n) => (n === j ? { ...p, path: slash ? `${copied}/` : copied } : p));
        const conflicts = findConflicts(dup);
        expect(conflicts.some((c) => c.kind === "path" && c.owners.includes(`p${i}`) && c.owners.includes(`p${j}`))).toBe(true);
      }),
    );
  });

  it("rejects any page hotkey that a global binding already owns", () => {
    const arb = UNIQUE_MANIFEST.filter((m) => m.length >= 1).chain((m) =>
      fc.tuple(fc.constant(m), fc.nat(m.length - 1), fc.constantFrom(...GLOBAL_BINDINGS)),
    );
    fc.assert(
      fc.property(arb, ([manifest, i, global]) => {
        const dup = manifest.map((p, n) => (n === i ? { ...p, hotkey: global.hotkey.toLowerCase() } : p));
        expect(findConflicts(dup).some((c) => c.kind === "hotkey" && c.owners.includes(`p${i}`))).toBe(true);
      }),
    );
  });

  it("agrees with a counting model on arbitrary manifests", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(HOTKEY, PATH), { maxLength: 8 }), (pairs) => {
        const manifest = entries(pairs);
        const keys = [...manifest.map((p) => normalizeHotkey(p.hotkey)), ...GLOBAL_KEYS];
        const paths = manifest.map((p) => normalizePath(p.path));
        const unique = new Set(keys).size === keys.length && new Set(paths).size === paths.length;
        expect(findConflicts(manifest).length === 0).toBe(unique);
      }),
    );
  });

  it("buildKeymap throws and names the clash", () => {
    const clash: PageDef[] = [
      { id: "landing", title: "A", hotkey: "O", path: "/a", status: "live" },
      { id: "air", title: "B", hotkey: "o", path: "/b", status: "live" },
    ];
    expect(() => buildKeymap(clash)).toThrow(/hotkey "o" is claimed by landing, air/);
  });
});

describe("the shipped manifest", () => {
  it("has no hotkey or path clashes with itself or the globals", () => {
    expect(findConflicts(PAGES)).toEqual([]);
  });

  it("binds every page key, every global, and nothing else", () => {
    const map = buildKeymap(PAGES);
    expect(map.size).toBe(PAGES.length + GLOBAL_BINDINGS.length);
    for (const page of PAGES) expect(map.get(normalizeHotkey(page.hotkey))).toEqual({ kind: "go", pageId: page.id });
  });

  it("puts channels 2 3 4 6 9 on the dial in ascending order, keyed by their number", () => {
    const dial = channelPages(PAGES);
    expect(dial.map((p) => p.channel)).toEqual([2, 3, 4, 6, 9]);
    for (const p of dial) expect(p.hotkey).toBe(String(p.channel));
  });

  it("matches the channel table in landing design.md", () => {
    const table = PAGES.map(({ channel, id, path, hotkey, status }) => ({ channel, id, path, hotkey, status }));
    expect(table).toEqual(
      expect.arrayContaining([
        { channel: 2, id: "landing", path: "/", hotkey: "2", status: "live" },
        { channel: 3, id: "creator", path: "/creator", hotkey: "3", status: "live" },
        { channel: 4, id: "characters", path: "/characters", hotkey: "4", status: "live" },
        { channel: 6, id: "daemon", path: "/daemon", hotkey: "6", status: "live" },
        { channel: 9, id: "sealed", path: "/sealed", hotkey: "9", status: "sealed" },
        { channel: undefined, id: "air", path: "/air", hotkey: "O", status: "live" },
        // costume design.md "Route": Forge new, off the dial like the stage.
        { channel: undefined, id: "forge-new", path: "/creator/new", hotkey: "N", status: "live" },
        // avatar-reach: the embed, overlay and studio pages, off the dial and off the strip.
        { channel: undefined, id: "embed", path: "/embed", hotkey: "E", status: "live" },
        { channel: undefined, id: "overlay", path: "/overlay", hotkey: "B", status: "live" },
        { channel: undefined, id: "studio", path: "/studio", hotkey: "V", status: "live" },
      ]),
    );
    expect(table).toHaveLength(10);
  });

  it("binds the dial keys of landing 5.3: 2 3 4 6 9, arrows, Esc and D", () => {
    const map = buildKeymap(PAGES);
    for (const [key, pageId] of [["2", "landing"], ["3", "creator"], ["4", "characters"], ["6", "daemon"], ["9", "sealed"]]) {
      expect(map.get(normalizeHotkey(key ?? ""))).toEqual({ kind: "go", pageId });
    }
    expect(map.get(normalizeHotkey("ArrowLeft"))).toEqual({ kind: "channel", step: -1 });
    expect(map.get(normalizeHotkey("ArrowRight"))).toEqual({ kind: "channel", step: 1 });
    expect(map.get(normalizeHotkey("Esc"))).toEqual({ kind: "back" });
    expect(map.get(normalizeHotkey("d"))).toEqual({ kind: "daemon-sample" });
  });

  it("binds N to Forge new (costume 1.2)", () => {
    expect(buildKeymap(PAGES).get(normalizeHotkey("n"))).toEqual({ kind: "go", pageId: "forge-new" });
    expect(PAGES.find((p) => p.id === "forge-new")).toEqual({
      id: "forge-new",
      title: "Forge new",
      path: "/creator/new",
      subtitle: "a new character",
      hotkey: "N",
      status: "live",
    });
  });

  it("names the dial as the gourd labels of landing 5.1 (director decision 2026-11-01: Forge)", () => {
    expect(channelPages(PAGES).map((p) => p.title)).toEqual(["On air", "Forge", "Characters", "Daemon", "Sealed"]);
    expect(PAGES.find((p) => p.id === "creator")?.subtitle).toBe("behind the back panel");
  });

  it("gives every channel other than 2 a subtitle for its breadcrumb (landing 8.1)", () => {
    for (const p of channelPages(PAGES).filter((page) => page.channel !== 2)) expect(p.subtitle).toBeTruthy();
  });

  it("gives every sealed page a line of lore", () => {
    for (const p of PAGES.filter((page) => page.status === "sealed")) expect(p.lore).toBeTruthy();
  });
});

describe("hotkey normalisation", () => {
  it("is idempotent and case-insensitive", () => {
    fc.assert(
      fc.property(HOTKEY, (h) => {
        const n = normalizeHotkey(h);
        expect(normalizeHotkey(n)).toBe(n);
        expect(normalizeHotkey(h.toUpperCase())).toBe(normalizeHotkey(h.toLowerCase()));
      }),
    );
  });

  it("maps keyboard events onto manifest notation", () => {
    const ev = (key: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
      key,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      ...mods,
    });
    expect(eventHotkey(ev("o"))).toBe(normalizeHotkey("O"));
    expect(eventHotkey(ev("O", { shiftKey: true }))).toBe(normalizeHotkey("O"));
    expect(eventHotkey(ev("k", { ctrlKey: true }))).toBe(normalizeHotkey("Ctrl+K"));
    expect(eventHotkey(ev("k", { metaKey: true }))).toBe(normalizeHotkey("Ctrl+K"));
    expect(eventHotkey(ev("Escape"))).toBe(normalizeHotkey("Esc"));
    expect(eventHotkey(ev("ArrowLeft", { shiftKey: true }))).not.toBe(normalizeHotkey("ArrowLeft"));
    expect(eventHotkey(ev("Shift", { shiftKey: true }))).toBeUndefined();
  });
});

describe("stepChannel", () => {
  const dial = channelPages(PAGES).map((p) => p.id);

  it("turns the dial one step either way and wraps at the ends", () => {
    fc.assert(
      fc.property(fc.nat(dial.length - 1), fc.constantFrom(-1 as const, 1 as const), (i, step) => {
        const expected = dial[(i + step + dial.length) % dial.length];
        expect(stepChannel(PAGES, dial[i], step)?.id).toBe(expected);
      }),
    );
  });

  it("does nothing off the dial (the stage and Forge new have no channel)", () => {
    expect(stepChannel(PAGES, "air", 1)).toBeUndefined();
    expect(stepChannel(PAGES, "forge-new", -1)).toBeUndefined();
    expect(stepChannel(PAGES, undefined, -1)).toBeUndefined();
  });
});

it("global bindings are typed actions", () => {
  const kinds = GLOBAL_BINDINGS.map((b: Binding) => b.action.kind).sort();
  expect(kinds).toEqual(["back", "channel", "channel", "daemon-sample", "goto", "theme"]);
});
