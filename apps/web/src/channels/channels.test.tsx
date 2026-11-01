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

  it("renders the channel strip (costume 1.3), the breadcrumb, then the shell's controls", () => {
    const html = renderToString(
      <ChannelFrame page={page("characters")} badge={<i data-badge />} controls={<i data-toggle />}>
        <p data-child />
      </ChannelFrame>,
    );
    expect(html).not.toContain("Back to the set");
    expect(html).toMatch(/<a href="\/"[^>]*data-frame="landing"[^>]*aria-label="Channel 2, On air: the cellar set"/);
    expect(html).toContain('data-lamp="warm"');
    expect(html).toContain('<nav aria-label="Breadcrumb"');
    expect(html).toContain("<b>CH 4 · Characters</b>");
    const order = ['data-strip="frame"', "Breadcrumb", "data-badge", "data-toggle", "</header>", "data-child"].map((s) => html.indexOf(s));
    expect(order.every((at, i) => at > -1 && (i === 0 || at > (order[i - 1] ?? -1)))).toBe(true);
  });

  it("hands the daemon-lost state to the strip's lamp", () => {
    const html = renderToString(
      <ChannelFrame page={page("daemon")} daemonLost>
        <p />
      </ChannelFrame>,
    );
    expect(html).toContain('data-lamp="cold"');
  });
});

describe("Listings (CH 4)", () => {
  const html = renderToString(<Listings />);
  it("is the Cellar Listings wall with Malakor's set on now and his listing pinned", () => {
    expect(html).toContain('data-page="characters"');
    expect(html).toMatch(/<h1 id="page-title"[^>]*><span>Cellar Listings<\/span>/);
    expect(html).toContain('aria-label="03:00, Arch-Lich Malakor, on air now"');
    expect(html).toContain("03:00 · ON AIR NOW · CH 2");
    expect(html).toContain('data-phase="dark"');
  });

  it("links the listing's calls to action to their channels' paths from the manifest", () => {
    expect(html).toMatch(/href="\/creator\?character=malakor"[^>]*>Open in the Forge · CH 3</);
    expect(html).toMatch(/href="\/"[^>]*>Watch · CH 2</);
  });

  it("sets the clipping's inks on the wall-clip paper, with the texture multiplied at 0.14", () => {
    const css = fs.readFileSync(new URL("./Listings.module.css", import.meta.url), "utf8");
    const paper = css.match(/\n\.paper \{[^}]*\}/)?.[0] ?? "";
    expect(paper).toContain("var(--sr-wall-clip)");
    expect(paper).toContain("color: var(--sr-wall-clip-ink);");
    const texture = css.match(/\.paper::before \{[^}]*\}/)?.[0] ?? "";
    expect(texture).toContain("mix-blend-mode: multiply;");
    expect(Number(texture.match(/opacity: ([\d.]+);/)?.[1])).toBeLessThanOrEqual(0.14);
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
