// The channels behind the set (landing task 9): the frame's breadcrumb and back control, the
// listings' links from the manifest, the daemon's test card bound to health and the sample, and
// the sealed door.
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { channelPages, PAGES, type PageDef } from "../app/pages";
import { breadcrumb, breadcrumbText, ChannelFrame } from "./ChannelFrame";
import { Daemon, daemonAction, daemonRows } from "./Daemon";
import { Listings } from "./Listings";
import { Sealed } from "./Sealed";
import { TUBE_CLIP } from "./Tube";

// The stylesheet's source text, as ChatStrip.test.tsx reads it: the app's types have no Node, so
// node:fs is loaded by a computed specifier and typed locally.
interface Fs {
  readFileSync(path: URL, encoding: "utf8"): string;
}
const NODE_FS = ["node", "fs"].join(":");
const fs: Fs = await import(/* @vite-ignore */ NODE_FS);

const page = (id: PageDef["id"]): PageDef => {
  const found = PAGES.find((p) => p.id === id);
  if (!found) throw new Error(`no page ${id}`);
  return found;
};

describe("ChannelFrame", () => {
  it("writes the breadcrumb as SHADOWRUNNER ▸ CH n · Name · subtitle for every channel but 2", () => {
    expect(breadcrumbText(page("characters"))).toBe("SHADOWRUNNER ▸ CH 4 · Characters · tonight's listings");
    expect(breadcrumbText(page("creator"))).toBe("SHADOWRUNNER ▸ CH 3 · Forge · behind the back panel");
    expect(breadcrumbText(page("daemon"))).toBe("SHADOWRUNNER ▸ CH 6 · Daemon · the carrier");
    expect(breadcrumbText(page("sealed"))).toBe("SHADOWRUNNER ▸ CH 9 · Sealed · not built yet");
    for (const p of channelPages(PAGES)) {
      const { here, subtitle } = breadcrumb(p);
      expect(here).toBe(`CH ${p.channel} · ${p.title}`);
      expect(subtitle).toBe(p.subtitle);
    }
  });

  it("renders the back control to the set with its Esc key, the breadcrumb, then the shell's controls", () => {
    const html = renderToString(
      <ChannelFrame page={page("characters")} badge={<i data-badge />} controls={<i data-toggle />}>
        <p data-child />
      </ChannelFrame>,
    );
    expect(html).toMatch(/<a href="\/"[^>]*data-back="true"><span aria-hidden="true">◂<\/span> Back to the set <kbd>Esc<\/kbd><\/a>/);
    expect(html).toContain('<nav aria-label="Breadcrumb"');
    expect(html).toContain("<b>CH 4 · Characters</b>");
    const order = ["data-back", "Breadcrumb", "data-badge", "data-toggle", "</header>", "data-child"].map((s) => html.indexOf(s));
    expect(order.every((at, i) => at > -1 && (i === 0 || at > (order[i - 1] ?? -1)))).toBe(true);
  });
});

describe("Listings (CH 4)", () => {
  const html = renderToString(<Listings />);
  it("is the Cellar Listings with Malakor on now and the vacant hours", () => {
    expect(html).toContain('data-page="characters"');
    expect(html).toMatch(/<h1 id="page-title">Cellar Listings<\/h1>/);
    expect(html).toContain("03:00 · ON AIR NOW · CH 2");
    expect(html).toContain("Arch-Lich Malakor");
    expect(html).toContain("Later tonight");
    expect(html).toContain("04:00 · VACANT");
    expect(html).toContain("CH 9 · SEALED");
    expect(html).toMatch(/<img[^>]*alt="Portrait of Arch-Lich Malakor \(stylised\)"/);
  });

  it("links every call to action to its channel's path from the manifest", () => {
    expect(html).toMatch(/href="\/creator\?character=malakor"[^>]*>Open in the Forge · CH 3</);
    expect(html).toMatch(/href="\/"[^>]*>Watch · CH 2</);
    expect(html).toMatch(/href="\/creator"[^>]*>Forge a character · CH 3</);
    expect(html).toMatch(/href="\/sealed"[^>]*>Tune to 9</);
  });

  it("sets its text on opaque paper, with the texture as a screen at 0.24 or less", () => {
    const css = fs.readFileSync(new URL("./Listings.module.css", import.meta.url), "utf8");
    const pageRule = css.match(/\n\.page \{[^}]*\}/)?.[0] ?? "";
    expect(pageRule).toContain("background-color: var(--sr-paper);");
    expect(pageRule).toContain("color: var(--sr-paper-ink);");
    const texture = css.match(/\.page::before \{[^}]*\}/)?.[0] ?? "";
    expect(texture).toContain("mix-blend-mode: screen;");
    expect(Number(texture.match(/opacity: ([\d.]+);/)?.[1])).toBeLessThanOrEqual(0.24);
  });
});

describe("Daemon (CH 6)", () => {
  const live = { plane: "live", engine: "anthropic", version: "1.2.3" } as const;

  it("reads online and steady with uptime, and the D key only on replay", () => {
    const rows = daemonRows({ health: undefined, plane: "replay", lost: false, elapsed: 7, dead: 0 });
    expect(rows.map((r) => `${r.key} ${r.value}`)).toEqual([
      "DAEMON online",
      "carrier steady",
      "plane replay · recorded",
      "engine no answer · replay",
      "uptime 03:12:47",
      "quota none spent · replay",
    ]);
    expect(daemonAction("replay", false)).toBe("press D to cut it");
    expect(daemonAction("replay", true)).toBe("press D to re-seat it");
    expect(daemonAction("live", false)).not.toContain("D");
    expect(daemonAction("live", true)).not.toContain("D");
  });

  it("reads LOST with no carrier and the dead-air time once lost, and names the live engine", () => {
    const rows = daemonRows({ health: { ...live, engine: "offline" }, plane: "live", lost: true, elapsed: 70, dead: 65 });
    expect(rows[0]).toEqual({ key: "DAEMON", value: "LOST", alarm: true });
    expect(rows.map((r) => `${r.key} ${r.value}`)).toEqual([
      "DAEMON LOST",
      "carrier none",
      "plane live",
      "engine offline",
      "dead air 00:01:05",
      "quota not reported by health",
      "version 1.2.3",
    ]);
  });

  it("renders the test card on the tube, clipped to the glass superellipse", () => {
    const html = renderToString(<Daemon health={live} plane="live" lost={false} />);
    expect(html).toContain('data-page="daemon"');
    expect(html).toContain('data-daemon="online"');
    expect(html).toMatch(/<h1 id="page-title"[^>]*>Channel 6<\/h1>/);
    expect(html).toContain("<dt>engine</dt><dd>anthropic</dd>");
    expect(html).toContain(`clip-path:${TUBE_CLIP}`);
    expect(TUBE_CLIP.startsWith("polygon(100% 50%")).toBe(true);
  });
});

describe("Sealed (CH 9)", () => {
  it("is the sealed door: NOT BUILT YET and the channel's lore in the snow", () => {
    const html = renderToString(<Sealed page={page("sealed")} />);
    expect(html).toContain('data-door="sealed"');
    expect(html).toContain('data-tube="snow"');
    expect(html).toContain("Channel 9 · Sealed");
    expect(html).toMatch(/<h1 id="page-title"[^>]*>Not built yet<\/h1>/);
    expect(html).toContain(page("sealed").lore ?? "missing lore");
  });
});
