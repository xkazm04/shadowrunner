// @vitest-environment happy-dom
// <sr-avatar> (spec avatar-reach, design "Embed" / "Testing"): defines once, attributes and the JS
// API reach the player (stubbed), `sr-error` with a sentence on a 404, the microphone on a click,
// and everything disposed on removal. fetch and createImageBitmap are stubbed; packs are real.
import type { AvatarPlayer, AvatarPlayerOptions } from "@sr/avatar/core";
import { writePack } from "@sr/pack";
import { defaultLook } from "@sr/rig";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testRig } from "../../creator/testFixtures";
import { defineSrAvatar, LISTEN, LOADING, MIC_REFUSED, NO_SOURCE, SR_AVATAR_TAG, type SrAvatarElement } from "./srAvatar";

const fake = vi.hoisted(() => ({ players: [] as { canvas: HTMLCanvasElement; options: AvatarPlayerOptions; player: Record<keyof AvatarPlayer, ReturnType<typeof vi.fn>> }[] }));

vi.mock("@sr/avatar/core", () => ({
  createAvatarPlayer: (canvas: HTMLCanvasElement, options: AvatarPlayerOptions): AvatarPlayer => {
    const player = {
      setLook: vi.fn(),
      setEmotion: vi.fn(),
      gesture: vi.fn(),
      attachAudio: vi.fn(),
      setLevel: vi.fn(),
      resize: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      renderFrame: vi.fn(),
      dispose: vi.fn(),
    };
    fake.players.push({ canvas, options, player });
    return player;
  },
}));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function packBytes(): Promise<Uint8Array<ArrayBuffer>> {
  const rig = testRig("ghost", "Test Ghost");
  const files: Record<string, Blob> = {};
  for (const layer of rig.layers) files[layer.file] = new Blob([PNG], { type: "image/png" });
  return new Uint8Array(await writePack({ rig, look: { ...defaultLook(rig), emotion: "smug" }, voice: "velvet", files, licence: "CC-BY-4.0" }));
}

let pack: Uint8Array<ArrayBuffer>;
let fetched: string[];

