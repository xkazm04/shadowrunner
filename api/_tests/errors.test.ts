// API error bodies (requirement 7.4, 7.6): spec codes and our own messages only.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, UNKNOWN_FAILURE, errorBody, errorResponse, statusFor } from "../_lib/errors.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("errors", () => {
  it("maps spec codes to HTTP statuses", () => {
    expect([statusFor("bad_input"), statusFor("refused_likeness"), statusFor("refused_content"), statusFor("quota"), statusFor("upstream")]).toEqual([
      400, 422, 422, 429, 502,
    ]);
    expect(statusFor("other")).toBe(500);
  });

  it("an ApiError keeps its code, message and status", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = errorResponse(new ApiError("quota", "The cellar is closed for today."));
    expect(res.status).toBe(429);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(errorBody("quota", "The cellar is closed for today."));
  });

  it("any other error becomes the generic upstream body and logs only its class name", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = errorResponse(new TypeError("upstream said: key=SECRET"));
    expect(res.status).toBe(502);
    const body = await res.text();
    expect(body).toBe(JSON.stringify(UNKNOWN_FAILURE));
    expect(body).not.toContain("SECRET");
    expect(error.mock.calls.flat().join(" ")).not.toContain("SECRET");
    expect(error.mock.calls.flat().join(" ")).toContain("TypeError");
  });
});
