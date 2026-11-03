// Type-level test for the forge wire contract (forge-pipeline task 0, design.md "Contracts").
// The import below is the exact one the creator uses (creator/design.md "Contracts"), so this file
// failing `pnpm typecheck` means the creator cannot compile. `@ts-expect-error` lines prove the
// unions are closed: if a type widens, the directive becomes unused and typecheck fails.
import type { ExpressionFamily, Rig } from "@sr/rig";
import { describe, expectTypeOf, it } from "vitest";
import type { BriefResponse, CharacterBrief, ForgeErrorCode, ForgeRequest, ForgeStatus, JobView } from "@sr/forge/wire";
import type * as root from "@sr/forge";

describe("@sr/forge/wire", () => {
  it("ForgeStatus is exactly the design.md statuses, including filling and expressing", () => {
    expectTypeOf<ForgeStatus>().toEqualTypeOf<
      "queued" | "portrait" | "segmenting" | "cutting" | "filling" | "expressing" | "done" | "failed"
    >();
  });

  it("ForgeErrorCode is exactly the five requirement 7.4 codes", () => {
    expectTypeOf<ForgeErrorCode>().toEqualTypeOf<
      "quota" | "refused_likeness" | "refused_content" | "upstream" | "bad_input"
    >();
  });

  it("ForgeRequest is the POST /api/forge body (cast-forge 4.3 adds mode brief)", () => {
    expectTypeOf<ForgeRequest>().toEqualTypeOf<{
      mode: "prompt" | "image" | "brief";
      prompt?: string;
      imageBase64?: string;
      brief?: CharacterBrief;
    }>();
    const prompt: ForgeRequest = { mode: "prompt", prompt: "a lich in a moth-eaten robe" };
    const image: ForgeRequest = { mode: "image", imageBase64: "iVBORw0KGgo=" };
    expectTypeOf(prompt).toExtend<ForgeRequest>();
    expectTypeOf(image).toExtend<ForgeRequest>();
    // @ts-expect-error mode is a closed union
    const bad: ForgeRequest = { mode: "video" };
    void bad;
  });

  it("JobView carries the Rig from @sr/rig and omits optional fields", () => {
    expectTypeOf<JobView>().toEqualTypeOf<{
      jobId: string;
      status: ForgeStatus;
      plane: "replay" | "live";
      portraitUrl?: string;
      rig?: Rig;
      assets?: Record<string, string>;
      fill?: "edit" | "fallback";
      decomposition?: "named" | "fallback";
      expressions?: Partial<Record<ExpressionFamily, "ok" | "skipped" | "failed">>;
      error?: { code: ForgeErrorCode; message: string };
    }>();
    const queued: JobView = { jobId: "j1", status: "queued", plane: "replay" };
    expectTypeOf(queued).toExtend<JobView>();
    // @ts-expect-error optional fields are omitted, never null (tech.md conventions)
    const nulled: JobView = { jobId: "j1", status: "queued", plane: "replay", rig: null };
    void nulled;
  });

  it("the package root re-exports the same wire types", () => {
    expectTypeOf<root.JobView>().toEqualTypeOf<JobView>();
    expectTypeOf<root.ForgeRequest>().toEqualTypeOf<ForgeRequest>();
    expectTypeOf<root.ForgeStatus>().toEqualTypeOf<ForgeStatus>();
    expectTypeOf<root.ForgeErrorCode>().toEqualTypeOf<ForgeErrorCode>();
    expectTypeOf<root.CharacterBrief>().toEqualTypeOf<CharacterBrief>();
    expectTypeOf<root.BriefResponse>().toEqualTypeOf<BriefResponse>();
  });
});