beforeEach(async () => {
  fake.players.length = 0;
  fetched = [];
  pack ??= await packBytes();
  vi.stubGlobal("createImageBitmap", async () => ({ width: 1, height: 1, close: () => undefined }));
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    fetched.push(url);
    return new URL(url).pathname === "/packs/ghost.srpack" ? new Response(pack.slice()) : new Response("missing", { status: 404 });
  });
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function make(attributes: Record<string, string>): SrAvatarElement {
  defineSrAvatar();
  const element = document.createElement(SR_AVATAR_TAG);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

/** Appends `element` and waits for its `sr-ready` or `sr-error`. */
function settle(element: SrAvatarElement, parent: Element = document.body): Promise<Event> {
  return new Promise((resolve) => {
    element.addEventListener("sr-ready", resolve, { once: true });
    element.addEventListener("sr-error", resolve, { once: true });
    parent.append(element);
  });
}

const statusOf = (element: SrAvatarElement): string => element.shadowRoot?.querySelector("[role=status]")?.textContent ?? "";
const listenOf = (element: SrAvatarElement): HTMLButtonElement | null | undefined => element.shadowRoot?.querySelector("button");
const only = () => {
  expect(fake.players).toHaveLength(1);
  const [first] = fake.players;
  if (first === undefined) throw new Error("no player");
  return first;
};

describe("defineSrAvatar", () => {
  it("registers sr-avatar once", () => {
    const define = vi.spyOn(customElements, "define");
    const already = customElements.get(SR_AVATAR_TAG) !== undefined;
    defineSrAvatar();
    defineSrAvatar();
    expect(define).toHaveBeenCalledTimes(already ? 0 : 1);
    expect(customElements.get(SR_AVATAR_TAG)).toBeDefined();
  });
});

describe("<sr-avatar>", () => {
  it("loads the pack, starts the player in the mood asked for, and fires sr-ready", async () => {
    const element = make({ src: "/packs/ghost.srpack", mood: "furious" });
    element.setLevel(0.4);
    const appended = settle(element);
    expect(statusOf(element)).toBe(LOADING);
    const event = await appended;
    expect(event.type).toBe("sr-ready");
    expect(new URL(fetched[0] ?? "").pathname).toBe("/packs/ghost.srpack");
    const { canvas, options, player } = only();
    expect(element.shadowRoot?.contains(canvas)).toBe(true);
    expect(options.rig.id).toBe("ghost");
    expect(options.look.emotion).toBe("furious");
    expect(player.setLevel).toHaveBeenCalledWith(0.4);
    expect(player.start).toHaveBeenCalledTimes(1);
    expect(statusOf(element)).toBe("");
  });

  it("keeps the pack's saved mood without a mood attribute", async () => {
    await settle(make({ src: "/packs/ghost.srpack" }));
    expect(only().options.look.emotion).toBe("smug");
  });

  it("passes mood, gesture, level and audio to the player and ignores unknown names", async () => {
    const element = make({ src: "/packs/ghost.srpack" });
    await settle(element);
    const { player } = only();
    element.setAttribute("mood", "bored");
    element.setMood("delighted");
    element.setAttribute("mood", "sideways");
    expect(player.setEmotion.mock.calls).toEqual([["bored"], ["delighted"]]);
    element.gesture("nod");
    element.gesture("wave" as "nod");
    expect(player.gesture.mock.calls).toEqual([["nod"]]);
    element.setLevel(0.7);
    element.setLevel(undefined);
    expect(player.setLevel.mock.calls).toEqual([[0.7], [undefined]]);
    const audio = document.createElement("audio");
    element.attachAudio(audio);
    expect(player.attachAudio).toHaveBeenLastCalledWith(audio, undefined);
  });

  it("paints the background attribute under the canvas, transparent by default", async () => {
    const element = make({ src: "/packs/ghost.srpack" });
    await settle(element);
    const stage = only().canvas.parentElement;
    expect(stage?.style.background).toBe("transparent");
    element.setAttribute("background", "green");
    expect(stage?.style.background).toBe("green");
  });

  it("fires sr-error with a sentence on a 404 and shows it", async () => {
    const element = make({ src: "/packs/nobody.srpack" });
    const event = await settle(element);
    expect(event.type).toBe("sr-error");
    expect(event instanceof CustomEvent ? event.detail : undefined).toBe("That pack could not be fetched.");
    expect(statusOf(element)).toBe("That pack could not be fetched.");
    expect(fake.players).toHaveLength(0);
  });

  it("says so when there is no src", () => {
    const element = make({});
    document.body.append(element);
    expect(statusOf(element)).toBe(NO_SOURCE);
    expect(fetched).toEqual([]);
  });

  it("loads again when src changes and disposes the old player", async () => {
    const element = make({ src: "/packs/ghost.srpack" });
    await settle(element);
    const ready = new Promise((resolve) => element.addEventListener("sr-ready", resolve, { once: true }));
    element.setAttribute("src", `${location.origin}/packs/ghost.srpack`);
    await ready;
    expect(fake.players).toHaveLength(2);
    expect(fake.players[0]?.player.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes the player when removed", async () => {
    const element = make({ src: "/packs/ghost.srpack" });
    await settle(element);
    element.remove();
    expect(only().player.dispose).toHaveBeenCalledTimes(1);
  });

  it("mirrors the host page's data-motion onto the stage and follows it", async () => {
    const shell = document.createElement("div");
    shell.setAttribute("data-motion", "reduced");
    document.body.append(shell);
    const element = make({ src: "/packs/ghost.srpack" });
    await settle(element, shell);
    const stage = only().canvas.parentElement;
    expect(stage?.getAttribute("data-motion")).toBe("reduced");
    shell.setAttribute("data-motion", "full");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stage?.getAttribute("data-motion")).toBe("full");
  });
});

describe("<sr-avatar mic>", () => {
  function stubMic(getUserMedia: () => Promise<unknown>) {
    const contexts: { close: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal(
      "AudioContext",
      class {
        close = vi.fn(async () => undefined);
        constructor() {
          contexts.push(this);
        }
      },
    );
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(getUserMedia) } });
    return contexts;
  }

  it("shows Click to listen once ready, then lip-syncs to the microphone and stops it on removal", async () => {
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    const contexts = stubMic(async () => stream);
    const element = make({ src: "/packs/ghost.srpack", mic: "" });
    await settle(element);
    const listen = listenOf(element);
    expect(listen?.hidden).toBe(false);
    expect(listen?.textContent).toBe(LISTEN);
    listen?.click();
    await vi.waitFor(() => expect(only().player.attachAudio).toHaveBeenCalled());
    expect(only().player.attachAudio).toHaveBeenCalledWith(stream, { context: contexts[0] });
    expect(listen?.hidden).toBe(true);
    element.remove();
    expect(track.stop).toHaveBeenCalled();
    expect(contexts[0]?.close).toHaveBeenCalled();
  });

  it("says why when the microphone is refused, and keeps the button", async () => {
    const contexts = stubMic(async () => {
      throw new DOMException("no", "NotAllowedError");
    });
    const element = make({ src: "/packs/ghost.srpack", mic: "" });
    await settle(element);
    listenOf(element)?.click();
    await vi.waitFor(() => expect(statusOf(element)).toBe(MIC_REFUSED));
    expect(listenOf(element)?.hidden).toBe(false);
    expect(contexts[0]?.close).toHaveBeenCalled();
    expect(only().player.attachAudio).not.toHaveBeenCalled();
  });

  it("has no button without the mic attribute", async () => {
    const element = make({ src: "/packs/ghost.srpack" });
    await settle(element);
    expect(listenOf(element)?.hidden).toBe(true);
  });
});
