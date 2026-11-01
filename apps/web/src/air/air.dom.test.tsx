// @vitest-environment happy-dom
// The stage's parts (voice-and-air task 5.3): the lamp, the captions, the chat and its input.
import type { ChatMsg } from "@sr/engine";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PAGES } from "../app/pages";
import { mount, type Mounted } from "../app/testDom";
import { Captions } from "./Captions";
import { Chat } from "./Chat";
import { OnAirLamp, VoiceTally } from "./OnAirLamp";
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
  it("is lit and says so while on air, dark otherwise", async () => {
    m = await mount(<OnAirLamp lit />);
    expect(q('[role="status"]')?.dataset.lit).toBe("on");
    expect(q('[role="status"]')?.getAttribute("aria-label")).toBe("On air");
    await m.rerender(<OnAirLamp lit={false} />);
    expect(q('[role="status"]')?.dataset.lit).toBe("off");
    expect(q('[role="status"]')?.getAttribute("aria-label")).toBe("Off air");
  });

  it("lights the VOICE tally only while the voice sounds", async () => {
    m = await mount(<VoiceTally voiced={false} />);
    expect(q('[aria-hidden="true"]')?.dataset.lit).toBe("off");
    await m.rerender(<VoiceTally voiced />);
    expect(q('[aria-hidden="true"]')?.dataset.lit).toBe("on");
  });
});

describe("Captions", () => {
  it("shows the speaker, his emotion, the line and who asked it, politely announced", async () => {
    m = await mount(<Captions caption={CAPTION} speaker="Malakor" />);
    const box = q("[data-captions]");
    expect(box?.querySelector("[aria-live]")?.getAttribute("aria-live")).toBe("polite");
    expect(box?.textContent).toContain("Malakorsmug");
    expect(box?.textContent).toContain("Heavier than your conscience");
    expect(box?.textContent).toContain("you asked: is the orb heavy?");
    expect(box?.textContent).not.toContain("captions only");
  });

  it("lays every word out from the start, so the reveal never moves a word to another line", async () => {
    m = await mount(<Captions caption={CAPTION} speaker="Malakor" />);
    const words = [...m.container.querySelectorAll<HTMLElement>("[data-word]")];
    expect(words.map((w) => w.textContent?.trim()).join(" ")).toBe(CAPTION.line);
  });

  it("names an unprompted line as spoken to the throne room", async () => {
    const unprompted: Caption = { beat: CAPTION.beat, line: CAPTION.line, reply: CAPTION.reply, voiced: true };
    m = await mount(<Captions caption={unprompted} speaker="Malakor" />);
    expect(q("[data-captions]")?.textContent).toContain("to the throne room");
  });

  it("says when a line plays as a caption only (no voice, mouth closed)", async () => {
    m = await mount(<Captions caption={{ ...CAPTION, voiced: false }} speaker="Malakor" />);
    expect(q("[data-captions]")?.textContent).toContain("captions only");
  });

  it("listens between lines", async () => {
    m = await mount(<Captions speaker="Malakor" />);
    expect(q("[data-captions]")?.textContent).toBe("MalakorlisteningMalakor listens to the chat.");
  });

  it("carries the dead line's words in the bar when the line is dead", async () => {
    m = await mount(<Captions caption={CAPTION} speaker="Malakor" dead />);
    expect(q('[role="alert"]')?.textContent).toBe("LINE DEAD - reconnecting");
    expect(q("[data-captions]")?.textContent).not.toContain("Heavier");
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
    expect(items[1]?.textContent).toContain("answered");
  });

  it("keeps the answered mark on every message he has answered, and reads the candle velocity", async () => {
    m = await mount(<Chat chat={chat} self="Malakor" onPost={() => true} answered={new Set(["a01", "v1"])} maxLength={300} velocity={7} heat={0.5} />);
    const items = [...m.container.querySelectorAll<HTMLElement>("li")];
    expect(items.map((li) => li.dataset.answered !== undefined)).toEqual([true, true, false]);
    expect(items.every((li) => li.dataset.answering === undefined)).toBe(true);
    expect(m.container.querySelector("header")?.textContent).toContain("7 / 30 s");
    expect(m.container.querySelectorAll("[data-on]")).toHaveLength(4);
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
