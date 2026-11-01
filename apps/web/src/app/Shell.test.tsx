import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PAGES, type PageDef } from "./pages";
import { Shell, ShellView, type ShellViewProps } from "./Shell";

const noop = () => undefined;

function view(page: PageDef | undefined, over: Partial<ShellViewProps> = {}): string {
  return renderToString(
    <ShellView
      path={page?.path ?? "/nowhere"}
      page={page}
      plane="replay"
      theme="halloween"
      motion="full"
      gotoOpen={false}
      onToggleTheme={noop}
      onCloseGoto={noop}
      {...over}
    />,
  );
}

describe("Shell", () => {
  it("renders without a window (server snapshot: landing, reduced motion)", () => {
    const html = renderToString(<Shell />);
    expect(html).toContain("Shadowrunner");
    expect(html).toContain('data-page="landing"');
    expect(html).toContain('data-motion="reduced"');
    expect(html).toContain('data-plane="replay"');
    expect(html).toContain(">RECORDED</p>");
  });

  it("shows the RECORDED badge on replay, on every page and outside it, and not on live", () => {
    for (const page of [...PAGES, undefined]) {
      const recorded = view(page, { plane: "replay" });
      const badge = recorded.indexOf('data-badge="recorded"');
      expect(badge).toBeGreaterThan(-1);
      if (page?.id === "landing") {
        // On the set the status bar is the header: the badge sits in it, before the pill.
        expect(badge).toBeGreaterThan(recorded.indexOf("data-status-bar"));
        expect(badge).toBeLessThan(recorded.indexOf('role="status"'));
      } else if (page?.id === "air") {
        // The stage is full screen (no shell header): the badge is on the stage itself.
        expect(badge).toBeGreaterThan(recorded.indexOf('data-page="air"'));
      } else if (page !== undefined) {
        // Behind the set (the channels and Forge new) the frame is the header: the badge sits in its bar.
        expect(badge).toBeGreaterThan(recorded.indexOf("data-channel-frame"));
        expect(badge).toBeLessThan(recorded.indexOf("</header>"));
      } else {
        expect(badge).toBeLessThan(recorded.indexOf("<main"));
      }
      expect(view(page, { plane: "live" })).not.toContain("RECORDED");
    }
  });

  it("renders no shell header on the set, and keeps the theme toggle in the status bar", () => {
    const landing = PAGES.find((p) => p.id === "landing");
    const html = view(landing);
    expect(html).not.toContain('aria-label="Channels"');
    expect(html.match(/<header/g)).toHaveLength(1);
    expect(html.indexOf("Switch to Baseline")).toBeGreaterThan(html.indexOf("data-status-bar"));
    expect(html).toContain("<kbd>D</kbd>");
    expect(view(landing, { plane: "live" })).not.toContain("<kbd>D</kbd>");
    for (const page of PAGES.filter((p) => p.id !== "landing")) {
      const other = view(page);
      expect(other).not.toContain("data-status-bar");
      // Channels behind the set open in their frame; the stage (off the dial) is full screen, for
      // a stream's browser source, with no shell header at all.
      if (page.id === "air") {
        expect(other).not.toContain('aria-label="Channels"');
        expect(other).not.toContain("<header");
        continue;
      }
      expect(other).toContain(`data-channel-frame="${page.id}"`);
      expect(other.match(/<header/g)).toHaveLength(1);
      // costume 1.3: the frame's bar carries the channel strip in place of "Back to the set".
      expect(other).toContain('data-strip="frame"');
      expect(other).not.toContain("Back to the set");
    }
  });

  it("frames Forge new (/creator/new) with a placeholder and CH 3 lit on the strip (costume 1.2)", () => {
    const forgeNew = PAGES.find((p) => p.id === "forge-new");
    const html = view(forgeNew);
    expect(html).toContain('data-channel-frame="forge-new"');
    expect(html).toContain('data-page="forge-new"');
    expect(html).toMatch(/<a href="\/creator"[^>]*aria-current="page"/);
  });

  it("cools the strip's lamp when the daemon is lost (health offline, or the D sample on replay)", () => {
    const characters = PAGES.find((p) => p.id === "characters");
    expect(view(characters)).toContain('data-lamp="warm"');
    expect(view(characters, { health: { plane: "live", engine: "offline", version: "t" } })).toContain('data-lamp="cold"');
    expect(view(characters, { daemonSample: true })).toContain('data-lamp="cold"');
  });

  it("renders a placeholder for every live page and the sealed door for sealed ones", () => {
    for (const page of PAGES) {
      const html = view(page);
      if (page.status === "sealed") {
        expect(html).toContain('data-door="sealed"');
        expect(html).toContain(page.lore ?? "missing lore");
        expect(html).not.toContain("data-page=");
      } else {
        expect(html).toContain(`data-page="${page.id}"`);
        expect(html).not.toContain("data-door");
      }
      expect(html).toContain(page.title.replace("'", "&#x27;"));
    }
  });

  it("navigation lists every manifest page with its key, and marks the current one", () => {
    const current = PAGES.find((p) => p.id === "air");
    const html = view(current, { gotoOpen: true });
    for (const page of PAGES) {
      expect(html).toContain(`href="${page.path}"`);
      expect(html).toContain(`<kbd>${page.hotkey}</kbd>`);
    }
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/href="\/air" aria-current="page"/);
    // Where the shell header shows (no signal), it lists every page too.
    const nowhere = view(undefined);
    for (const page of PAGES) expect(nowhere).toContain(`href="${page.path}"`);
  });

  it("shows no signal for a path outside the manifest", () => {
    expect(view(undefined, { path: "/cellar/door" })).toContain("Nothing is broadcast at /cellar/door.");
  });

  it("on the set, the theme toggle is an icon button named by its label, and the badge tags the wordmark", () => {
    const landing = PAGES.find((p) => p.id === "landing");
    const html = view(landing, { theme: "baseline" });
    const button = html.match(/<button[^>]*data-toggle="theme"[^>]*>(.*?)<\/button>/);
    expect(button?.[0]).toContain('aria-label="Theme: Baseline. Switch to Halloween"');
    expect(button?.[1]).toMatch(/^<svg[^>]*aria-hidden="true"/);
    // No visible text but the key hint: the name comes from aria-label.
    expect(button?.[1]?.replace(/<svg.*<\/svg>/, "")).toBe("<kbd>T</kbd>");
    expect(html.indexOf(">Shadowrunner</a>")).toBeLessThan(html.indexOf('data-badge="recorded"'));
    expect(html.indexOf('data-badge="recorded"')).toBeLessThan(html.indexOf("data-lamp"));
    // Off the set the toggle keeps its words.
    const creator = PAGES.find((p) => p.id === "creator");
    expect(view(creator, { theme: "baseline" })).toMatch(/data-toggle="theme"[^>]*>Theme: Baseline <kbd>/);
  });

  it("names the active theme on the toggle and mirrors the motion preference", () => {
    const html = view(PAGES[0], { theme: "baseline", motion: "reduced" });
    expect(html).toContain("Theme: Baseline");
    expect(html).toContain("Switch to Halloween");
    expect(html).toContain('data-motion="reduced"');
  });

  it("opens the go-to list on request", () => {
    expect(view(PAGES[0])).not.toContain('role="dialog"');
    expect(view(PAGES[0], { gotoOpen: true })).toContain('role="dialog"');
  });
});
