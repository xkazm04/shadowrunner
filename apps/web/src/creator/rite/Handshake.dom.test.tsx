// @vitest-environment happy-dom
// cast-forge task 10 (requirement 4.3): the handshake in /creator/new. Words are briefed; the card
// shows name, style, parts with role and motion and the accent swatch, labelled RECORDED on
// replay; edits that break a rule block "Draw it" and name the rule; "Draw it" starts the job from
// the edited brief; "Ask again" re-briefs; a failed brief keeps the words.
import type { AvatarCanvasProps } from "@sr/avatar";
import type { BriefResponse, ForgeRequest } from "@sr/forge/wire";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type Mounted } from "../../app/testDom";
import { createReplayBriefClient, type BriefClient } from "../briefClient";
import { JOB_KEY } from "../forge/useForgeJob";
import { ForgeError, type ForgeClient } from "../forgeClient";
import { createReplayForgeClient } from "../forgeClient.replay";
import { memoryLibrary } from "../library/libraryStore";
import { testBriefs, testJob } from "../testFixtures";
import { RitePage } from "./RitePage";

vi.mock(import("../../app/plane"), async (original) => ({ ...(await original()), usePlane: () => "replay" as const }));
vi.mock(import("@sr/avatar"), () => ({ AvatarCanvas: (props: AvatarCanvasProps) => <div data-avatar="" data-rig={props.rig.id} /> }));

const TALLY = "a spooky census guy that counts everyone in chat";
const JOB = testJob("ghost-a");
const jobs = async () => [JOB];

let view: Mounted;
let sent: ForgeRequest[];

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function open(briefer: BriefClient = createReplayBriefClient(async () => testBriefs())): Promise<void> {
  const base = createReplayForgeClient({ jobs });
  const client: ForgeClient = { start: (req) => (sent.push(req), base.start(req)), poll: base.poll };
  view = await mount(<RitePage client={client} briefer={briefer} jobs={jobs} library={{ open: async () => memoryLibrary(), cast: async () => [] }} />);
  await flush();
}

