// @vitest-environment happy-dom
// Avatar packs in the creator (spec avatar-pack, design "Testing" web row): the card Export key,
// the Export sheet, the channel action, and Import pack.
import { readPack, writePack } from "@sr/pack";
import { defaultLook } from "@sr/rig";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type Mounted } from "../../app/testDom";
import { ChannelActions } from "../glass/SignalCards";
import { testRig } from "../testFixtures";
import { AUTHOR_KEY, ExportSheet } from "./ExportSheet";
import { Library, type LibraryProps } from "./Library";
import type { CharacterRecord, LibraryEntry } from "./libraryStore";
import { packInputOf } from "./packing";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function record(id: string, name: string, seeded = false): CharacterRecord {
  const rig = testRig(id, name);
  const assets: Record<string, Blob> = {};
  for (const layer of rig.layers) assets[layer.file] = new Blob([PNG], { type: "image/png" });
  const r: CharacterRecord = { id, rig, assets, look: defaultLook(rig), voice: "rasp", createdAt: "2026-11-01T00:00:00.000Z" };
  if (seeded) r.seeded = true;
  return r;
}

const MALAKOR = record("malakor", "Arch-Lich Malakor", true);
const GHOST = record("ghost", "Test Ghost");
const ENTRIES: LibraryEntry[] = [
  { kind: "ok", record: MALAKOR },
  { kind: "ok", record: GHOST },
];

let view: Mounted | undefined;
beforeEach(() => window.localStorage.clear());
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  vi.restoreAllMocks();
});

async function show(props: Partial<LibraryProps> = {}): Promise<Mounted> {
  view = await mount(
    <Library
      entries={ENTRIES}
      activeId="ghost"
      persistent
      status="ready"
      onSelect={() => undefined}
      onRemove={async () => "deleted"}
      onOpenGallery={() => undefined}
      onImport={async () => undefined}
      {...props}
    />,
  );
  return view;
}

const labelled = (name: string): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
const sheet = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="dialog"]');
const button = (text: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text);

/** Picks `file` in the Library's hidden file input and lets the import settle. */
async function pick(v: Mounted, file: File): Promise<void> {
  const input = v.container.querySelector<HTMLInputElement>("[data-import-input]");
  if (input === null) throw new Error("no import input");
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  // readPack and the store are async: let them finish inside act().
  for (let i = 0; i < 5; i += 1) await act(async () => new Promise((r) => setTimeout(r, 0)));
}

describe("Library export", () => {
  it("offers Export on every card but Malakor's", async () => {
    await show();
    expect(labelled("Export Arch-Lich Malakor")).toBeNull();
    expect(labelled("Export Test Ghost")).not.toBeNull();
  });

  it("opens the sheet with the author field focused; Escape closes it and focus returns", async () => {
    await show();
    const key = labelled("Export Test Ghost");
    key?.focus();
    await act(async () => key?.click());
    expect(sheet()?.getAttribute("aria-label")).toBe("Export Test Ghost");
    expect(document.activeElement?.getAttribute("name")).toBe("author");
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(labelled("Export Test Ghost"));
  });
});

describe("<ExportSheet>", () => {
  it("downloads <name>.srpack carrying the chosen licence, and remembers the author", async () => {
    const download = vi.fn<(bytes: Uint8Array, name: string) => void>();
    const onClose = vi.fn();
    window.localStorage.setItem(AUTHOR_KEY, "Old Name");
    view = await mount(<ExportSheet record={GHOST} onClose={onClose} download={download} />);
    const author = document.querySelector<HTMLInputElement>('input[name="author"]');
    expect(author?.value).toBe("Old Name");
    const licence = document.querySelector<HTMLSelectElement>('select[name="licence"]');
    expect([...(licence?.options ?? [])].map((o) => o.textContent)).toEqual(["All rights reserved", "CC BY 4.0", "CC BY-NC 4.0", "CC0"]);
    await act(async () => {
      if (author === null || licence === null) return;
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setValue?.call(author, "Ada");
      author.dispatchEvent(new Event("input", { bubbles: true }));
      licence.value = "CC-BY-4.0";
      licence.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => button("Download")?.click());
    for (let i = 0; i < 5 && download.mock.calls.length === 0; i += 1) await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(download).toHaveBeenCalledOnce();
    const [bytes, name] = download.mock.calls[0] ?? [];
    expect(name).toBe("test-ghost.srpack");
    const read = await readPack(bytes ?? new Uint8Array());
    if (!read.ok) throw new Error(read.error.detail);
    expect(read.pack.manifest).toMatchObject({ id: "ghost", author: "Ada", licence: "CC-BY-4.0", voice: "rasp" });
    expect(window.localStorage.getItem(AUTHOR_KEY)).toBe("Ada");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Cancel closes without a download", async () => {
    const download = vi.fn();
    const onClose = vi.fn();
    view = await mount(<ExportSheet record={GHOST} onClose={onClose} download={download} />);
    await act(async () => button("Cancel")?.click());
    expect(onClose).toHaveBeenCalledOnce();
    expect(download).not.toHaveBeenCalled();
  });
});

describe("Export pack in the channel actions", () => {
  it("is offered for a forged character and not for Malakor", async () => {
    view = await mount(<ChannelActions recordId="ghost" record={GHOST} />);
    expect(view.container.querySelector("[data-export-pack]")).not.toBeNull();
    await act(async () => view?.container.querySelector<HTMLButtonElement>("[data-export-pack]")?.click());
    expect(sheet()?.getAttribute("aria-label")).toBe("Export Test Ghost");
    await view.unmount();
    view = await mount(<ChannelActions recordId="malakor" record={MALAKOR} />);
    expect(view.container.querySelector("[data-export-pack]")).toBeNull();
  });
});

describe("Library import", () => {
  it("adds a valid pack as a copy when its id is taken, and says so", async () => {
    const onImport = vi.fn<(record: CharacterRecord) => Promise<void>>(async () => undefined);
    const v = await show({ onImport });
    const bytes = await writePack(packInputOf(GHOST, { licence: "CC0-1.0" }));
    await pick(v, new File([bytes.slice()], "test-ghost.srpack", { type: "application/zip" }));
    expect(onImport).toHaveBeenCalledOnce();
    const added = onImport.mock.calls[0]?.[0];
    expect([added?.id, added?.rig.name, added?.seeded]).toEqual(["ghost-2", "Test Ghost (copy)", undefined]);
    expect(v.container.querySelector('[data-import-notice="done"]')?.textContent).toBe("Imported Test Ghost (copy)");
  });

  it("a junk file shows the not-a-pack sentence and adds nothing", async () => {
    const onImport = vi.fn(async () => undefined);
    const v = await show({ onImport });
    await pick(v, new File(["hello"], "notes.zip", { type: "application/zip" }));
    expect(onImport).not.toHaveBeenCalled();
    const notice = v.container.querySelector('[data-import-notice="failed"]');
    expect(notice?.getAttribute("role")).toBe("status");
    expect(notice?.textContent).toBe("That file is not a Shadowrunner pack.");
  });

  it("has no Import pack without a way to keep it", async () => {
    view = await mount(
      <Library entries={ENTRIES} persistent status="ready" onSelect={() => undefined} onRemove={async () => "deleted"} onOpenGallery={() => undefined} />,
    );
    expect(labelled("Import pack")).toBeNull();
  });
});
