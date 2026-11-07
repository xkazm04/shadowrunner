// @vitest-environment happy-dom
// forge-creator L2, the casting sheet in the rite (replay clients, fake timers): "Draw it" shows three
// RECORDED candidates on the glass, each a provisional rig with one pose switch for all; "Cast this
// one" starts the forge from that candidate (the job is the recorded one it showed) and leaves the
// sheet; "None of these" re-rolls with the count left shown; "Back to the brief" returns to the card
// with nothing drawn; under reduced motion Rest is the player's own still twin and the poses are stills.
import type { AvatarCanvasProps } from "@sr/avatar";
import { parseReplayBatchId } from "@sr/forge/cast";
import type { ForgeRequest } from "@sr/forge/wire";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elapse, mount, restoreMotion, setMotion, type Mounted } from "../../app/testDom";
import { createReplayBriefClient } from "../briefClient";
import { createReplayCastClient } from "../castClient";
import { JOB_KEY } from "../forge/useForgeJob";
import type { ForgeClient } from "../forgeClient";
import { createReplayForgeClient } from "../forgeClient.replay";
import { memoryLibrary } from "../library/libraryStore";
import { testBriefs, testJob } from "../testFixtures";
import { RitePage } from "./RitePage";

vi.mock(import("../../app/plane"), async (original) => ({ ...(await original()), usePlane: () => "replay" as const }));
vi.mock(import("@sr/avatar"), () => ({
  AvatarCanvas: (props: AvatarCanvasProps) => <div data-avatar="" data-rig={props.rig.id} data-drive={props.drive === undefined ? "live" : JSON.stringify(props.drive)} />,
}));
vi.mock(import("../library/assets"), async (original) => ({
  ...(await original()),
  rigAssetsOf: async () => ({}),
  urlsToBlobs: async (urls: Readonly<Record<string, string>>) => Object.fromEntries(Object.keys(urls).map((f) => [f, new Blob(["x"])])),
}));

const TALLY = "a spooky census guy that counts everyone in chat";
const JOBS = ["ghost-a", "ghost-b", "ghost-c", "ghost-d"].map((slug) => testJob(slug));
const jobs = async () => JOBS;

let view: Mounted;
let sent: ForgeRequest[];

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function open(): Promise<void> {
  const base = createReplayForgeClient({ jobs });
  const client: ForgeClient = { start: (req) => (sent.push(req), base.start(req)), poll: base.poll };
  view = await mount(<RitePage client={client} briefer={createReplayBriefClient(async () => testBriefs())} caster={createReplayCastClient({ jobs })} jobs={jobs} library={{ open: async () => memoryLibrary(), cast: async () => [] }} />);
  await flush();
}

const q = <T extends Element>(sel: string): T | null => view.container.querySelector<T>(sel);
const sheet = () => q<HTMLElement>('section[aria-label="Casting: three drafts"]');
const cards = () => [...(sheet()?.querySelectorAll<HTMLElement>("li[data-state]") ?? [])];
function button(name: string, within: ParentNode = view.container): HTMLButtonElement {
  const b = [...within.querySelectorAll("button")].find((x) => x.textContent?.trim().startsWith(name));
  if (b === undefined) throw new Error(`no button ${name}`);
  return b;
}
async function click(el: Element): Promise<void> {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await flush();
}
async function type(el: HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Words -> brief -> Draw it -> the recorded batch, ready. */
async function castSheet(): Promise<void> {
  const area = q<HTMLTextAreaElement>("textarea");
  if (area === null) throw new Error("no textarea");
  await type(area, TALLY);
  await click(button("Brief it"));
  await click(button("Draw it"));
  expect(sheet()?.textContent).toContain("Drawing three drafts");
  await ready();
}
async function ready(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await elapse(1600);
    await flush();
  }
  expect(sheet()?.getAttribute("data-phase")).toBe("ready");
}

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  window.sessionStorage.removeItem(JOB_KEY);
  window.localStorage.clear();
  vi.spyOn(HTMLImageElement.prototype, "decode").mockResolvedValue(undefined);
});
afterEach(async () => {
  await view.unmount();
  restoreMotion();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the casting sheet", () => {
  it("shows three RECORDED provisional rigs; one pose switch drives all three; casting the second forges that recorded job", async () => {
    await open();
    await castSheet();
    expect(sheet()?.textContent).toContain("RECORDED");
    expect(cards()).toHaveLength(3);
    expect(sent).toHaveLength(0); // nothing is forged before a pick
    const avatars = () => [...(sheet()?.querySelectorAll("[data-avatar]") ?? [])];
    expect(avatars()).toHaveLength(3);
    expect(avatars().every((a) => a.getAttribute("data-drive") === "live")).toBe(true);
    await click(sheet()?.querySelector('input[value="jaw"]') as Element);
    expect(avatars().every((a) => JSON.parse(a.getAttribute("data-drive") ?? "{}").jawOpen === 0.9)).toBe(true);
    await click(button("Cast this one", cards()[1] as HTMLElement));
    expect(sent).toHaveLength(1);
    const pick = sent[0]?.candidate;
    expect(pick?.index).toBe(1);
    const slug = parseReplayBatchId(pick?.batchId ?? "")?.slugs[1];
    expect(JOBS.some((j) => j.slug === slug)).toBe(true);
    expect(sheet()).toBeNull();
    expect(window.sessionStorage.getItem(JOB_KEY)).toContain(`"jobId":"replay_${slug ?? "?"}_`);
    for (let i = 0; i < 6; i += 1) {
      await elapse(1600);
      await flush();
    }
    expect(view.container.querySelector("[data-page]")?.getAttribute("data-step")).toBe("done");
  });

  it("None of these re-rolls and counts down; Back to the brief returns to the card with nothing drawn", async () => {
    await open();
    await castSheet();
    const first = cards().map((c) => c.querySelector("[data-rig]")?.getAttribute("data-rig"));
    expect(button("None of these").textContent).toContain("2 re-rolls left");
    await click(button("None of these"));
    expect(sheet()).not.toBeNull(); // the old three stay on show while the next are drawn
    await ready();
    expect(button("None of these").textContent).toContain("1 re-roll left");
    expect(cards().map((c) => c.querySelector("[data-rig]")?.getAttribute("data-rig"))).not.toEqual(first);
    await click(button("Back to the brief"));
    expect(sheet()).toBeNull();
    expect(q('section[aria-label="The brief"]')).not.toBeNull();
    expect(sent).toHaveLength(0);
  });

  it("reduced motion: Rest is the player's still twin (no drive of its own), Head turned is a still pose", async () => {
    setMotion("reduced");
    await open();
    await castSheet();
    await click(sheet()?.querySelector('input[value="turn"]') as Element);
    const drive = JSON.parse(sheet()?.querySelector("[data-avatar]")?.getAttribute("data-drive") ?? "{}") as { still?: boolean; headYaw?: number };
    expect(drive.still).toBe(true);
    expect(drive.headYaw).toBeGreaterThan(0);
    await click(sheet()?.querySelector('input[value="rest"]') as Element);
    expect(sheet()?.querySelector("[data-avatar]")?.getAttribute("data-drive")).toBe("live");
  });
});
