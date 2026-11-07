// @vitest-environment happy-dom
// tiger L1: the brief card shows a part's signature act, read-only, under the part whose motion
// words name an event (Lot Ninety's right glove: on "sold"), and under no other part.
import { briefFromRecorded } from "@sr/forge/brief";
import { describe, expect, it } from "vitest";
import lotNinety from "../../../../../assets/characters/cast/lot-ninety/brief.json";
import { mount } from "../../app/testDom";
import { BriefCard } from "./BriefCard";

describe("BriefCard signature acts", () => {
  it("shows one read-only act line, under the part that has one", async () => {
    const read = briefFromRecorded(lotNinety);
    if (!read.ok) throw new Error("brief does not read");
    const view = await mount(<BriefCard brief={read.value} recorded busy={false} onEdit={() => undefined} onDraw={() => undefined} onAgain={() => undefined} />);
    const notes = [...view.container.querySelectorAll("[data-act]")];
    expect(notes.map((n) => [n.getAttribute("data-act"), n.textContent])).toEqual([["hand_r", 'signature act: on "sold"']]);
    await view.unmount();
  });
});
