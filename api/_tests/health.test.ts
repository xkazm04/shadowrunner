// Lives under an underscore folder so Vercel does not deploy it as a function.
import { describe, expect, it } from "vitest";
import { GET } from "../health";

describe("GET /api/health", () => {
  it("answers 200 with a JSON body", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await res.json()).toEqual({ ok: true });
  });
});
