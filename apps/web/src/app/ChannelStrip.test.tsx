// The channel strip's pure parts and stylesheet (costume 1.3; requirement 2.1-2.4): which frames
// the manifest gives, which one is lit, each frame's accessible name, and the CSS rules behind the
// cold lamp, the visible focus, the hidden stage strip and the reduced-motion twins.
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChannelStrip, frameLabel, litFrame, stripPages } from "./ChannelStrip";
import { channelPages, PAGES, type PageDef } from "./pages";

// The stylesheet's source text, as ChatStrip.test.tsx reads it (the app's types have no Node).
interface Fs {
  readFileSync(path: URL, encoding: "utf8"): string;
}
const NODE_FS = ["node", "fs"].join(":");
const fs: Fs = await import(/* @vite-ignore */ NODE_FS);
/** Without comments, which name the prototype's rules. */
const css = fs.readFileSync(new URL("./ChannelStrip.module.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("stripPages / litFrame (pure)", () => {
  it("is the dial 2 3 4 6 9 then the stage, and leaves out Forge new (nested under CH 3)", () => {
    const strip = stripPages(PAGES);
    expect(strip.map((p) => p.id)).toEqual(["landing", "creator", "characters", "daemon", "sealed", "air"]);
    expect(strip.slice(0, 5)).toEqual(channelPages(PAGES));
  });

  it("lights each strip page's own frame, Forge new's parent, and nothing off the manifest", () => {
    for (const page of stripPages(PAGES)) expect(litFrame(page.id, PAGES)).toBe(page.id);
    expect(litFrame("forge-new", PAGES)).toBe("creator");
    expect(litFrame(undefined, PAGES)).toBeUndefined();
  });

  it("follows the manifest it is given", () => {
    const pages: PageDef[] = [
      { id: "landing", title: "Home", path: "/", hotkey: "1", status: "live", channel: 1 },
      { id: "air", title: "Stage", path: "/air", hotkey: "S", status: "live" },
    ];
    expect(stripPages(pages).map((p) => p.id)).toEqual(["landing", "air"]);
    expect(litFrame("air", pages)).toBe("air");
  });

  it("names every frame by channel and title", () => {
    const find = (id: PageDef["id"]): PageDef => {
      const page = PAGES.find((p) => p.id === id);
      if (!page) throw new Error(`no page ${id}`);
      return page;
    };
    expect(frameLabel(find("characters"))).toBe("Channel 4, Characters: tonight's listings");
    expect(frameLabel(find("air"))).toBe("O, The stage: full screen, for the stream");
  });
});

describe("ChannelStrip stylesheet", () => {
  it("cools the lamp: every frame dims and none glows", () => {
    expect(css).toMatch(/\.strip\[data-lamp="cold"\] \.fr \{[^}]*--b: 0\.12;[^}]*filter: none;/);
  });

  it("shows keyboard focus on every frame", () => {
    expect(css).toMatch(/\.strip \.fr:focus-visible \{[^}]*outline: medium solid var\(--sr-accent\);/);
  });

  it("hides the stage strip until the top edge is hovered, focus is inside, or it is held open", () => {
    expect(css).toMatch(/\.stage \{[^}]*opacity: 0;/);
    expect(css).toMatch(/\.stage:hover,\s*\.stage:focus-within,\s*\.stage\[data-open\] \{[^}]*opacity: 1;/);
  });

  it("has a reduced-motion twin for every transition", () => {
    const transitioned = [...css.matchAll(/(\.[a-z]+(?:::before)?) \{[^}]*transition:(?! none)/g)].map((m) => m[1]);
    expect(transitioned.length).toBeGreaterThan(0);
    for (const sel of transitioned) {
      expect(css).toContain(`:global([data-motion="reduced"]) ${sel}`);
    }
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });
});

it("renders on the server with the frame variant open and the stage variant closed", () => {
  const frame = renderToString(<ChannelStrip variant="frame" current="landing" daemonLost={false} open />);
  expect(frame).toContain('data-strip="frame"');
  expect(frame).not.toContain("data-open");
  const stage = renderToString(<ChannelStrip variant="stage" current="air" daemonLost />);
  expect(stage).toContain('data-strip="stage"');
  expect(stage).toContain('data-lamp="cold"');
});
