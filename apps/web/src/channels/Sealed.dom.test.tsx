// @vitest-environment happy-dom
// CH 9 (costume task 5.2): Space holds the knob; letting go collapses the tube; a warm tube going
// dark counts as tuned back and shows the reflection, stronger each time.
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PAGES, type PageDef } from "../app/pages";
import { mount, restoreMotion, setMotion, type Mounted } from "../app/testDom";
import { Sealed } from "./Sealed";
import { reflection } from "./SealedGlass";

const sealed = PAGES.find((p): p is PageDef => p.id === "sealed");

let view: Mounted | undefined;
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  restoreMotion();
  vi.restoreAllMocks();
});

async function key(type: "keydown" | "keyup", target: EventTarget = window): Promise<boolean> {
  const event = new KeyboardEvent(type, { key: " ", code: "Space", bubbles: true, cancelable: true });
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

describe("Sealed: hold to power", () => {
  it("powers on while Space is held and counts a warm switch-off as tuned back", async () => {
    if (!sealed) throw new Error("no sealed page");
    setMotion("reduced");
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    view = await mount(<Sealed page={sealed} />);
    const room = view.container.querySelector("[data-door]");
    const knob = view.container.querySelector("button[aria-pressed]");
    const counts = () => view?.container.querySelector("[data-counts]")?.textContent;

    expect(await key("keydown")).toBe(true);
    expect(room?.getAttribute("data-power")).toBe("on");
    expect(knob?.getAttribute("aria-pressed")).toBe("true");
    now += 200;
    await key("keyup");
    expect(room?.getAttribute("data-power")).toBe("off");
    expect(counts()).toBe("tuned in: 1tuned back: 0");
    expect(view.container.querySelector("[data-refl]")).toBeNull();

    await key("keydown");
    now += 900;
    await key("keyup");
    expect(counts()).toBe("tuned in: 2tuned back: 1");
    const refl = view.container.querySelector<HTMLElement>("[data-refl]");
    expect(refl?.style.getPropertyValue("--peak")).toBe(reflection(1).peak.toFixed(3));

    await key("keydown");
    now += 900;
    await key("keyup");
    expect(counts()).toBe("tuned in: 3tuned back: 2");
    const again = view.container.querySelector<HTMLElement>("[data-refl]");
    expect(Number(again?.style.getPropertyValue("--peak"))).toBeGreaterThan(reflection(1).peak);
  });

  it("leaves Space to a focused link", async () => {
    if (!sealed) throw new Error("no sealed page");
    view = await mount(<Sealed page={sealed} />);
    const link = view.container.querySelector("a");
    if (!link) throw new Error("no link");
    expect(await key("keydown", link)).toBe(false);
    expect(view.container.querySelector("[data-door]")?.getAttribute("data-power")).toBe("idle");
  });
});
