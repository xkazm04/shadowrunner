import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Shell } from "./Shell";

describe("Shell", () => {
  it("renders the Shadowrunner wordmark", () => {
    expect(renderToString(<Shell />)).toContain("<h1>Shadowrunner</h1>");
  });
});
