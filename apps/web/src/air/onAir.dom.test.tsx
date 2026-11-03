// @vitest-environment happy-dom
// character-control task 4, requirement 6: "Put on air" records the character (`sr.onAir`); the
// stage and the live tubes load that record with its saved look, and Malakor when it is missing.
import { defaultLook } from "@sr/rig";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { mount } from "../app/testDom";
import { ChannelActions } from "../creator/glass/SignalCards";
import { memoryLibrary, type CharacterRecord } from "../creator/library/libraryStore";
import { WakeMark } from "../creator/rite/ForgeWake";
import { testRig } from "../creator/testFixtures";
import { loadOnAir, ON_AIR_KEY, readOnAirId, useOnAir, type OnAirState } from "./onAir";

function record(): CharacterRecord {
  const rig = testRig("ghost-1", "Ghost One");
  const assets = Object.fromEntries(rig.layers.map((l) => [l.file, new Blob([l.file])]));
  return { id: rig.id, rig, assets, look: { ...defaultLook(rig), emotion: "smug", hidden: ["crown"], shape: { crown: { size: 1.5, sx: 1, sy: 1, dx: 0, dy: 0, rot: 0 } } }, voice: "crypt", createdAt: "2026-11-01T00:00:00.000Z" };
}

async function storeWith(r?: CharacterRecord) {
  const store = memoryLibrary();
  if (r !== undefined) await store.put(r);
  return store;
}

const decode = async () => ({});

afterEach(() => window.localStorage.clear());

describe("loadOnAir", () => {
  it("loads the stored record with its saved look", async () => {
    const r = record();
    const store = await storeWith(r);
    window.localStorage.setItem(ON_AIR_KEY, r.id);
    const on = await loadOnAir({ open: async () => store, decode });
    expect(on?.name).toBe("Ghost One");
    expect(on?.rig.id).toBe("ghost-1");
    expect(on?.look).toEqual(r.look);
  });

  it("falls back (undefined: Malakor) with no id, a deleted record, or a library that will not open", async () => {
    const store = await storeWith();
    expect(await loadOnAir({ open: async () => store, decode })).toBeUndefined();
    window.localStorage.setItem(ON_AIR_KEY, "gone");
    expect(await loadOnAir({ open: async () => store, decode })).toBeUndefined();
    expect(await loadOnAir({ open: () => Promise.reject(new Error("no db")), decode })).toBeUndefined();
    window.localStorage.setItem(ON_AIR_KEY, "ghost-1");
    expect(await loadOnAir({ open: async () => await storeWith(record()), decode: () => Promise.reject(new Error("bad png")) })).toBeUndefined();
  });

  it("useOnAir answers none straight away on a first visit, and the character once found", async () => {
    let seen: OnAirState[] = [];
    function Probe({ store }: { store: Awaited<ReturnType<typeof storeWith>> }) {
      seen.push(useOnAir({ open: async () => store, decode }));
      return null;
    }
    const first = await mount(<Probe store={await storeWith()} />);
    expect(seen).toEqual(["none"]);
    await first.unmount();
    seen = [];
    window.localStorage.setItem(ON_AIR_KEY, "ghost-1");
    const second = await mount(<Probe store={await storeWith(record())} />);
    await act(async () => undefined);
    expect(seen[0]).toBe("looking");
    const last = seen.at(-1);
    expect(typeof last === "object" ? last.name : last).toBe("Ghost One");
    await second.unmount();
  });
});

describe("Put on air", () => {
  it("in the Forge and at the end of the rite records the character before it navigates", async () => {
    const forge = await mount(<ChannelActions recordId="ghost-1" />);
    await act(async () => forge.container.querySelector<HTMLAnchorElement>("[data-on-air]")?.click());
    expect(readOnAirId()).toBe("ghost-1");
    await forge.unmount();
    const rite = await mount(<WakeMark name="Ghost Two" layers={8} handoff="/creator?character=ghost-2" id="ghost-2" />);
    await act(async () => rite.container.querySelector<HTMLAnchorElement>("[data-on-air]")?.click());
    expect(readOnAirId()).toBe("ghost-2");
    await rite.unmount();
  });
});
