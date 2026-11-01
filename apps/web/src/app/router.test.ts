import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PAGES } from "./pages";
import { handleLinkClick, matchPage, navigate, normalizePath } from "./router";

describe("normalizePath", () => {
  it("is idempotent, rooted, and blind to repeated or trailing slashes", () => {
    const segment = fc.stringMatching(/^[a-z0-9-]{1,6}$/);
    fc.assert(
      fc.property(fc.array(segment, { maxLength: 4 }), fc.nat(2), fc.nat(2), (segs, lead, trail) => {
        const messy = `${"/".repeat(lead)}${segs.join("//")}${"/".repeat(trail)}`;
        const clean = normalizePath(messy);
        expect(clean).toBe(`/${segs.join("/")}`);
        expect(normalizePath(clean)).toBe(clean);
      }),
    );
  });

  it("drops the query and hash", () => {
    expect(normalizePath("/air?plane=replay#top")).toBe("/air");
  });
});

describe("matchPage", () => {
  it("finds every manifest page by its path, with or without a trailing slash", () => {
    for (const page of PAGES) {
      expect(matchPage(PAGES, page.path)?.id).toBe(page.id);
      expect(matchPage(PAGES, `${page.path}/`)?.id).toBe(page.id);
    }
  });

  it("matches nothing for an unknown path", () => {
    expect(matchPage(PAGES, "/cellar/door")).toBeUndefined();
  });
});

/** A window with just enough location/history/event plumbing for navigate(). */
function fakeWindow(href: string) {
  const url = new URL(href);
  const events: string[] = [];
  const location = {
    get href() {
      return url.href;
    },
    get pathname() {
      return url.pathname;
    },
    get search() {
      return url.search;
    },
    get hash() {
      return url.hash;
    },
  };
  const move = (_: unknown, __: string, next: string) => {
    const to = new URL(next, url);
    url.pathname = to.pathname;
    url.search = to.search;
    url.hash = to.hash;
  };
  const history = { pushState: vi.fn(move), replaceState: vi.fn(move) };
  const win = { location, history, dispatchEvent: (e: Event) => events.push(e.type) > 0 };
  vi.stubGlobal("window", win);
  return { win, events, history };
}

describe("navigate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pushes the new path, keeps ?plane=, and notifies", () => {
    const { win, events, history } = fakeWindow("https://sr.test/?plane=replay");
    navigate("/creator");
    expect(history.pushState).toHaveBeenCalledOnce();
    expect(`${win.location.pathname}${win.location.search}`).toBe("/creator?plane=replay");
    expect(events).toEqual(["sr:navigate"]);
  });

  it("uses the target's own query when it has one, and replaces on request", () => {
    const { win, history } = fakeWindow("https://sr.test/?plane=replay");
    navigate("/air?plane=live", { replace: true });
    expect(history.replaceState).toHaveBeenCalledOnce();
    expect(history.pushState).not.toHaveBeenCalled();
    expect(win.location.search).toBe("?plane=live");
  });

  it("adds no history entry when already there", () => {
    const { history, events } = fakeWindow("https://sr.test/daemon");
    navigate("/daemon");
    expect(history.pushState).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});

describe("handleLinkClick", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const click = (over: Partial<Parameters<typeof handleLinkClick>[0]> = {}) => ({
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    preventDefault: vi.fn(),
    ...over,
  });

  it("navigates in place on a plain left click", () => {
    const { history } = fakeWindow("https://sr.test/");
    const event = click();
    handleLinkClick(event, "/sealed");
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(history.pushState).toHaveBeenCalledOnce();
  });

  it("leaves modified and non-primary clicks to the browser", () => {
    const { history } = fakeWindow("https://sr.test/");
    for (const over of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      const event = click(over);
      handleLinkClick(event, "/sealed");
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(history.pushState).not.toHaveBeenCalled();
  });
});
