// @vitest-environment happy-dom
// The daemon sample key (landing task 8.1): D plays the daemon-lost state on replay, and changes
// nothing on live. Each test imports a fresh Shell, so the plane store reads its own health stub.
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
