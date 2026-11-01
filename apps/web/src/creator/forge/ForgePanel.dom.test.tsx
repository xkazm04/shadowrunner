// @vitest-environment happy-dom
// Task 5: the forge panel with the replay client and fake timers. Every failure code renders its
// state, quota offers the gallery, the input is kept, and a job resumes by id after a remount.
import type { ForgeErrorCode } from "@sr/forge/wire";
import { act, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elapse, mount, type Mounted } from "../../app/testDom";
import type { ForgeClient } from "../forgeClient";
import { createReplayForgeClient } from "../forgeClient.replay";
import { testJob } from "../testFixtures";
import { ForgePanel, type ForgeDraft } from "./ForgePanel";
import { JOB_KEY, useForgeJob } from "./useForgeJob";

const jobs = async () => [testJob("ghost-a")];
const PROMPT = "A drowned lighthouse keeper with a lantern heart";

function Harness({ client, onGallery = () => undefined }: { client: ForgeClient; onGallery?: () => void }) {
  const job = useForgeJob(client);
  const [draft, setDraft] = useState<ForgeDraft>({ prompt: "" });
  return (
    <>
      <ForgePanel job={job} draft={draft} onDraft={setDraft} onOpenGallery={onGallery} doneNote="Revealed." />
      <output data-phase={job.state.phase} />
    </>
  );
}

let view: Mounted;
const q = <T extends Element>(sel: string): T => {
  const el = view.container.querySelector<T>(sel);
  if (el === null) throw new Error(`no ${sel}`);
  return el;
};
const phase = (): string | null => q("output").getAttribute("data-phase");
const text = (): string => view.container.textContent ?? "";
const buttonNamed = (name: string): HTMLButtonElement => {
  const b = [...view.container.querySelectorAll("button")].find((x) => x.textContent?.trim() === name);
  if (b === undefined) throw new Error(`no button ${name}`);
  return b;
};

async function type(value: string): Promise<void> {
  const area = q<HTMLTextAreaElement>("textarea");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(area, value);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit(): Promise<void> {
  await act(async () => {
    buttonNamed("Forge it").click();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function forgeWith(fail?: ForgeErrorCode, onGallery?: () => void): Promise<void> {
  view = await mount(<Harness client={createReplayForgeClient(fail === undefined ? { jobs } : { jobs, fail })} {...(onGallery ? { onGallery } : {})} />);
  await type(PROMPT);
  await submit();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  window.sessionStorage.clear();
});

afterEach(async () => {
  await view.unmount();
  vi.useRealTimers();
});

describe("forge form", () => {
  it("needs 10 to 500 characters before it sends", async () => {
    view = await mount(<Harness client={createReplayForgeClient({ jobs })} />);
    expect(buttonNamed("Forge it").disabled).toBe(true);
    await type("too short");
    expect(buttonNamed("Forge it").disabled).toBe(true);
    await type(PROMPT);
    expect(buttonNamed("Forge it").disabled).toBe(false);
  });

  it("shows one staged step per status with the elapsed time, and disables the form while running", async () => {
    await forgeWith();
    expect(phase()).toBe("running");
    expect(q("[aria-current=step]").textContent).toBe("In the queue");
    expect(q<HTMLFieldSetElement>("fieldset").disabled).toBe(true);
    expect(text()).toContain("It keeps going if you leave the page");
    await elapse(2000);
    expect(q("[aria-current=step]").textContent).toBe("Painting the portrait");
    expect(text()).toContain("0:02");
    await elapse(4800);
    expect(q("[aria-current=step]").textContent).toBe("Filling behind the cuts");
    await elapse(3000);
    expect(phase()).toBe("done");
    expect(text()).toContain("Revealed.");
    expect(q<HTMLFieldSetElement>("fieldset").disabled).toBe(false);
  });
});

describe("failure states", () => {
  it("quota offers the replay gallery", async () => {
    const onGallery = vi.fn();
    await forgeWith("quota", onGallery);
    expect(q("[role=alert]").getAttribute("data-failure")).toBe("quota");
    await act(async () => buttonNamed("Open the replay gallery").click());
    expect(onGallery).toHaveBeenCalledOnce();
  });

  it("refused_likeness explains no real people", async () => {
    await forgeWith("refused_likeness");
    await elapse(10_000);
    expect(q("[role=alert]").getAttribute("data-failure")).toBe("refused_likeness");
    expect(text()).toContain("No real people");
  });

  it("refused_content has its own state", async () => {
    await forgeWith("refused_content");
    await elapse(10_000);
    expect(q("[role=alert]").getAttribute("data-failure")).toBe("refused_content");
  });

  it("upstream offers a retry that sends the same request", async () => {
    await forgeWith("upstream");
    await elapse(10_000);
    expect(q("[role=alert]").getAttribute("data-failure")).toBe("upstream");
    await act(async () => buttonNamed("Try again").click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(phase()).toBe("running");
  });

  it("bad_input points at the field", async () => {
    await forgeWith("bad_input");
    const area = q<HTMLTextAreaElement>("textarea");
    expect(area.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(area);
  });

  it.each<ForgeErrorCode>(["quota", "refused_likeness", "refused_content", "upstream", "bad_input"])("%s keeps the input for retry", async (code) => {
    await forgeWith(code);
    await elapse(10_000);
    expect(phase()).toBe("failed");
    expect(q<HTMLTextAreaElement>("textarea").value).toBe(PROMPT);
  });
});

describe("resume", () => {
  it("leaving the page does not cancel the job; a remount resumes polling by jobId", async () => {
    await forgeWith();
    await elapse(2000);
    const stored = window.sessionStorage.getItem(JOB_KEY);
    expect(stored).toContain("replay_ghost-a_");
    await view.unmount();
    await elapse(2800);
    view = await mount(<Harness client={createReplayForgeClient({ jobs })} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(phase()).toBe("running");
    expect(q("[aria-current=step]").textContent).toBe("Cutting the layers");
    await elapse(5000);
    expect(phase()).toBe("done");
    expect(window.sessionStorage.getItem(JOB_KEY)).toBeNull();
  });

  it("gives up as upstream after five minutes", async () => {
    const stuck: ForgeClient = { start: async () => ({ jobId: "stuck" }), poll: async () => ({ jobId: "stuck", status: "cutting", plane: "live" }) };
    view = await mount(<Harness client={stuck} />);
    await type(PROMPT);
    await submit();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 6000);
    });
    expect(q("[role=alert]").getAttribute("data-failure")).toBe("upstream");
  });
});
