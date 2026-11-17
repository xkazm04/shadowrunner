import { describe, expect, it } from "vitest";
import { parseArgs } from "../args.js";

describe("parseArgs", () => {
  it("defaults a run to the baseline on haunt-01", () => {
    expect(parseArgs(["run"])).toEqual({ command: "run", config: "baseline", scenario: "haunt-01", headless: false, timeScale: 1, debug: false });
  });

  it("reads every run flag", () => {
    expect(
      parseArgs(["run", "--config", '{"lip":"L1"}', "--scenario", "x", "--seed", "3", "--headless", "--llm", "cli", "--model", "m", "--control-fixture", "--time-scale", "0.5", "--debug"]),
    ).toEqual({ command: "run", config: '{"lip":"L1"}', scenario: "x", seed: 3, headless: true, llm: "cli", model: "m", fixture: "", timeScale: 0.5, debug: true });
    expect(parseArgs(["run", "--control-fixture", "f.json"])).toMatchObject({ fixture: "f.json" });
  });

  it("reads replay, fixture, setup and help; ignores pnpm's --", () => {
    expect(parseArgs(["replay", "r1", "--headless"])).toEqual({ command: "replay", runId: "r1", headless: true, debug: false });
    expect(parseArgs(["--", "fixture", "r1"])).toEqual({ command: "fixture", runId: "r1" });
    expect(parseArgs(["setup"])).toEqual({ command: "setup" });
    expect(parseArgs([])).toEqual({ command: "help" });
  });

  it("reads runs and compare", () => {
    expect(parseArgs(["compare", "a", "b"])).toEqual({ command: "compare", a: "a", b: "b" });
    expect(parseArgs(["runs", "--scenario", "haunt-01"])).toEqual({ command: "runs", scenario: "haunt-01" });
    expect(parseArgs(["runs"])).toEqual({ command: "runs" });
    expect(() => parseArgs(["compare", "a"])).toThrow("pnpm lab compare needs two run ids: pnpm lab compare <runA> <runB>.");
    expect(() => parseArgs(["runs", "--nope"])).toThrow('Unknown flag "--nope" for pnpm lab runs.');
  });

  it("fails with a sentence on bad input", () => {
    expect(() => parseArgs(["run", "--llm", "grpc"])).toThrow("--llm must be api or cli.");
    expect(() => parseArgs(["run", "--seed"])).toThrow("--seed needs a number.");
    expect(() => parseArgs(["run", "--nope"])).toThrow('Unknown flag "--nope"');
    expect(() => parseArgs(["replay"])).toThrow("needs a run id");
    expect(() => parseArgs(["dance"])).toThrow('Unknown command "dance"');
  });
});
