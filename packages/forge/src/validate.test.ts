// validate.ts: the only JSON.parse of external text in @sr/forge (task 7).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import m8Raw from "../test/fixtures/m8-parts.raw.txt?raw";
import m8 from "../test/fixtures/m8-parts.json";
import { toJobView, type ForgeJob } from "./job.js";
import { MAX_REQUEST_PROMPT, MAX_UPLOAD_BASE64, parseForgeJob, parseForgeRequest, parseLikenessJson, parsePartsJson } from "./validate.js";

describe("parsePartsJson", () => {
  it("rejects the recorded Malakor reply (a stray `]`) as a syntax error, without repairing it", () => {
    expect(m8Raw.length).toBe(2015);
    const parsed = parsePartsJson(m8Raw);
    expect(parsed).toEqual({ ok: false, errors: { syntax: true, errors: [{ code: "upstream", path: "$", message: "is not valid JSON" }] } });
  });

  it("accepts the same reply once the stray bracket is gone (the committed fixture)", () => {
    const parsed = parsePartsJson(JSON.stringify(m8));
    expect(parsed.ok && parsed.value.parts.map((p) => p.name).sort()).toEqual(["crown", "eye_l", "eye_r", "head", "jaw", "monocle", "torso"]);
  });

  it("well-formed JSON off the parts contract is a shape error, not a syntax error", () => {
    const parsed = parsePartsJson('[{"name":"jaw","box_2d":[1,2,3,4],"poly":[[1,2],[3,4],[5,6]]}]');
    expect(!parsed.ok && parsed.errors.syntax).toBe(false);
  });

  it("never throws; text that is not JSON is always syntax, and messages never echo the input", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (text) => {
        const parsed = parsePartsJson(`${text}SECRET`);
        if (parsed.ok) return false;
        return parsed.errors.errors.every((e) => !e.message.includes("SECRET") && !e.path.includes("SECRET"));
      }),
    );
    fc.assert(
      fc.property(fc.json(), (json) => {
        const parsed = parsePartsJson(json);
        return parsed.ok || parsed.errors.syntax === false;
      }),
    );
  });
});

describe("parseForgeRequest", () => {
  it("accepts a prompt request and trims it", () => {
    expect(parseForgeRequest('{"mode":"prompt","prompt":"  a lich  ","imageBase64":"x"}')).toEqual({ ok: true, value: { mode: "prompt", prompt: "a lich" } });
  });

  it("accepts an image request and drops a data: prefix", () => {
    expect(parseForgeRequest('{"mode":"image","imageBase64":"data:image/png;base64,iVBORw0K"}')).toEqual({
      ok: true,
      value: { mode: "image", imageBase64: "iVBORw0K" },
    });
  });

  it.each([
    ["not JSON", "{"],
    ["not an object", "[1]"],
    ["unknown mode", '{"mode":"video"}'],
    ["blank prompt", '{"mode":"prompt","prompt":"   "}'],
    ["prompt too long", JSON.stringify({ mode: "prompt", prompt: "x".repeat(MAX_REQUEST_PROMPT + 1) })],
    ["no image", '{"mode":"image"}'],
    ["image not base64", '{"mode":"image","imageBase64":"<svg>"}'],
    ["image too large", JSON.stringify({ mode: "image", imageBase64: "A".repeat(MAX_UPLOAD_BASE64 + 4) })],
  ])("%s -> bad_input", (_label, text) => {
    const parsed = parseForgeRequest(text);
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.errors.code).toBe("bad_input");
  });

  it("anything accepted is a well-formed ForgeRequest with no stray fields", () => {
    fc.assert(
      fc.property(fc.oneof(fc.json(), fc.record({ mode: fc.constantFrom("prompt", "image"), prompt: fc.string(), imageBase64: fc.base64String() }).map((r) => JSON.stringify(r))), (text) => {
        const parsed = parseForgeRequest(text);
        if (!parsed.ok) return parsed.errors.code === "bad_input";
        const v = parsed.value;
        if (v.mode === "prompt") return Object.keys(v).sort().join() === "mode,prompt" && (v.prompt ?? "").trim() !== "";
        return Object.keys(v).sort().join() === "imageBase64,mode" && (v.imageBase64 ?? "").length > 0;
      }),
    );
  });
});

describe("parseLikenessJson", () => {
  it("reads the two booleans and nothing else", () => {
    expect(parseLikenessJson('{"real_person":true,"unsafe":false,"reason":"a photo"}')).toEqual({ realPerson: true, unsafe: false });
    expect(parseLikenessJson('{"real_person":"no","unsafe":false}')).toBeUndefined();
    expect(parseLikenessJson("```json\n{}\n```")).toBeUndefined();
  });
});

const job: fc.Arbitrary<ForgeJob> = fc
  .record(
    {
      jobId: fc.stringMatching(/^[a-f0-9]{32}$/),
      plane: fc.constantFrom("replay" as const, "live" as const),
      mode: fc.constantFrom("prompt" as const, "image" as const),
      status: fc.constantFrom("queued" as const, "portrait" as const, "segmenting" as const, "cutting" as const, "filling" as const, "done" as const, "failed" as const),
      createdAt: fc.nat(),
      stepStartedAt: fc.nat(),
      prompt: fc.string(),
      portraitUrl: fc.webUrl(),
      portraitMime: fc.constantFrom("image/png" as const, "image/jpeg" as const),
      partsAsks: fc.nat({ max: 2 }),
      fill: fc.constantFrom("edit" as const, "fallback" as const),
      assets: fc.dictionary(fc.stringMatching(/^[a-z_]{1,8}\.png$/), fc.webUrl(), { maxKeys: 4 }),
      error: fc.record({ code: fc.constantFrom("quota" as const, "upstream" as const), message: fc.string() }),
      timings: fc.record({ portrait: fc.nat(), parts: fc.nat() }, { requiredKeys: [] }),
    },
    { requiredKeys: ["jobId", "plane", "mode", "status", "createdAt"] },
  )
  .map((j) => ({ ...j, parts: m8 as ForgeJob["parts"] }));

describe("parseForgeJob", () => {
  it("round-trips every record the server writes", () => {
    fc.assert(
      fc.property(job, (j) => {
        expect(parseForgeJob(JSON.stringify(j))).toEqual(j);
      }),
    );
  });

  it("rejects a record with any field off-contract", () => {
    fc.assert(
      fc.property(job, fc.constantFrom("status", "createdAt", "plane", "fill", "parts", "error", "assets", "timings"), (j, field) => {
        return parseForgeJob(JSON.stringify({ ...j, [field]: { bad: null } })) === undefined;
      }),
    );
    expect(parseForgeJob("not json")).toBeUndefined();
  });
});

describe("toJobView", () => {
  it("omits what the status does not allow, and never carries null", () => {
    fc.assert(
      fc.property(job, (j) => {
        const view = toJobView(j);
        expect(Object.values(view)).not.toContain(null);
        expect("rig" in view || "assets" in view || "fill" in view).toBe(j.status === "done" && (j.assets !== undefined || j.fill !== undefined));
        expect("error" in view).toBe(j.status === "failed" && j.error !== undefined);
        expect("portraitUrl" in view).toBe(j.portraitUrl !== undefined && !["queued", "portrait"].includes(j.status));
        expect(Object.keys(view)).not.toContain("prompt");
      }),
    );
  });
});
