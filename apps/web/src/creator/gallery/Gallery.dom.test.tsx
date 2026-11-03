// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, type Mounted } from "../../app/testDom";
import { loadReplayJobs } from "../replayJobs";
import { testJob } from "../testFixtures";
import { castBriefSlugs } from "./castBriefs";
import { entryOfJob, loadCast, loadGallery, type GalleryEntry } from "./entries";
import { Gallery } from "./Gallery";

let view: Mounted | undefined;
afterEach(async () => {
  await view?.unmount();
  view = undefined;
});

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("gallery entries", () => {
  it("the gallery's default cast names every character once (no second, recorded Malakor)", async () => {
    const cast = await loadCast();
    const names = cast.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
    expect(cast.filter((e) => e.slug === "malakor")).toHaveLength(1);
    expect(cast[0]?.origin).toBe("hand-rigged");
  });

  it("lists Malakor and every committed recorded job, each a fictional rig", async () => {
    const entries = await loadGallery();
    const jobs = await loadReplayJobs();
    expect(entries[0]?.id).toBe("malakor");
    expect(entries.map((e) => e.id).sort()).toEqual(["malakor", ...jobs.map((j) => j.rig.id)].sort());
    for (const job of jobs) expect(job.rig.fictional).toBe(true);
  });

  it("lists the eight cast-forge characters with their brief's hook and style, adopted on demand", async () => {
    const cast = await loadCast();
    const slugs = castBriefSlugs();
    expect(slugs).toEqual(["auntie-asp", "lot-ninety", "reveille", "saint-cardia", "sir-vacant", "the-redactor", "the-tallyman", "vicar-of-the-lure"]);
    for (const slug of slugs) {
      const entry = cast.find((e) => e.slug === slug);
      expect(entry?.onDemand).toBe(true);
      expect(entry?.hook?.length).toBeGreaterThan(40);
      expect(entry?.portraitUrl).toBeDefined();
    }
    expect(cast.find((e) => e.slug === "the-tallyman")?.hook).toContain("six eyes");
    expect(cast.find((e) => e.slug === "vicar-of-the-lure")?.showsOff).toBe("Leaded stained glass");
    // The presets and Malakor are still seeded in the background.
    expect(cast.filter((e) => e.onDemand !== true).map((e) => e.slug)).toContain("moth-widow");
    expect(cast.filter((e) => e.onDemand !== true)).toHaveLength(cast.length - 8);
  });

  it("leaves out a recorded rig that is not fictional", async () => {
    const real = testJob("someone");
    const rig = { ...real.rig };
    delete rig.fictional;
    const entries = await loadGallery(async () => [testJob("ghost"), { ...real, rig }]);
    expect(entries.map((e) => e.id)).not.toContain("replay-someone");
  });

  it("an entry loads into a library record with every layer image and a default look", async () => {
    const record = await entryOfJob(testJob()).load();
    expect(record.id).toBe("replay-test-ghost");
    expect(Object.keys(record.assets).sort()).toEqual(record.rig.layers.map((l) => l.file).sort());
    expect(record.look.hidden).toEqual([]);
  });
});

describe("<Gallery>", () => {
  const entries: GalleryEntry[] = [entryOfJob(testJob("ghost-a")), { ...entryOfJob(testJob("ghost-b")), name: "Ghost B" }];

  it("by default lists each character once, the hand-rigged Malakor and no recorded twin", async () => {
    view = await mount(<Gallery inLibrary={new Set()} onAdopt={async () => undefined} onClose={() => undefined} />);
    await settle();
    await settle();
    const labels = [...view.container.querySelectorAll<HTMLButtonElement>("li button")].map((b) => b.getAttribute("aria-label") ?? "");
    expect(labels.length).toBeGreaterThan(1);
    expect(labels.filter((l) => l.includes("Malakor"))).toHaveLength(1);
  });

  it("adopts a character, and marks one already in the library", async () => {
    const onAdopt = vi.fn(async () => undefined);
    view = await mount(<Gallery inLibrary={new Set(["replay-ghost-b"])} onAdopt={onAdopt} onClose={() => undefined} load={async () => entries} />);
    await settle();
    const buttons = [...view.container.querySelectorAll<HTMLButtonElement>("li button")];
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Adopt Test Ghost", "Ghost B is in your library"]);
    expect(buttons[1]?.disabled).toBe(true);
    await act(async () => buttons[0]?.click());
    expect(onAdopt).toHaveBeenCalledWith(entries[0]);
    expect(view.container.textContent).toContain("RECORDED");
  });

  it("puts a character already in the library on the stage, and names what each card shows off", async () => {
    const onShow = vi.fn();
    view = await mount(<Gallery inLibrary={new Set(["replay-ghost-b"])} onAdopt={async () => undefined} onShow={onShow} onClose={() => undefined} load={async () => entries} />);
    await settle();
    const kept = [...view.container.querySelectorAll<HTMLButtonElement>("li button")][1];
    expect(kept?.getAttribute("aria-label")).toBe("Ghost B is in your library. Put it on the stage");
    await act(async () => kept?.click());
    expect(onShow).toHaveBeenCalledWith("replay-ghost-b");
    // No notes for the test ghost: the card names its rig's animated kinds.
    expect(view.container.textContent).toContain("crown · accessory · jaw · eyes");
  });

  it("says when an adoption fails, and closes on request", async () => {
    const onClose = vi.fn();
    view = await mount(<Gallery inLibrary={new Set()} onAdopt={async () => Promise.reject(new Error("x"))} onClose={onClose} load={async () => entries} />);
    await settle();
    await act(async () => view?.container.querySelector<HTMLButtonElement>("li button")?.click());
    await settle();
    expect(view.container.textContent).toContain("could not be read");
    const close = [...view.container.querySelectorAll("button")].find((b) => b.textContent === "Close");
    await act(async () => close?.click());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("tells the persona hook of the card under the pointer or focus in the caption", async () => {
    const told: GalleryEntry[] = [{ ...entries[0], hook: "Counts the audience out loud." } as GalleryEntry, entries[1] as GalleryEntry];
    view = await mount(<Gallery inLibrary={new Set()} onAdopt={async () => undefined} onClose={() => undefined} load={async () => told} />);
    await settle();
    const card = view.container.querySelector<HTMLButtonElement>("li button");
    expect(view.container.querySelector("[data-hook]")).toBeNull();
    await act(async () => card?.focus());
    expect(view.container.querySelector("[data-hook]")?.textContent).toBe("Test Ghost. Counts the audience out loud.");
    expect(card?.getAttribute("aria-describedby")).toBe("hook-replay-ghost-a");
  });
});
