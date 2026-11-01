// The channels behind the set (landing task 9): the frame's breadcrumb and back control and the
// listings' links from the manifest. CH 6 and CH 9 have their own tests (Daemon.test.tsx,
// Sealed.test.tsx; costume task 5).
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { channelPages, PAGES, type PageDef } from "../app/pages";
import { breadcrumb, breadcrumbText, ChannelFrame } from "./ChannelFrame";
import { Listings } from "./Listings";

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
