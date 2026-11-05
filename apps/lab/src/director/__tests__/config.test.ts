import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BASELINE } from "../../contract.js";
import { parseRunConfig, resolveConfig } from "../config.js";
import { REPO_ROOT } from "../paths.js";
import { loadScenario, parseScenario } from "../scenario.js";

describe("resolveConfig", () => {
  it("baseline is C0 L0 S0 O0", () => {
    expect(resolveConfig("baseline", "haunt-01", 5)).toEqual({ ...BASELINE, scenario: "haunt-01", seed: 5 });
  });

  it("inline JSON overrides single arms", () => {
    expect(resolveConfig('{"lip":"L1","character":"reveille"}', "haunt-01", 1)).toMatchObject({ control: "C0", lip: "L1", character: "reveille" });
  });

  it("rejects unknown arms and external runs with a sentence", () => {
    expect(() => resolveConfig('{"lip":"L9"}', "h", 1)).toThrow("config.lip must be one of L0, L1, L2");
    expect(() => resolveConfig('{"external":"overlord"}', "h", 1)).toThrow("not built yet");
    expect(() => resolveConfig("no-such-file.json", "h", 1)).toThrow("neither");
  });

  it("round-trips through config.json", () => {
    const config = { ...resolveConfig("baseline", "haunt-01", 2), replayOf: "r" };
    expect(parseRunConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
  });
});

describe("haunt-01", () => {
  const scenario = loadScenario("haunt-01");

  it("is 8 chat messages over about two minutes", () => {
    expect(scenario.chat).toHaveLength(8);
    const last = scenario.chat.at(-1)?.atMs ?? 0;
    expect(last).toBeGreaterThan(100_000);
    expect(last).toBeLessThanOrEqual(120_000);
  });

  it("names a cast character with expression variants", () => {
    expect(existsSync(join(REPO_ROOT, "assets", "replay", "forge", scenario.character, "head.joy.webp"))).toBe(true);
  });

  it("rejects malformed scenarios with a sentence", () => {
    expect(() => parseScenario({ ...scenario, chat: [] })).toThrow("chat must be a non-empty array");
    expect(() => parseScenario({ ...scenario, chat: [scenario.chat[0], scenario.chat[0]] })).toThrow("unique");
    expect(() => loadScenario("../etc")).toThrow("not a scenario id");
  });
});