const q = <T extends Element>(sel: string): T | null => view.container.querySelector<T>(sel);
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
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function choose(el: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
const card = () => q<HTMLElement>('section[aria-label="The brief"]');
const nameInput = () => card()?.querySelector<HTMLInputElement>("input") ?? null;

async function briefFor(words: string): Promise<void> {
  const area = q<HTMLTextAreaElement>("textarea");
  if (area === null) throw new Error("no textarea");
  await type(area, words);
  await click(button("Brief it"));
  await flush();
}

beforeEach(() => {
  sent = [];
  window.sessionStorage.removeItem(JOB_KEY);
  window.localStorage.clear();
});
afterEach(async () => {
  await view.unmount();
});

describe("the handshake", () => {
  it("shows a cast member's recorded brief for its one-line request: name, style, parts with role and motion, swatch, RECORDED", async () => {
    await open();
    await briefFor(`  ${TALLY.toUpperCase()} `);
    expect(card()?.getAttribute("data-brief")).toBe("recorded");
    expect(card()?.textContent).toContain("RECORDED");
    expect(nameInput()?.value).toBe("The Tallyman");
    expect(card()?.querySelectorAll("input")[1]?.value).toBe("Low-poly 3D");
    const rows = card()?.querySelectorAll("li") ?? [];
    expect(rows).toHaveLength(12);
    expect(q<HTMLSelectElement>('select[aria-label="eyes_l1 role"]')?.value).toBe("eye");
    expect(q<HTMLTextAreaElement>('textarea[aria-label="jaw motion"]')?.value).toBe("opens primly with speech");
    expect(q('[role="img"]')?.getAttribute("aria-label")).toBe("Accent #c6ff2e, secondary #d8cfb8");
    expect(sent).toHaveLength(0); // nothing is drawn before approval
  });

  it("any other words get the first recorded brief", async () => {
    await open();
    await briefFor("a vampire accountant with a ledger");
    expect(nameInput()?.value).toBe("Saint Cardia of the Glass Heart");
  });

  it("an edit that breaks a rule blocks Draw it and names the rule; a valid edit is what is drawn", async () => {
    await open();
    await briefFor(TALLY);
    const name = nameInput();
    if (name === null) throw new Error("no name field");
    await type(name, "  ");
    expect(button("Draw it").disabled).toBe(true);
    expect(q('[role="status"]')?.textContent).toBe("The name must not be empty.");
    await type(name, "The Counter");
    await choose(q<HTMLSelectElement>('select[aria-label="pince_nez role"]') as HTMLSelectElement, "float");
    const motion = q<HTMLTextAreaElement>('textarea[aria-label="pince_nez motion"]') as HTMLTextAreaElement;
    await type(motion, "");
    await click(button("Drop abacus_collar"));
    expect(button("Draw it").disabled).toBe(false);
    await click(button("Draw it"));
    await flush();
    expect(sent).toHaveLength(1);
    const req = sent[0];
    expect(req?.mode).toBe("brief");
    expect(req?.brief?.name).toBe("The Counter");
    const pince = req?.brief?.parts.find((p) => p.name === "pince_nez");
    expect(pince?.role).toBe("float");
    expect(pince !== undefined && "motion" in pince).toBe(false); // an emptied motion is omitted
    expect(req?.brief?.parts.some((p) => p.name === "abacus_collar")).toBe(false);
    expect(view.container.querySelector("[data-page]")?.getAttribute("data-step")).toBe("queued");
  });

  it("dropping parts below six blocks Draw it", async () => {
    await open();
    await briefFor("a vampire accountant with a ledger");
    for (const part of ["crown", "heart"]) await click(button(`Drop ${part}`));
    expect(button("Draw it").disabled).toBe(true);
    expect(q('[role="status"]')?.textContent).toBe("The parts must list 6 to 24 parts.");
  });

  it("Ask again re-briefs from the same words", async () => {
    const asks: string[] = [];
    const base = createReplayBriefClient(async () => testBriefs());
    await open({ brief: (r) => (asks.push(r), base.brief(r)) });
    await briefFor(TALLY);
    await click(button("Ask again"));
    await flush();
    expect(asks).toEqual([TALLY, TALLY]);
    expect(nameInput()?.value).toBe("The Tallyman");
  });

  it("a failed brief says so, keeps the words, and can be asked again", async () => {
    let fail = true;
    const base = createReplayBriefClient(async () => testBriefs());
    await open({ brief: (r) => (fail ? Promise.reject(new ForgeError("quota", "Tonight's budget is spent.")) : base.brief(r)) });
    await briefFor(TALLY);
    const alert = q('[role="alert"][data-failure="quota"]');
    expect(alert?.textContent).toContain("The brief did not come");
    expect(alert?.textContent).toContain("your words above are kept");
    expect(q<HTMLTextAreaElement>("textarea")?.value).toBe(TALLY);
    fail = false;
    await click(button("Ask again"));
    await flush();
    expect(nameInput()?.value).toBe("The Tallyman");
  });

  it("C4: the hook and up to three example lines are editable; an over-long line names its rule; blank slots are left out", async () => {
    const tally = testBriefs()[1];
    if (tally === undefined) throw new Error("no brief");
    const withLines = { ...tally, example_lines: ["Every one of you is counted.", "Stand still, I lost my place."] };
    await open({ brief: async () => ({ brief: withLines, plane: "live" }) });
    await briefFor(TALLY);
    const line = (n: number) => q<HTMLTextAreaElement>(`textarea[aria-label="Line ${n}"]`) as HTMLTextAreaElement;
    expect([line(1).value, line(2).value, line(3).value]).toEqual(["Every one of you is counted.", "Stand still, I lost my place.", ""]);
    await type(line(2), "x".repeat(161));
    expect(button("Draw it").disabled).toBe(true);
    expect(q('[role="status"]')?.textContent).toBe("Line 2 must be at most 160 characters.");
    await type(line(2), "");
    await type(line(3), "  Again, from the top.  ");
    const hook = card()?.querySelector<HTMLTextAreaElement>("textarea") as HTMLTextAreaElement;
    await type(hook, "Counts chat aloud and never loses count.");
    expect(button("Draw it").disabled).toBe(false);
    await click(button("Draw it"));
    await flush();
    expect(sent[0]?.brief?.example_lines).toEqual(["Every one of you is counted.", "Again, from the top."]);
    expect(sent[0]?.brief?.persona_hook).toBe("Counts chat aloud and never loses count.");
  });

  it("shows the ask in flight, then the card when it lands", async () => {
    const pending: ((r: BriefResponse) => void)[] = [];
    const tally = testBriefs()[1];
    await open({ brief: () => new Promise((resolve) => pending.push(resolve)) });
    await briefFor(TALLY);
    expect(q('[data-brief="asking"]')?.textContent).toContain("being written");
    expect(card()).toBeNull();
    await act(async () => {
      if (tally !== undefined) pending[0]?.({ brief: tally, plane: "live" });
    });
    await flush();
    expect(card()?.getAttribute("data-brief")).toBe("live");
    expect(card()?.textContent).not.toContain("RECORDED");
  });
});
