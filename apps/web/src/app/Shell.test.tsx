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
      expect(other).toContain('aria-label="Channels"');
      expect(other).not.toContain("data-status-bar");
    }
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
    const current = PAGES.find((p) => p.id === "creator");
    const html = view(current);
    for (const page of PAGES) {
      expect(html).toContain(`href="${page.path}"`);
      expect(html).toContain(`<kbd>${page.hotkey}</kbd>`);
    }
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/href="\/creator" aria-current="page"/);
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
