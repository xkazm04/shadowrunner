// @vitest-environment happy-dom
// The stage's parts (voice-and-air task 5.3): the lamp, the captions, the chat and its input.
import type { ChatMsg } from "@sr/engine";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PAGES } from "../app/pages";
import { mount, type Mounted } from "../app/testDom";
import { Captions } from "./Captions";
import { Chat } from "./Chat";
import { OnAirLamp } from "./OnAirLamp";
import type { Caption } from "./show";

let m: Mounted | undefined;
afterEach(async () => {
  await m?.unmount();
  m = undefined;
});

const q = (sel: string) => m?.container.querySelector<HTMLElement>(sel) ?? null;

const ASKED: ChatMsg = { id: "v1", user: "you", text: "is the orb heavy?", ts: 5, fromVisitor: true };
const CAPTION: Caption = {
  beat: 3,
  line: "Heavier than your conscience, lighter than my ledger.",
  reply: { line: "Heavier than your conscience, lighter than my ledger.", emotion: "smug", answeredId: "v1" },
  answered: ASKED,
  voiced: true,
};

describe("the page manifest", () => {
  it("registers the stage as a live page on O at /air", () => {
    expect(PAGES.find((p) => p.id === "air")).toMatchObject({ path: "/air", hotkey: "O", status: "live" });
  });
});

describe("OnAirLamp", () => {
  it("is lit and says so while on air, dark otherwise; the tally follows the voice", async () => {
    m = await mount(<OnAirLamp lit voiced={false} />);
    expect(q('[role="status"]')?.dataset.lit).toBe("on");
    expect(q('[role="status"]')?.getAttribute("aria-label")).toBe("On air");
    expect(q('[aria-hidden="true"]')?.dataset.lit).toBe("off");
    await m.rerender(<OnAirLamp lit={false} voiced />);
    expect(q('[role="status"]')?.dataset.lit).toBe("off");
    expect(q('[role="status"]')?.getAttribute("aria-label")).toBe("Off air");
    expect(q('[aria-hidden="true"]')?.dataset.lit).toBe("on");
  });
});

describe("Captions", () => {
  it("shows the speaker, the line and the message it answers, politely announced", async () => {
    m = await mount(<Captions caption={CAPTION} speaker="Malakor" />);
    const box = q("[data-captions]");
    expect(box?.getAttribute("aria-live")).toBe("polite");
    expect(box?.textContent).toContain("Malakor Heavier than your conscience");
    expect(box?.textContent).toContain("you is the orb heavy?");
    expect(box?.textContent).not.toContain("captions only");
  });

  it("says when a line plays as a caption only (no voice, mouth closed)", async () => {
    m = await mount(<Captions caption={{ ...CAPTION, voiced: false }} speaker="Malakor" />);
    expect(q("[data-captions]")?.textContent).toContain("captions only");
  });

  it("is empty between lines", async () => {
    m = await mount(<Captions speaker="Malakor" />);
    expect(q("[data-captions]")?.textContent).toBe("");
  });
});

describe("Chat", () => {
  const chat: ChatMsg[] = [
    { id: "a01", user: "GraveMoth", text: "first!", ts: 1, fictional: true },
    ASKED,
    { id: "r0", user: "Malakor", text: "Counted.", ts: 6 },
  ];

  it("marks the audience, the visitor and the character, and the message being answered", async () => {
    m = await mount(<Chat chat={chat} self="Malakor" onPost={() => true} answeredId="v1" maxLength={300} />);
    const items = [...(m.container.querySelectorAll<HTMLElement>("li") ?? [])];
    expect(items.map((li) => li.dataset.kind)).toEqual(["audience", "visitor", "self"]);
    expect(items.map((li) => li.dataset.answered !== undefined)).toEqual([false, true, false]);
  });

  it("posts the visitor's message and clears the box; keeps it when refused", async () => {
    const onPost = vi.fn((text: string) => text.trim() !== "");
    m = await mount(<Chat chat={chat} self="Malakor" onPost={onPost} maxLength={300} />);
    const input = q("#air-say") as HTMLInputElement;
    const form = q("form") as HTMLFormElement;
    expect(input.maxLength).toBe(300);
    expect(q('label[for="air-say"]')?.textContent).toBe("Say something to Malakor");
    const type = async (value: string) =>
      act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    await type("is the orb heavy?");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onPost).toHaveBeenLastCalledWith("is the orb heavy?");
    expect(input.value).toBe("");
    await type("   ");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(input.value).toBe("   ");
  });
});
