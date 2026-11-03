// @vitest-environment happy-dom
// Creator task 9: the hook seeds the cast (the stage's first character before the first paint, the
// rest in the background) and `/creator?character=<slug>` puts that character on the stage.
import { defaultLook } from "@sr/rig";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mount, type Mounted } from "../../app/testDom";
import { testRig } from "../testFixtures";
import { memoryLibrary, type CharacterRecord, type LibraryStore } from "./libraryStore";
import { useLibrary, wantedCharacter, type CastMember, type Library } from "./useLibrary";

function member(slug: string, id = `replay-${slug}`, seeded = false): CastMember {
  return {
    id,
    slug,
    load: async () => {
      const rig = testRig(id, slug);
      const r: CharacterRecord = { id, rig, assets: Object.fromEntries(rig.layers.map((l) => [l.file, new Blob(["x"])])), look: defaultLook(rig), voice: "crypt", createdAt: "" };
      if (seeded) r.seeded = true;
      return r;
    },
  };
}

const CAST: CastMember[] = [member("malakor", "malakor", true), member("lantern-warden"), member("understudy"), { ...member("reveille"), onDemand: true }];

let view: Mounted | undefined;
let seen: Library | undefined;
beforeEach(() => window.localStorage.clear());
afterEach(async () => {
  await view?.unmount();
  view = undefined;
});

function Probe(props: { store: LibraryStore; want?: string }) {
  seen = useLibrary({ open: async () => props.store, cast: async () => CAST, ...(props.want === undefined ? {} : { want: props.want }) });
  return null;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const ids = (lib: Library | undefined): string[] => (lib?.entries ?? []).flatMap((e) => (e.kind === "ok" ? [e.record.id] : []));

describe("useLibrary and the cast", () => {
  it("seeds the cast on a first visit (on-demand members aside), with Malakor on the stage", async () => {
    view = await mount(<Probe store={memoryLibrary()} />);
    await settle();
    expect(seen?.status).toBe("ready");
    // A cast-forge character (on demand) waits for a press or a link: no download on a first visit.
    expect(ids(seen)).toEqual(["malakor", "replay-lantern-warden", "replay-understudy"]);
    expect(seen?.active?.id).toBe("malakor");
  });

  it("a deep link by slug puts that character on the stage, and is remembered", async () => {
    view = await mount(<Probe store={memoryLibrary()} want="understudy" />);
    await settle();
    expect(seen?.active?.id).toBe("replay-understudy");
    expect(window.localStorage.getItem("sr-creator-active")).toBe("replay-understudy");
    expect(ids(seen)).toHaveLength(3);
  });

  it("a deep link to an on-demand member seeds it and puts it on the stage", async () => {
    view = await mount(<Probe store={memoryLibrary()} want="reveille" />);
    await settle();
    expect(seen?.active?.id).toBe("replay-reveille");
    expect(ids(seen)).toContain("replay-reveille");
    expect(ids(seen)).toHaveLength(4);
  });

  it("a deep link wins over the remembered character, and an unknown one falls back to it", async () => {
    const store = memoryLibrary();
    view = await mount(<Probe store={store} />);
    await settle();
    await view.unmount();
    window.localStorage.setItem("sr-creator-active", "replay-lantern-warden");
    view = await mount(<Probe store={store} want="nobody" />);
    await settle();
    expect(seen?.active?.id).toBe("replay-lantern-warden");
    await view.unmount();
    view = await mount(<Probe store={store} want="malakor" />);
    await settle();
    expect(seen?.active?.id).toBe("malakor");
  });

  it("reads the character parameter of a query string", () => {
    expect(wantedCharacter("?plane=replay&character=lantern-warden")).toBe("lantern-warden");
    expect(wantedCharacter("?character=")).toBeUndefined();
    expect(wantedCharacter("")).toBeUndefined();
  });
});
