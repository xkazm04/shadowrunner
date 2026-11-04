// @vitest-environment happy-dom
// The overlay page (spec avatar-reach 3.1-3.5): the URL's source plays on the URL's background
// (restored on unmount) with the URL's mood, keys drive the player, a load failure is a sentence,
// the microphone falls back to a click; without a source the setup card builds the OBS URL.
import type { AvatarPlayerOptions } from "@sr/avatar/core";
import { defaultLook } from "@sr/rig";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { mount, type Mounted } from "../../app/testDom";
import { testRig } from "../../creator/testFixtures";
import type { PlayableResult } from "../playable";
import type { MicEnv } from "./mic";
import { CLICK_TO_START } from "./mic";
import OverlayPage from "./OverlayPage";
import { OverlayStage } from "./OverlayStage";
import { OBS_MIC_NOTE, OverlaySetup } from "./OverlaySetup";
import { parseOverlayParams } from "./params";

const fake = vi.hoisted(() => ({
  players: [] as { options: unknown; calls: string[]; attachAudio: Mock }[],
  result: undefined as unknown,
  cast: [] as { id: string; name: string; file: string; bytes: number }[],
}));

vi.mock("@sr/avatar/core", () => ({
  createAvatarPlayer: (_canvas: HTMLCanvasElement, options: AvatarPlayerOptions) => {
    const calls: string[] = [];
    const player = {
      options,
      calls,
      attachAudio: vi.fn(),
      setEmotion: (e: string) => calls.push(`mood:${e}`),
      gesture: (g: string) => calls.push(`gesture:${g}`),
      start: () => calls.push("start"),
      dispose: () => calls.push("dispose"),
    };
    fake.players.push(player);
    return player;
  },
}));

vi.mock("../playable", () => ({
  loadPlayable: async () => fake.result,
  loadCastIndex: async () => fake.cast,
}));

vi.mock("../../creator/library/libraryStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../creator/library/libraryStore")>();
  return { ...actual, openLibrary: async () => actual.memoryLibrary() };
});

const rig = testRig("ghost", "Test Ghost");
const ok: PlayableResult = { ok: true, playable: { id: "ghost", name: "Test Ghost", rig, look: defaultLook(rig), voice: "crypt", assets: {} as never } };

let view: Mounted | undefined;
beforeEach(() => {
  fake.players.length = 0;
  fake.result = ok;
  fake.cast = [{ id: "malakor", name: "Arch-Lich Malakor", file: "malakor.srpack", bytes: 10 }];
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  window.history.replaceState(null, "", "/");
  document.body.style.removeProperty("background");
  document.documentElement.style.removeProperty("background");
});

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await act(async () => new Promise((r) => setTimeout(r, 0)));
}

async function stage(search: string, micEnv?: () => MicEnv): Promise<Mounted> {
  const params = parseOverlayParams(search);
  if (params.source === undefined) throw new Error("no source");
  view = await mount(<OverlayStage source={params.source} params={params} {...(micEnv === undefined ? {} : { micEnv })} />);
  await settle();
  return view;
}

const press = (key: string) => act(async () => document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));

describe("OverlayStage", () => {
  it("paints the page with the URL's background while mounted and restores the old value", async () => {
    document.body.style.setProperty("background", "blue");
    const v = await stage("?pack=malakor&bg=green");
    expect(document.body.style.getPropertyValue("background")).toContain("#00ff00");
    expect(document.documentElement.style.getPropertyValue("background")).toContain("#00ff00");
    await v.unmount();
    view = undefined;
    expect(document.body.style.getPropertyValue("background")).toBe("blue");
    expect(document.documentElement.style.getPropertyValue("background")).toBe("");
  });

  it("starts the player with the URL's mood, and the keys change mood and fire the gesture", async () => {
    const v = await stage("?pack=malakor&mood=grim");
    const [player] = fake.players;
    expect((player?.options as AvatarPlayerOptions).look.emotion).toBe("grim");
    expect(player?.calls).toEqual(["start"]);
    await press("4");
    await press("0");
    await press("g");
    expect(player?.calls).toEqual(["start", "mood:bored", "mood:neutral", "gesture:nod"]);
    expect(v.container.querySelector("p, button")).toBeNull();
    await v.unmount();
    view = undefined;
    expect(player?.calls.at(-1)).toBe("dispose");
  });

  it("says why the character could not load", async () => {
    fake.result = { ok: false, error: "That pack could not be found." };
    const v = await stage("?pack=nobody");
    expect(v.container.textContent).toContain("That pack could not be found.");
    expect(fake.players).toHaveLength(0);
  });

  it("shows click-to-start for a suspended context, hidden once running", async () => {
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] } as object as MediaStream;
    const context = { state: "suspended", resume: vi.fn(async () => void (context.state = "running")), close: vi.fn(async () => undefined) };
    const env = (): MicEnv => ({ getUserMedia: async () => stream, createContext: () => context as object as AudioContext });
    const v = await stage("?pack=malakor&mic=1", env);
    const button = v.container.querySelector("button");
    expect(button?.textContent).toBe(CLICK_TO_START);
    await act(async () => button?.click());
    await settle();
    expect(fake.players[0]?.attachAudio).toHaveBeenCalledWith(stream, { context });
    expect(v.container.querySelector("button")).toBeNull();
    await v.unmount();
    view = undefined;
    expect(track.stop).toHaveBeenCalled();
  });
});

describe("OverlayPage and OverlaySetup", () => {
  it("shows the setup card without a source, building the URL from the picks", async () => {
    view = await mount(<OverlaySetup plane="replay" origin="https://sr.example" />);
    await settle();
    const address = () => view?.container.querySelector<HTMLInputElement>('input[type="text"]')?.value;
    expect(address()).toBe("https://sr.example/overlay?pack=malakor&mic=1");
    expect(view.container.textContent).toContain(OBS_MIC_NOTE);

    const radio = view.container.querySelector<HTMLInputElement>('input[value="green"]');
    await act(async () => radio?.click());
    const mic = view.container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => mic?.click());
    expect(address()).toBe("https://sr.example/overlay?pack=malakor&bg=green");
    expect(view.container.textContent).not.toContain(OBS_MIC_NOTE);
  });

  it("routes on the URL: setup without a source, the stage with one", async () => {
    view = await mount(<OverlayPage plane="replay" />);
    await settle();
    expect(view.container.querySelector("form")).not.toBeNull();
    await view.unmount();

    window.history.replaceState(null, "", "/overlay?pack=malakor");
    view = await mount(<OverlayPage plane="replay" />);
    await settle();
    expect(view.container.querySelector("form")).toBeNull();
    expect(view.container.querySelector("canvas")).not.toBeNull();
  });
});
