// @vitest-environment happy-dom
// Costume 3.2: the rite with the replay client and fake timers. The slots fill as the statuses
// arrive, a finished job is kept bound as chosen and handed to /creator, a real face is refused with
// the API's refused_likeness copy and the words are kept, and the other failures land on Forge.
import type { AvatarCanvasProps } from "@sr/avatar";
import type { ForgeErrorCode } from "@sr/forge/wire";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elapse, mount, type Mounted } from "../../app/testDom";
import { JOB_KEY } from "../forge/useForgeJob";
import type { ForgeClient } from "../forgeClient";
import { createReplayForgeClient, FAIL_MESSAGES } from "../forgeClient.replay";
import { memoryLibrary, type LibraryStore } from "../library/libraryStore";
import { testJob } from "../testFixtures";
import { RitePage } from "./RitePage";

vi.mock(import("../../app/plane"), async (original) => ({ ...(await original()), usePlane: () => "replay" as const }));
vi.mock(import("@sr/avatar"), () => ({ AvatarCanvas: (props: AvatarCanvasProps) => <div data-avatar="" data-rig={props.rig.id} /> }));
vi.mock(import("../library/assets"), async (original) => ({
  ...(await original()),
  rigAssetsOf: async () => ({}),
  urlsToBlobs: async (urls: Readonly<Record<string, string>>) => Object.fromEntries(Object.keys(urls).map((f) => [f, new Blob(["x"])])),
}));

const JOB = testJob("ghost-a");
const jobs = async () => [JOB];

let view: Mounted;
let store: LibraryStore;

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function open(client: ForgeClient): Promise<void> {
  view = await mount(<RitePage client={client} jobs={jobs} library={{ open: async () => store, cast: async () => [] }} />);
  await flush();
}

const text = (): string => view.container.textContent ?? "";
function button(name: string): HTMLButtonElement {
  const b = [...view.container.querySelectorAll("button")].find((x) => x.textContent?.trim().startsWith(name) || x.getAttribute("aria-label") === name);
  if (b === undefined) throw new Error(`no button ${name}`);
  return b;
}
async function click(el: Element): Promise<void> {
  await act(async () => {
    (el as HTMLElement).click();
  });
}
const slots = (state: string): number => view.container.querySelectorAll(`[data-slot="${state}"]`).length;

/** Describe with an example, bind, and forge. */
async function forge(bind: string[] = []): Promise<void> {
  await click(button("Moth archivist"));
  await click(button("Bind it"));
  for (const b of bind) await click(button(b));
  await click(button("Forge it"));
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  window.sessionStorage.removeItem(JOB_KEY);
  window.localStorage.clear();
  store = memoryLibrary();
});

afterEach(async () => {
  await view.unmount();
  vi.useRealTimers();
});

describe("the rite", () => {
  it("starts with an empty glass and slots awaiting the knife, and needs a description to go on", async () => {
    await open(createReplayForgeClient({ jobs }));
    expect(text()).toContain("The glass is empty");
    expect(slots("waiting")).toBeGreaterThan(0);
    expect(button("Bind it").disabled).toBe(true);
    await click(button("Moth archivist"));
    expect(button("Bind it").disabled).toBe(false);
  });

  it("fills the slots as the statuses arrive: found while segmenting, cut while cutting, all cut when done", async () => {
    await open(createReplayForgeClient({ jobs }));
    await forge();
    expect(view.container.querySelector("[data-page]")?.getAttribute("data-step")).toBe("queued");
    await elapse(3100);
    await elapse(800);
    expect(view.container.querySelector("[data-page]")?.getAttribute("data-step")).toBe("segmenting");
    expect(slots("found")).toBeGreaterThan(0);
    expect(slots("cut")).toBe(0);
    await elapse(1700);
    await elapse(700);
    expect(slots("cut")).toBeGreaterThan(0);
    await elapse(3000);
    await flush();
    expect(view.container.querySelector("[data-page]")?.getAttribute("data-step")).toBe("done");
    expect(slots("cut")).toBe(JOB.rig.layers.length);
  });

  it("keeps the new face bound as chosen and hands it to /creator with it selected", async () => {
    await open(createReplayForgeClient({ jobs }));
    await forge(["Violet", "Rasp"]);
    await elapse(9000);
    await flush();
    const kept = await store.get(JOB.rig.id);
    expect(kept?.kind).toBe("ok");
    if (kept?.kind !== "ok") return;
    expect(kept.record.look.palette.eye).toBe("#bc8bfa");
    expect(kept.record.voice).toBe("rasp");
    const handoff = view.container.querySelector("[data-handoff]");
    expect(handoff?.getAttribute("href")).toContain(`/creator?`);
    expect(handoff?.getAttribute("href")).toContain(`character=${JOB.rig.id}`);
    expect(window.localStorage.getItem("sr-creator-active")).toBe(JOB.rig.id);
  });

  it("refuses a real face with the API's refused_likeness copy, back at Describe, the words kept", async () => {
    await open(createReplayForgeClient({ jobs }));
    await click(button("Moth archivist"));
    await click(button("A photo of a real face?"));
    await flush();
    await elapse(4600);
    await flush();
    const alert = view.container.querySelector('[role="alert"][data-failure="refused_likeness"]');
    expect(alert?.textContent).toContain("No real people");
    expect(alert?.textContent).toContain("refused_likeness");
    expect(alert?.textContent).toContain(FAIL_MESSAGES.refused_likeness);
    expect(alert?.textContent).toContain("your words above are kept");
    expect(view.container.querySelector("textarea")?.value).toContain("moth-winged archivist");
  });

  it.each<[ForgeErrorCode, string]>([
    ["quota", "The forge is cold for tonight"],
    ["upstream", "The image model stopped answering"],
  ])("%s lands on the Forge mark with its copy", async (code, title) => {
    await open(createReplayForgeClient({ jobs, fail: code }));
    await forge();
    await elapse(7000);
    await flush();
    const alert = view.container.querySelector(`[role="alert"][data-failure="${code}"]`);
    expect(alert?.textContent).toContain(title);
  });

  it("upstream offers a retry that sends the same request", async () => {
    const base = createReplayForgeClient({ jobs, fail: "upstream" });
    const sent: unknown[] = [];
    await open({ start: (req) => (sent.push(req), base.start(req)), poll: base.poll });
    await forge(["Lich"]);
    await elapse(7000);
    await flush();
    await click(button("Try again"));
    await flush();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(JSON.stringify(sent[0])).toContain("Archetype: lich.");
  });
});
