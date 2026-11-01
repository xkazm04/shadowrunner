// @vitest-environment happy-dom
// The daemon sample key (landing task 8.1): D plays the daemon-lost state on replay, and changes
// nothing on live. Each test imports a fresh Shell, so the plane store reads its own health stub.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, press, restoreMotion, setMotion, type Mounted } from "./testDom";

async function freshShell(health: object | undefined): Promise<Mounted> {
  vi.resetModules();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      health === undefined
        ? Promise.reject(new Error("no functions here"))
        : new Response(JSON.stringify(health), { status: 200, headers: { "content-type": "application/json" } }),
    ),
  );
  const { Shell } = await import("./Shell");
  return mount(<Shell />);
}

const landing = (m: Mounted) => m.container.querySelector<HTMLElement>('[data-page="landing"]');

let mounted: Mounted | undefined;

beforeEach(() => {
  // Reduced motion: the daemon's switches are instant, so the state is readable at once.
  setMotion("reduced");
});

afterEach(async () => {
  await mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  restoreMotion();
});

describe("Shell: D, the daemon sample", () => {
  it("on replay toggles the set into the daemon-lost state and back", async () => {
    mounted = await freshShell(undefined);
    const m = mounted;
    await vi.waitFor(() => expect(m.container.querySelector('[data-plane="replay"]')).not.toBeNull());
    expect(landing(m)?.dataset.daemon).toBe("online");

    expect(await press("d")).toBe(true);
    expect(landing(m)?.dataset.daemon).toBe("dark");
    expect(m.container.querySelector('[data-lamp="off"]')?.textContent).toBe("OFF AIR");
    expect(m.container.querySelector("[data-no-carrier]")?.textContent).toContain("Press D to re-seat the daemon");
    expect(m.container.querySelector('[role="status"]')?.textContent).toContain("DAEMON LOST");

    expect(await press("D")).toBe(true);
    expect(landing(m)?.dataset.daemon).toBe("online");
    expect(m.container.querySelector("[data-no-carrier]")).toBeNull();
  });

  it("on live changes nothing and leaves the key unhandled", async () => {
    mounted = await freshShell({ plane: "live", engine: "anthropic", version: "test" });
    const m = mounted;
    await vi.waitFor(() => expect(m.container.querySelector('[data-plane="live"]')).not.toBeNull());
    const before = m.container.innerHTML;
    expect(landing(m)?.dataset.daemon).toBe("online");

    expect(await press("d")).toBe(false);
    expect(await press("D")).toBe(false);
    expect(landing(m)?.dataset.daemon).toBe("online");
    expect(m.container.querySelector("[data-no-carrier]")).toBeNull();
    // Nothing else moved either (the clock ticks each second; this runs well inside one).
    expect(m.container.innerHTML).toBe(before);
  });

  it("on live, a real engine loss still shows, with no D to press", async () => {
    mounted = await freshShell({ plane: "live", engine: "offline", version: "test" });
    const m = mounted;
    await vi.waitFor(() => expect(landing(m)?.dataset.daemon).toBe("dark"));
    expect(m.container.querySelector("[data-no-carrier]")?.textContent).toContain("Waiting for the daemon to return");
    expect(await press("d")).toBe(false);
    expect(landing(m)?.dataset.daemon).toBe("dark");
    const keys = [...m.container.querySelectorAll("[data-status-bar] kbd, [data-legend] kbd")].map((k) => k.textContent);
    expect(keys).not.toContain("D");
  });
});

/** Opens the shell at `path` (replay: no functions answer). */
async function shellAt(path: string): Promise<Mounted> {
  window.history.replaceState(null, "", path);
  return freshShell(undefined);
}

async function pressCtrl(key: string): Promise<boolean> {
  const event = new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true });
  await act(async () => {
    window.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

describe("Shell: Esc and the dial (landing task 9)", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("Esc closes Go to first, then returns to the set", async () => {
    mounted = await shellAt("/characters");
    const m = mounted;
    expect(m.container.querySelector('[data-channel-frame="characters"]')).not.toBeNull();
    expect(await pressCtrl("k")).toBe(true);
    expect(m.container.querySelector('[role="dialog"]')).not.toBeNull();

    expect(await press("Escape")).toBe(true);
    expect(m.container.querySelector('[role="dialog"]')).toBeNull();
    expect(window.location.pathname).toBe("/characters");

    expect(await press("Escape")).toBe(true);
    expect(window.location.pathname).toBe("/");
    expect(m.container.querySelector('[data-page="landing"]')).not.toBeNull();
  });

  it("CH 2 on the frame's channel strip returns to the set too (costume 1.3)", async () => {
    mounted = await shellAt("/daemon");
    const m = mounted;
    const back = m.container.querySelector<HTMLAnchorElement>('[data-strip="frame"] a[data-frame="landing"]');
    expect(back?.getAttribute("aria-label")).toBe("Channel 2, On air: the cellar set");
    await act(async () => {
      back?.click();
    });
    expect(window.location.pathname).toBe("/");
    expect(m.container.querySelector('[data-page="landing"]')).not.toBeNull();
  });

  it("N opens Forge new, off the dial: arrows do nothing there (costume 1.2)", async () => {
    mounted = await shellAt("/");
    expect(await press("n")).toBe(true);
    expect(window.location.pathname).toBe("/creator/new");
    expect(mounted.container.querySelector('[data-channel-frame="forge-new"]')).not.toBeNull();
    expect(await press("ArrowRight")).toBe(false);
    expect(window.location.pathname).toBe("/creator/new");
  });

  it("← and → turn the dial and wrap around it", async () => {
    mounted = await shellAt("/");
    const dial = ["/", "/creator", "/characters", "/daemon", "/sealed"];
    for (const expected of [...dial.slice(1), "/"]) {
      expect(await press("ArrowRight")).toBe(true);
      expect(window.location.pathname).toBe(expected);
    }
    // From 2, left wraps to 9.
    expect(await press("ArrowLeft")).toBe(true);
    expect(window.location.pathname).toBe("/sealed");
    expect(mounted.container.querySelector('[data-door="sealed"]')).not.toBeNull();
  });

  it("arrows do nothing on the stage (/air), which is off the dial", async () => {
    mounted = await shellAt("/air");
    expect(await press("ArrowRight")).toBe(false);
    expect(await press("ArrowLeft")).toBe(false);
    expect(window.location.pathname).toBe("/air");
  });

  it("D on CH 6 cuts the carrier on the test card, on replay", async () => {
    mounted = await shellAt("/daemon");
    const m = mounted;
    await vi.waitFor(() => expect(m.container.querySelector('[data-plane="replay"]')).not.toBeNull());
    expect(m.container.querySelector('[data-page="daemon"]')?.getAttribute("data-daemon")).toBe("online");
    expect(await press("d")).toBe(true);
    expect(m.container.querySelector('[data-page="daemon"]')?.getAttribute("data-daemon")).toBe("lost");
    expect(m.container.textContent).toContain("press D to re-seat it");
  });
});
