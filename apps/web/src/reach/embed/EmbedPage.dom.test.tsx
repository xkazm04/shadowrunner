// @vitest-environment happy-dom
// /embed (spec avatar-reach, requirement 2.3): the cast picker from /packs/index.json, the live
// <sr-avatar> following picker and mood, and the snippet with this origin. The player is stubbed;
// the pack fetch answers 404 (the page does not care whether the character drew).
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type Mounted } from "../../app/testDom";
import EmbedPage from "./EmbedPage";
import { embedSnippet } from "./snippet";

vi.mock("@sr/avatar/core", () => ({ createAvatarPlayer: () => ({}) }));

const INDEX = [
  { id: "moth-widow", name: "Moth Widow", file: "moth-widow.srpack", bytes: 10 },
  { id: "the-tallyman", name: "The Tallyman", file: "the-tallyman.srpack", bytes: 10 },
];

let view: Mounted | undefined;
let index: unknown;

beforeEach(() => {
  index = INDEX;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) =>
    String(input) === "/packs/index.json" ? Response.json(index) : new Response("missing", { status: 404 }),
  );
});

afterEach(async () => {
  await view?.unmount();
  view = undefined;
  vi.unstubAllGlobals();
});

async function open(): Promise<HTMLElement> {
  view = await mount(<EmbedPage plane="replay" />);
  const { container } = view;
  await vi.waitFor(() => expect(container.querySelector("select, [data-embed-snippet]") ?? container.textContent?.includes("No cast")).toBeTruthy());
  return container;
}

const avatarIn = (container: HTMLElement) => container.querySelector("sr-avatar");
const snippetIn = (container: HTMLElement) => container.querySelector("[data-embed-snippet]")?.textContent;

describe("embedSnippet", () => {
  it("names the script and the pack on this origin, with a mood only when set", () => {
    expect(embedSnippet("https://sr.example", "moth-widow")).toBe(
      '<script type="module" src="https://sr.example/embed/sr-avatar.js"></script>\n<sr-avatar src="https://sr.example/packs/moth-widow.srpack"></sr-avatar>',
    );
    expect(embedSnippet("https://sr.example", "moth-widow", "grim")).toContain('<sr-avatar src="https://sr.example/packs/moth-widow.srpack" mood="grim">');
  });
});

describe("EmbedPage", () => {
  it("picks the first cast pack, shows it live and offers its snippet", async () => {
    const container = await open();
    const select = container.querySelector("select");
    expect([...(select?.options ?? [])].map((o) => o.textContent)).toEqual(["Moth Widow", "The Tallyman"]);
    expect(avatarIn(container)?.getAttribute("src")).toBe("/packs/moth-widow.srpack");
    expect(snippetIn(container)).toBe(embedSnippet(location.origin, "moth-widow"));
  });

  it("follows the picker and the mood keys", async () => {
    const container = await open();
    const select = container.querySelector("select");
    if (select === null) throw new Error("no picker");
    await act(async () => {
      select.value = "the-tallyman";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(avatarIn(container)?.getAttribute("src")).toBe("/packs/the-tallyman.srpack");
    const grim = [...container.querySelectorAll("button")].find((b) => b.textContent === "grim");
    await act(async () => grim?.click());
    expect(grim?.getAttribute("aria-pressed")).toBe("true");
    expect(avatarIn(container)?.getAttribute("mood")).toBe("grim");
    expect(snippetIn(container)).toBe(embedSnippet(location.origin, "the-tallyman", "grim"));
  });

  it("copies the snippet", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const container = await open();
    const copy = [...container.querySelectorAll("button")].find((b) => b.textContent === "Copy snippet");
    await act(async () => copy?.click());
    expect(writeText).toHaveBeenCalledWith(embedSnippet(location.origin, "moth-widow"));
    expect(container.textContent).toContain("Copied.");
  });

  it("says so when no cast packs are published", async () => {
    index = [];
    const container = await open();
    expect(container.textContent).toContain("No cast packs are published here.");
    expect(snippetIn(container)).toBeUndefined();
  });
});
