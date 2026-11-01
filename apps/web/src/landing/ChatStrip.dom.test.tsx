// @vitest-environment happy-dom
// useScriptedChat's clock (landing task 7, with the typewriter now in the lazy fx chunk, task 8.3).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elapse, mount, settleImports, type Mounted } from "../app/testDom";
import { ChatStrip } from "./ChatStrip";
import { HISTORY, SCRIPT, START_MS, TYPE_MS, typingMs, VIEWER_GAP_MS } from "./chatScript";

let m: Mounted;

const lines = () => [...m.container.querySelectorAll<HTMLElement>("[data-chat-line]")];
const last = () => lines().at(-1);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  await m.unmount();
  vi.useRealTimers();
});

const viewer = SCRIPT[0];
const reply = SCRIPT[1];

describe("ChatStrip on replay with motion", () => {
  it("waits START_MS, lands a viewer line whole, then types the host's reply in", async () => {
    m = await mount(<ChatStrip plane="replay" motion="full" />);
    await settleImports();
    expect(lines()).toHaveLength(HISTORY.length);

    await elapse(START_MS - 1);
    expect(lines()).toHaveLength(HISTORY.length);
    await elapse(1);
    expect(lines()).toHaveLength(HISTORY.length + 1);
    expect(last()?.textContent).toContain(viewer?.text ?? "-");

    await elapse(VIEWER_GAP_MS);
    expect(last()?.dataset.chatLine).toBe("host");
    expect(last()?.dataset.typing).toBe("true");

    await elapse(TYPE_MS * 3);
    const partial = last()?.textContent ?? "";
    expect(partial.length).toBeGreaterThan("MALAKOR".length);
    expect(partial).not.toContain(reply?.text ?? "-");

    await elapse(typingMs(reply?.text ?? ""));
    expect(last()?.dataset.typing).toBeUndefined();
    expect(last()?.textContent).toContain(reply?.text ?? "-");
  });

  it("holds while paused and resumes where it stopped", async () => {
    m = await mount(<ChatStrip plane="replay" motion="full" paused />);
    await settleImports();
    await elapse(60_000);
    expect(lines()).toHaveLength(HISTORY.length);

    await m.rerender(<ChatStrip plane="replay" motion="full" />);
    await settleImports();
    await elapse(START_MS);
    expect(lines()).toHaveLength(HISTORY.length + 1);

    await m.rerender(<ChatStrip plane="replay" motion="full" paused />);
    await elapse(60_000);
    expect(lines()).toHaveLength(HISTORY.length + 1);

    // Resuming mid-script waits the normal gap, not the arrival pause.
    await m.rerender(<ChatStrip plane="replay" motion="full" />);
    await settleImports();
    await elapse(VIEWER_GAP_MS);
    expect(last()?.dataset.chatLine).toBe("host");
  });

  it("plays nothing on live or with reduced motion", async () => {
    m = await mount(<ChatStrip plane="live" motion="full" />);
    await settleImports();
    await elapse(60_000);
    expect(lines().map((l) => l.dataset.chatLine)).toEqual(["empty"]);
    await m.unmount();

    m = await mount(<ChatStrip plane="replay" motion="reduced" />);
    const still = m.container.innerHTML;
    await elapse(60_000);
    expect(m.container.innerHTML).toBe(still);
  });
});
