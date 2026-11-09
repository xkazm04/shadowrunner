// @vitest-environment happy-dom
// perfection-pass task 8: a drawing skips the brief. On replay the forge does not read it; it plays
// a recorded character picked by the drawing's hash, and the drawing's chip says so. Live says nothing.
import { describe, expect, it } from "vitest";
import { mount } from "../../app/testDom";
import { Describe } from "./Marks";

const draft = { prompt: "", image: { base64: "AAAA", name: "ghoul.png", width: 640, height: 480 } };
const noop = () => undefined;

describe("Describe with a drawing", () => {
  it.each([
    [true, true],
    [false, false],
  ])("recorded=%s names the recorded character instead of the drawing: %s", async (recorded, says) => {
    const view = await mount(<Describe draft={draft} onDraft={noop} busy={false} recorded={recorded} onNext={noop} />);
    const chip = [...view.container.querySelectorAll("button")].find((b) => b.textContent?.includes("ghoul.png"));
    expect(chip?.textContent?.includes("replay forges a recorded character, not this drawing")).toBe(says);
    await view.unmount();
  });
});
