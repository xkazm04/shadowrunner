// @vitest-environment happy-dom
// The daemon-lost choreography, the reduced-motion twin, the intro and the lazy fx chunk
// (landing tasks 8.2, 8.3), rendered with fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elapse, mount, press, restoreMotion, setMotion, settleImports, type Mounted } from "../app/testDom";
import { FOLD_MS, OUT_STEP_MS, RELIGHT_STEP_MS, relightMs } from "./daemon";
import { LIGHTS } from "./Gourds";
import { INTRO_MS, LandingPage, resetIntro } from "./LandingPage";

const fxLoads = vi.hoisted(() => ({ count: 0 }));
vi.mock(import("./fx"), async (importOriginal) => {
  fxLoads.count += 1;
  return importOriginal();
});

let m: Mounted;

const q = (selector: string) => m.container.querySelector<HTMLElement>(selector);
const all = (selector: string) => [...m.container.querySelectorAll<HTMLElement>(selector)];
const daemon = () => q('[data-page="landing"]')?.dataset.daemon;
const gourds = () => all("[data-channel]");
const delays = () => gourds().map((g) => g.style.getPropertyValue("--delay"));

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
    // No dust canvas; the only canvas is the set's live picture (avatar-renderer's own reduced motion).
    expect(all("canvas").filter((c) => c.closest("[data-avatar]") === null)).toEqual([]);
    expect(q("[data-typing]")).toBeNull();

    await m.rerender(<LandingPage plane="replay" daemonSample />);
    expect(daemon()).toBe("dark");
    expect(q("[data-no-carrier]")).not.toBeNull();
    expect(gourds().every((g) => g.dataset.light === "out")).toBe(true);
    expect(delays().every((d) => d === "0ms")).toBe(true);
    expect(q("[data-eye-note]")?.style.getPropertyValue("--stare")).toBe("0ms");
    expect(fxLoads.count).toBe(0);

    await m.rerender(<LandingPage plane="replay" />);
    expect(daemon()).toBe("online");
    expect(q("[data-carrier]")).toBeNull();
  });
});

describe("with motion", () => {
  beforeEach(() => {
    setMotion("full");
  });

  it("loads the fx chunk lazily, and draws dust on a canvas", async () => {
    m = await mount(<LandingPage plane="replay" />);
    await settleImports();
    // Imported (once per concurrent importer here; the build makes it one chunk).
    expect(fxLoads.count).toBeGreaterThan(0);
    expect(q('canvas[data-fx="dust"]')).not.toBeNull();
  });

  it("folds, goes dark light by light, keeps the eye, and relights in a sweep", async () => {
    m = await mount(<LandingPage plane="replay" />);
    await elapse(INTRO_MS);
    expect(daemon()).toBe("online");
    expect(gourds().map((g) => g.dataset.light)).toEqual(["burn", "ember", "ember", "ember", "ember"]);

    await m.rerender(<LandingPage plane="replay" daemonSample />);
    expect(daemon()).toBe("folding");
    expect(q('[data-carrier="folding"]')).not.toBeNull();
    expect(q("[data-lamp]")?.textContent).toBe("OFF AIR");
    expect(q("[data-no-carrier]")).toBeNull();
    // The candles hold until the picture is a dot.
    expect(gourds().every((g) => g.dataset.light !== "out")).toBe(true);

    await elapse(FOLD_MS);
    expect(daemon()).toBe("dark");
    expect(q("[data-no-carrier]")?.textContent).toBe("NO CARRIER" + "Press D to re-seat the daemon");
    expect(gourds().every((g) => g.dataset.light === "out")).toBe(true);
    // Right to left after the spiral (position 0, at once): 9 first, 2 last.
    expect(q("[data-room]")?.style.getPropertyValue("--delay")).toBe("0ms");
    expect(delays()).toEqual([5, 4, 3, 2, 1].map((n) => `${n * OUT_STEP_MS}ms`));
    // The buttons stay usable, and the current channel stays marked.
    expect(gourds().every((g) => g.tagName === "BUTTON" && !g.hasAttribute("disabled"))).toBe(true);
    expect(q('[aria-current="page"]')?.dataset.channel).toBe("2");
    expect(q("[data-eye-note]")?.textContent).toBe("IT IS STILL LOOKING");

    await m.rerender(<LandingPage plane="replay" />);
    expect(daemon()).toBe("relighting");
    expect(q("[data-lamp]")?.textContent).toBe("ON AIR");
    expect(q("[data-eye-note]")).toBeNull();
    expect(gourds().map((g) => g.dataset.light)).toEqual(["burn", "ember", "ember", "ember", "ember"]);
    expect(delays()).toEqual([1, 2, 3, 4, 5].map((n) => `${n * RELIGHT_STEP_MS}ms`));

    await elapse(relightMs(LIGHTS));
    expect(daemon()).toBe("online");
    expect(q("[data-carrier]")).toBeNull();
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
    expect(q("[data-intro-shade]")).not.toBeNull();
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
