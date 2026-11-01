// @vitest-environment happy-dom
// The daemon-lost choreography, the reduced-motion twin, the pulled slide's projection, the intro
// and the lazy fx chunk (costume task 2), rendered with fake timers.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elapse, mount, press, restoreMotion, setMotion, settleImports, type Mounted } from "../app/testDom";
import { FOLD_MS, OUT_STEP_MS, RELIGHT_STEP_MS, relightMs } from "./daemon";
import { INTRO_MS, LandingPage, resetIntro } from "./LandingPage";
import { LIGHTS, TRAY } from "./slides";

const fxLoads = vi.hoisted(() => ({ count: 0 }));
vi.mock(import("./fx"), async (importOriginal) => {
  fxLoads.count += 1;
  return importOriginal();
});

let m: Mounted;

const q = (selector: string) => m.container.querySelector<HTMLElement>(selector);
const all = (selector: string) => [...m.container.querySelectorAll<HTMLElement>(selector)];
const daemon = () => q('[data-page="landing"]')?.dataset.daemon;
const slides = () => all("[data-slide]");
const delays = () => slides().map((s) => s.style.getPropertyValue("--delay"));
const lantern = () => q("[data-lantern]")?.dataset.lantern;

async function pull(id: string): Promise<void> {
  const slide = q(`[data-slide="${id}"]`);
  expect(slide, id).not.toBeNull();
  await act(async () => {
    slide?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    slide?.dispatchEvent(new PointerEvent("pointerenter", { bubbles: false }));
  });
}

async function release(id: string): Promise<void> {
  const slide = q(`[data-slide="${id}"]`);
  await act(async () => {
    slide?.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
    slide?.dispatchEvent(new PointerEvent("pointerleave", { bubbles: false }));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("no functions here"))));
  resetIntro();
});

afterEach(async () => {
  await m.unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  restoreMotion();
});

describe("reduced motion: the static twin", () => {
  it("renders no animated nodes, loads no fx, plays no intro, and switches the daemon instantly", async () => {
    setMotion("reduced");
    m = await mount(<LandingPage plane="replay" />);
    await settleImports();
    expect(fxLoads.count).toBe(0);
    expect(q("[data-intro]")).toBeNull();
    expect(q("[data-intro-shade]")).toBeNull();
    // The only canvas is the face's (avatar-renderer's own reduced motion).
    expect(all("canvas").filter((c) => c.closest("[data-avatar]") === null)).toEqual([]);
    expect(q("[data-typing]")).toBeNull();

    await m.rerender(<LandingPage plane="replay" daemonSample />);
    expect(daemon()).toBe("dark");
    expect(q("[data-no-carrier]")?.style.getPropertyValue("--stare")).toBe("0ms");
    expect(lantern()).toBe("cold");
    expect(delays().every((d) => d === "0ms")).toBe(true);
    expect(fxLoads.count).toBe(0);

    await m.rerender(<LandingPage plane="replay" />);
    expect(daemon()).toBe("online");
    expect(q("[data-no-carrier]")).toBeNull();
    expect(lantern()).toBe("lit");
  });
});

describe("the slide tray and the lantern", () => {
  beforeEach(() => {
    setMotion("reduced");
  });

  it("projects a pulled slide's still on the wall, chalks its name, and puts it back on release", async () => {
    m = await mount(<LandingPage plane="replay" />);
    expect(q("[data-projection]")).toBeNull();
    await pull("characters");
    expect(q("[data-projection]")?.dataset.projection).toBe("characters");
    expect(q('[data-projection] [data-still="characters"]')).not.toBeNull();
    expect(q("[data-beam]")).not.toBeNull();
    expect(q("[data-hint]")?.textContent).toBe("4 · Characters — tonight's listings");
    await release("characters");
    expect(q("[data-projection]")).toBeNull();
    expect(q("[data-beam]")).toBeNull();
    expect(q("[data-hint]")).toBeNull();
  });

  it("never projects the channel you are standing in", async () => {
    m = await mount(<LandingPage plane="replay" />);
    await pull("landing");
    expect(q("[data-projection]")).toBeNull();
    expect(q("[data-hint]")?.textContent).toContain("2 · On air");
  });

  it("projects nothing while the daemon is lost, though the slides stay working links", async () => {
    m = await mount(<LandingPage plane="replay" daemonSample />);
    await pull("daemon");
    expect(q("[data-projection]")).toBeNull();
    expect(slides().every((s) => s.tagName === "A" && s.getAttribute("href")?.startsWith("/"))).toBe(true);
    expect(q('[aria-current="page"]')?.dataset.slide).toBe("landing");
  });

  it("names every slide for assistive tech, the stage by its key", async () => {
    m = await mount(<LandingPage plane="replay" />);
    expect(slides().map((s) => s.getAttribute("aria-label"))).toEqual(
      TRAY.map((p) =>
        p.channel === undefined ? `${p.hotkey}, ${p.title}: ${p.subtitle}` : `Channel ${p.channel}, ${p.title}: ${p.subtitle}`,
      ),
    );
  });
});

