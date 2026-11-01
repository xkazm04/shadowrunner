// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, type Mounted } from "../../app/testDom";
import { loadReplayJobs } from "../replayJobs";
import { testJob } from "../testFixtures";
import { entryOfJob, loadGallery, type GalleryEntry } from "./entries";
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
  it("lists Malakor and every committed recorded job, each a fictional rig", async () => {
    const entries = await loadGallery();
    const jobs = await loadReplayJobs();
    expect(entries[0]?.id).toBe("malakor");
    expect(entries.map((e) => e.id).sort()).toEqual(["malakor", ...jobs.map((j) => j.rig.id)].sort());
    for (const job of jobs) expect(job.rig.fictional).toBe(true);
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
});
