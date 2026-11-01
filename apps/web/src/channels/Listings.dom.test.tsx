// @vitest-environment happy-dom
// Landing task 12: CH 4 lists the whole cast. Malakor stays on now; every other cast member is a
// later hour with its portrait, persona hook, what it shows off and a deep link into the Forge.
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { mount, type Mounted } from "../app/testDom";
import { loadCast } from "../creator/gallery/entries";
import { Listings, type ListedCharacter } from "./Listings";

let view: Mounted | undefined;
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  window.history.replaceState(null, "", "/");
});

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const entries = (v: Mounted) => [...v.container.querySelectorAll<HTMLElement>("[data-character]")];

describe("Listings with the cast (CH 4)", () => {
  it("lists every recorded preset after Malakor, each from the notes, linking to the Forge with that character", async () => {
    view = await mount(<Listings loadCast={loadCast} />);
    await settle();
    const later = entries(view);
    expect(later.map((e) => e.dataset.character)).toEqual(["announcer-of-dead-air", "lantern-warden", "moth-widow", "sister-vesper", "understudy"]);
    const warden = later[1];
    expect(warden?.querySelector("p")?.textContent).toBe("05:00 · LATER · CH 3");
    expect(warden?.querySelector("h3")?.textContent).toBe("The Lantern Warden");
    expect(warden?.textContent).toContain("He counts the gourds every hour");
    expect(warden?.textContent).toContain("Shows off Hat and a lit jaw.");
    expect(warden?.querySelector("img")?.getAttribute("loading")).toBe("lazy");
    expect(warden?.querySelector("img")?.getAttribute("src")).toMatch(/lantern-warden\.webp/);
    expect(warden?.querySelector("a")?.getAttribute("href")).toBe("/creator?character=lantern-warden");
    // Malakor's own card gains what he shows off; the unclaimed hours follow the cast.
    expect(view.container.textContent).toContain("Shows offcrown shards, monocle");
    expect(view.container.textContent).toContain("09:00 · VACANT");
  });

  it("comes from the cast it is given, not a fixed list, and keeps the visitor's plane on the deep link", async () => {
    const cast: ListedCharacter[] = [
      { id: "malakor", slug: "malakor", name: "Arch-Lich Malakor", origin: "hand-rigged" },
      { id: "replay-a", slug: "a-ghost", name: "A Ghost", origin: "forged", hook: "boo." },
    ];
    window.history.replaceState(null, "", "/characters?plane=replay");
    view = await mount(<Listings loadCast={async () => cast} />);
    await settle();
    expect(entries(view).map((e) => e.dataset.character)).toEqual(["a-ghost"]);
    expect(view.container.textContent).toContain("Boo.");
    await act(async () => entries(view as Mounted)[0]?.querySelector("a")?.click());
    expect(`${window.location.pathname}${window.location.search}`).toBe("/creator?character=a-ghost&plane=replay");
    expect(view.container.textContent).toContain("05:00 · VACANT");
  });

  it("says so when the later hours do not load", async () => {
    view = await mount(<Listings loadCast={() => Promise.reject(new Error("offline"))} />);
    await settle();
    expect(view.container.textContent).toContain("did not come through");
  });
});