describe("with motion", () => {
  beforeEach(() => {
    setMotion("full");
  });

  it("loads the fx chunk lazily and lets the cellar flicker", async () => {
    m = await mount(<LandingPage plane="replay" />);
    await settleImports();
    expect(fxLoads.count).toBeGreaterThan(0);
    expect(q("[data-cellar]")?.hasAttribute("data-flame")).toBe(true);
  });

  it("folds the face, cools the lantern slide by slide, chalks the ghost note, and relights in a sweep", async () => {
    m = await mount(<LandingPage plane="replay" />);
    await elapse(INTRO_MS);
    expect(daemon()).toBe("online");
    expect(q("[data-lamp]")?.textContent).toBe("ON AIR");

    await m.rerender(<LandingPage plane="replay" daemonSample />);
    expect(daemon()).toBe("folding");
    expect(q("[data-apparition]")?.dataset.daemon).toBe("folding");
    expect(q("[data-lamp]")?.textContent).toBe("OFF AIR");
    expect(q("[data-cellar]")?.dataset.spill).toBe("off");
    expect(q("[data-no-carrier]")).toBeNull();
    // The slides hold until the picture is a dot.
    expect(lantern()).toBe("lit");

    await elapse(FOLD_MS);
    expect(daemon()).toBe("dark");
    expect(lantern()).toBe("cold");
    expect(q("[data-no-carrier]")?.textContent).toMatch(/^he was right hereDead air \d\d:\d\d:\d\d · Press D to re-seat the daemon$/);
    // Right to left after the lantern (position 0, at once): the stage first, On air last.
    expect(q("[data-cellar]")?.style.getPropertyValue("--delay")).toBe("0ms");
    expect(delays()).toEqual([6, 5, 4, 3, 2, 1].map((n) => `${n * OUT_STEP_MS}ms`));
    expect(q("[data-chat]")?.textContent).toContain("PAUSED · NO CARRIER");

    await m.rerender(<LandingPage plane="replay" />);
    expect(daemon()).toBe("relighting");
    expect(q("[data-lamp]")?.textContent).toBe("ON AIR");
    expect(q("[data-no-carrier]")).toBeNull();
    expect(lantern()).toBe("lit");
    expect(delays()).toEqual([1, 2, 3, 4, 5, 6].map((n) => `${n * RELIGHT_STEP_MS}ms`));

    await elapse(relightMs(LIGHTS));
    expect(daemon()).toBe("online");
  });

  it("counts the same dead air in the bar and the ghost note", async () => {
    m = await mount(<LandingPage plane="replay" daemonSample />);
    await elapse(FOLD_MS);
    await elapse(5000);
    const clocks = all("[data-clock]").map((c) => c.textContent);
    expect(clocks).toHaveLength(2);
    expect(clocks[0]).toBe(clocks[1]);
  });

  it("holds the chat while the daemon is lost", async () => {
    m = await mount(<LandingPage plane="replay" daemonSample />);
    await settleImports();
    await elapse(FOLD_MS);
    const before = q("[data-chat-lines]")?.innerHTML;
    await elapse(60_000);
    expect(q("[data-chat-lines]")?.innerHTML).toBe(before);
  });
});

describe("the intro", () => {
  beforeEach(() => {
    setMotion("full");
  });

  it("hands over within 4 s on its own", async () => {
    expect(INTRO_MS).toBeLessThanOrEqual(4000);
    m = await mount(<LandingPage plane="replay" />);
    expect(q("[data-intro]")).not.toBeNull();
    expect(q("[data-intro-shade]")?.textContent).toBe("You opened the cellar.");
    await elapse(INTRO_MS - 1);
    expect(q("[data-intro]")).not.toBeNull();
    await elapse(1);
    expect(q("[data-intro]")).toBeNull();
  });

  it("is skipped by any key or click without consuming it, and never replays", async () => {
    m = await mount(<LandingPage plane="replay" />);
    expect(await press("x")).toBe(false);
    expect(q("[data-intro]")).toBeNull();
    await m.unmount();

    // Back on the set later in the visit: no intro, nothing pulls the visitor back.
    m = await mount(<LandingPage plane="replay" />);
    expect(q("[data-intro]")).toBeNull();
    await m.unmount();

    resetIntro();
    m = await mount(<LandingPage plane="replay" />);
    expect(q("[data-intro]")).not.toBeNull();
    window.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await elapse(0);
    expect(q("[data-intro]")).toBeNull();
  });
});
