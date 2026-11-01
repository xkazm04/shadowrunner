// @vitest-environment happy-dom
import { defaultLook } from "@sr/rig";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, type Mounted } from "../../app/testDom";
import { testRig } from "../testFixtures";
import { Library, type LibraryProps } from "./Library";
import type { CharacterRecord, LibraryEntry } from "./libraryStore";

function record(id: string, name: string, seeded = false): CharacterRecord {
  const rig = testRig(id, name);
  const r: CharacterRecord = { id, rig, assets: {}, look: defaultLook(rig), voice: "crypt", createdAt: "2026-11-01T00:00:00.000Z" };
  if (seeded) r.seeded = true;
  return r;
}

const ENTRIES: LibraryEntry[] = [
  { kind: "ok", record: record("malakor", "Arch-Lich Malakor", true) },
  { kind: "ok", record: record("ghost", "Test Ghost") },
  { kind: "damaged", id: "broken", name: "Broken Thing", reason: "rig does not validate" },
];

let view: Mounted | undefined;
afterEach(async () => {
  await view?.unmount();
  view = undefined;
});

async function show(props: Partial<LibraryProps> = {}): Promise<Mounted> {
  view = await mount(
    <Library
      entries={ENTRIES}
      activeId="malakor"
      persistent
      status="ready"
      onSelect={() => undefined}
      onRemove={async () => "deleted"}
      onOpenGallery={() => undefined}
      {...props}
    />,
  );
  return view;
}

const named = (v: Mounted, name: string): HTMLButtonElement | undefined =>
  [...v.container.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name);

describe("<Library>", () => {
  it("lists characters with the active one pressed, and a damaged record as damaged, not as a character", async () => {
    const v = await show();
    expect(named(v, "Arch-Lich Malakor, on the stage")?.getAttribute("aria-pressed")).toBe("true");
    expect(named(v, "Test Ghost")?.getAttribute("aria-pressed")).toBe("false");
    expect(v.container.querySelector("[data-damaged]")?.textContent).toContain("Broken Thing is damaged");
    expect(named(v, "Broken Thing")).toBeUndefined();
  });

  it("offers no delete for the seeded Malakor", async () => {
    const v = await show();
    expect(named(v, "Delete Arch-Lich Malakor")).toBeUndefined();
    expect(named(v, "Delete Test Ghost")).toBeDefined();
  });

  it("deletes only after a confirm step, and Keep cancels", async () => {
    const onRemove = vi.fn(async () => "deleted" as const);
    const v = await show({ onRemove });
    await act(async () => named(v, "Delete Test Ghost")?.click());
    expect(onRemove).not.toHaveBeenCalled();
    await act(async () => named(v, "Keep")?.click());
    expect(named(v, "Delete")).toBeUndefined();
    await act(async () => named(v, "Delete Test Ghost")?.click());
    await act(async () => named(v, "Delete")?.click());
    expect(onRemove).toHaveBeenCalledWith("ghost");
  });

  it("shows the one-line notice when nothing will be kept", async () => {
    const v = await show({ persistent: false });
    expect(v.container.querySelector("[role=status]")?.textContent).toContain("keeps nothing");
  });

  it("an empty library points at the gallery, which is one press away", async () => {
    const onOpenGallery = vi.fn();
    const v = await show({ entries: [], onOpenGallery });
    expect(v.container.textContent).toContain("adopt one from the replay gallery");
    await act(async () => named(v, "Replay gallery")?.click());
    expect(onOpenGallery).toHaveBeenCalledOnce();
  });
});
