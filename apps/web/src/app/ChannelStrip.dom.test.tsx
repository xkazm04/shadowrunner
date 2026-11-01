// @vitest-environment happy-dom
// The channel strip in the DOM (costume 1.3; requirement 2.1-2.4): one named link per frame, the
// current page's frame lit (a nested page lights its parent), the daemon-lost lamp, keyboard focus
// and activation, and the stage variant's `open`. The stylesheet rules are in ChannelStrip.test.tsx.
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ChannelStrip } from "./ChannelStrip";
import { mount, type Mounted } from "./testDom";

let mounted: Mounted | undefined;

afterEach(async () => {
  await mounted?.unmount();
  mounted = undefined;
  window.history.replaceState(null, "", "/");
});

const frames = (m: Mounted) => [...m.container.querySelectorAll<HTMLAnchorElement>("a[data-frame]")];

describe("<ChannelStrip>", () => {
  it("renders one named link per frame, the current one lit", async () => {
    mounted = await mount(<ChannelStrip variant="frame" current="characters" daemonLost={false} />);
    const nav = mounted.container.querySelector("nav");
    expect(nav?.getAttribute("aria-label")).toBe("Switch channel");
    expect(nav?.dataset.lamp).toBe("warm");
    const links = frames(mounted);
    expect(links.map((a) => a.textContent)).toEqual(["2", "3", "4", "6", "9", "O"]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/", "/creator", "/characters", "/daemon", "/sealed", "/air"]);
    for (const a of links) expect(a.getAttribute("aria-label")).toMatch(/^(Channel \d|O), /);
    const lit = links.filter((a) => a.getAttribute("aria-current") === "page");
    expect(lit.map((a) => a.dataset.frame)).toEqual(["characters"]);
  });

  it("lights CH 3 on Forge new", async () => {
    mounted = await mount(<ChannelStrip variant="frame" current="forge-new" daemonLost={false} />);
    expect(frames(mounted).find((a) => a.getAttribute("aria-current") === "page")?.dataset.frame).toBe("creator");
  });

  it("goes cold with the daemon, frames still links and still named", async () => {
    mounted = await mount(<ChannelStrip variant="frame" current="daemon" daemonLost />);
    expect(mounted.container.querySelector("nav")?.dataset.lamp).toBe("cold");
    expect(frames(mounted)).toHaveLength(6);
    for (const a of frames(mounted)) expect(a.getAttribute("aria-label")).toBeTruthy();
  });

  it("is keyboard operable: every frame takes focus, shows it, and a press tunes the channel", async () => {
    window.history.replaceState(null, "", "/characters");
    mounted = await mount(<ChannelStrip variant="frame" current="characters" daemonLost={false} />);
    for (const a of frames(mounted)) {
      expect(a.hasAttribute("tabindex")).toBe(false);
      a.focus();
      expect(document.activeElement).toBe(a);
    }
    const daemon = frames(mounted).find((a) => a.dataset.frame === "daemon");
    await act(async () => {
      daemon?.click();
    });
    expect(window.location.pathname).toBe("/daemon");
  });

  it("stage: hidden until the top edge is hovered, focus is inside, or `open` holds it", async () => {
    mounted = await mount(<ChannelStrip variant="stage" current="air" daemonLost={false} />);
    const nav = () => mounted?.container.querySelector("nav");
    expect(nav()?.dataset.strip).toBe("stage");
    expect(nav()?.hasAttribute("data-open")).toBe(false);
    await mounted.rerender(<ChannelStrip variant="stage" current="air" daemonLost={false} open />);
    expect(nav()?.hasAttribute("data-open")).toBe(true);
    // The frame variant ignores `open`: it is always shown.
    await mounted.rerender(<ChannelStrip variant="frame" current="air" daemonLost={false} open />);
    expect(nav()?.hasAttribute("data-open")).toBe(false);
  });

});
