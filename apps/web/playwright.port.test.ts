// The Playwright configs take their preview port from the environment (perfection-pass 14.4).
import { afterEach, describe, expect, it, vi } from "vitest";
import { portFrom } from "./playwright.port";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("portFrom", () => {
  it("keeps the default when the variable is unset or blank, reads a port, refuses junk", () => {
    expect(portFrom({}, "SR_E2E_PORT", 4320)).toBe(4320);
    expect(portFrom({ SR_E2E_PORT: " " }, "SR_E2E_PORT", 4320)).toBe(4320);
    expect(portFrom({ SR_E2E_PORT: "4400" }, "SR_E2E_PORT", 4320)).toBe(4400);
    for (const junk of ["43a0", "0", "65536", "4320.5", "-1"]) expect(() => portFrom({ SR_E2E_PORT: junk }, "SR_E2E_PORT", 4320)).toThrow(/SR_E2E_PORT/);
  });
});

describe("the configs", () => {
  it("serve and browse the e2e suite on SR_E2E_PORT, 4320 by default", async () => {
    vi.stubEnv("SR_E2E_PORT", "");
    const plain = (await import("./playwright.e2e.config")).default;
    expect(plain.use?.baseURL).toBe("http://localhost:4320");
    vi.resetModules();
    vi.stubEnv("SR_E2E_PORT", "4411");
    const moved = (await import("./playwright.e2e.config")).default;
    expect(moved.use?.baseURL).toBe("http://localhost:4411");
    const server = Array.isArray(moved.webServer) ? moved.webServer[0] : moved.webServer;
    expect(server?.command).toContain("--port 4411");
    expect(server?.url).toBe("http://localhost:4411");
  });

  it("serve the visual guard on SR_VISUAL_PORT, 4319 by default", async () => {
    vi.stubEnv("SR_VISUAL_PORT", "");
    expect((await import("./playwright.config")).default.use?.baseURL).toBe("http://localhost:4319");
    vi.resetModules();
    vi.stubEnv("SR_VISUAL_PORT", "4412");
    expect((await import("./playwright.config")).default.use?.baseURL).toBe("http://localhost:4412");
  });
});
