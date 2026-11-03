// @vitest-environment happy-dom
// costume 5.1: CH 4 is the wall of sets. Malakor's big set is on now; every other cast member is
// a later hour's set with its cast still; then the vacant hour and channel 9. Clicking a set pins
// its listing (copy from the listings data) to the clipping with its Forge / Watch actions.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mount, restoreMotion, setMotion, type Mounted } from "../app/testDom";
import { loadCast } from "../creator/gallery/entries";
import { Listings, type ListedCharacter } from "./Listings";

let view: Mounted | undefined;
beforeEach(() => setMotion("reduced"));
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  restoreMotion();
  window.history.replaceState(null, "", "/");
});

/** Ticks until the wall is no longer busy (the cast has loaded), at least 10, at most SETTLE_TICKS: a fixed count raced the recorded jobs' load under a full run. */
const SETTLE_TICKS = 400;
async function settle(): Promise<void> {
  for (let i = 0; i < SETTLE_TICKS; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    if (i >= 10 && view?.container.querySelector('[aria-busy="true"]') === null) return;
  }
}

const noLive = () => null;
const sets = (v: Mounted) => [...v.container.querySelectorAll<HTMLButtonElement>("[data-set]")];
const clip = (v: Mounted) => v.container.querySelector("aside");

async function press(v: Mounted, key: string): Promise<void> {
  await act(async () => v.container.querySelector<HTMLButtonElement>(`[data-set="${key}"]`)?.click());
}

describe("Listings as the wall of sets (CH 4)", () => {
  it("hangs Malakor's set first, the cast in hour order, then the next hour vacant and CH 9 sealed", async () => {
    view = await mount(<Listings loadCast={loadCast} liveTube={noLive} />);
    await settle();
    const wall = sets(view);
    expect(wall.map((s) => s.getAttribute("aria-label")?.split(", ").slice(0, 2).join(", "))).toEqual([
      "03:00, Arch-Lich Malakor",
      "04:00, Announcer of Dead Air",
      "05:00, The Lantern Warden",
      "06:00, The Moth Widow",
      "07:00, The Redactor",
      // The label is split on ", ", and this name holds one.
      "08:00, Reveille",
      "09:00, Saint Cardia of the Glass Heart",
      "10:00, Sister Vesper",
      "11:00, The Tallyman",
      "12:00, The Understudy",
      "13:00, Vicar of the Lure",
      "14:00, before the boiler wakes",
      "Channel 9, not built yet",
    ]);
    expect(wall.map((s) => s.dataset.kind)).toEqual(["live", "cast", "cast", "cast", "cast", "cast", "cast", "cast", "cast", "cast", "cast", "vacant", "sealed"]);
    expect(wall[0]?.getAttribute("aria-label")).toBe("03:00, Arch-Lich Malakor, on air now");
    expect(wall[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(wall[2]?.getAttribute("aria-label")).toBe("05:00, The Lantern Warden, later tonight");
    expect(wall[2]?.querySelector("img")?.getAttribute("src")).toMatch(/lantern-warden\.webp/);
    expect(wall[11]?.textContent).toContain("14:00 · VACANT");
    expect(wall[12]?.textContent).toContain("CH 9 · SEALED");
    expect(wall[12]?.textContent).toContain("NOT BUILT YET");
    // The clipping opens on Malakor, from his bible, with what he shows off.
    expect(clip(view)?.textContent).toContain("03:00 · ON AIR NOW · CH 2");
    expect(clip(view)?.textContent).toContain("High Auditor of the Obsidian Spire");
    expect(clip(view)?.textContent).toContain("Shows offcrown shards, monocle");
    expect(clip(view)?.querySelector('a[href="/creator?character=malakor"]')?.textContent).toBe("Open in the Forge · CH 3");
    expect(clip(view)?.querySelector('a[href="/"]')?.textContent).toBe("Watch · CH 2");
  });

  it("pins the clicked set's listing, from the notes, with its Forge link", async () => {
    view = await mount(<Listings loadCast={loadCast} liveTube={noLive} />);
    await settle();
    const warden = sets(view).find((s) => s.getAttribute("aria-label")?.includes("Lantern Warden"));
    await act(async () => warden?.click());
    expect(warden?.getAttribute("aria-pressed")).toBe("true");
    expect(sets(view)[0]?.getAttribute("aria-pressed")).toBe("false");
    const text = clip(view)?.textContent ?? "";
    expect(text).toContain("05:00 · LATER · CH 3");
    expect(text).toContain("The Lantern Warden");
    expect(text).toContain("He counts the gourds every hour");
    expect(text).toContain("Shows offHat and a lit jaw.");
    expect(clip(view)?.querySelector("a")?.getAttribute("href")).toBe("/creator?character=lantern-warden");

    await press(view, "vacant");
    expect(clip(view)?.textContent).toContain("The last hour of the night is unclaimed.");
    expect(clip(view)?.querySelector("a")?.getAttribute("href")).toBe("/creator/new");
    await press(view, "sealed");
    expect(clip(view)?.textContent).toContain("Nothing is broadcast on nine.");
    expect(clip(view)?.querySelector("a")?.getAttribute("href")).toBe("/sealed");
  });

  it("comes from the cast it is given and keeps the visitor's plane on the deep link", async () => {
    const cast: ListedCharacter[] = [
      { id: "malakor", slug: "malakor", name: "Arch-Lich Malakor", origin: "hand-rigged" },
      { id: "replay-a", slug: "a-ghost", name: "A Ghost", origin: "forged", hook: "boo." },
    ];
    window.history.replaceState(null, "", "/characters?plane=replay");
    view = await mount(<Listings loadCast={async () => cast} liveTube={noLive} />);
    await settle();
    expect(sets(view).map((s) => s.dataset.kind)).toEqual(["live", "cast", "vacant", "sealed"]);
    expect(sets(view)[2]?.textContent).toContain("05:00 · VACANT");
    await press(view, "cast-replay-a");
    expect(clip(view)?.textContent).toContain("Boo.");
    await act(async () => clip(view as Mounted)?.querySelector("a")?.click());
    expect(`${window.location.pathname}${window.location.search}`).toBe("/creator?character=a-ghost&plane=replay");
  });

  it("keeps Malakor on air and says so when the later hours do not load", async () => {
    view = await mount(<Listings loadCast={() => Promise.reject(new Error("offline"))} liveTube={noLive} />);
    await settle();
    expect(sets(view).map((s) => s.dataset.kind)).toEqual(["live", "vacant", "sealed"]);
    expect(clip(view)?.textContent).toContain("did not come through");
    expect(view.container.querySelector("[data-page]")?.getAttribute("data-phase")).toBe("idle");
  });

  it("powers the sets on in order under full motion: dark, boot, then ON AIR", async () => {
    setMotion("full");
    let release: (list: readonly ListedCharacter[]) => void = () => undefined;
    const pending = new Promise<readonly ListedCharacter[]>((r) => {
      release = r;
    });
    view = await mount(<Listings loadCast={() => pending} liveTube={noLive} />);
    const page = () => view?.container.querySelector("[data-page]");
    expect(page()?.getAttribute("data-phase")).toBe("dark");
    expect(sets(view).map((s) => s.dataset.kind)).toEqual(["live"]);
    await act(async () => release(await loadCast()));
    await settle();
    expect(page()?.getAttribute("data-phase")).toBe("boot");
    const delays = sets(view).map((s) => parseFloat(s.style.getPropertyValue("--wall-bd")));
    expect(Math.max(...delays)).toBe(delays[0]);
  });
});
