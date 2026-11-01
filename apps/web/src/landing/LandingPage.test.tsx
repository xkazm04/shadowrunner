import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LandingPage } from "./LandingPage";

describe("LandingPage (static)", () => {
  it("puts the room inside the world, with the throw, the eye and the spiral in reference order", () => {
    const html = renderToString(<LandingPage />);
    const at = (needle: string) => {
      const i = html.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    const order = ['data-page="landing"', "data-world=", "data-room", "_throw", "_eye", "_spiral", "_vignette"].map(at);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
