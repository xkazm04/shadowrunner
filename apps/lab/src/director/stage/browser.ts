// Playwright Chromium for the stage page, 1920x1080 at DPR 1. Headed by default; headless uses the
// e2e flags of apps/web/playwright.e2e.config.ts plus GPU flags first: Chromium uses the GPU when it
// can and falls back to SwiftShader (allowed by --enable-unsafe-swiftshader) when it cannot. The
// page reports which backend actually rendered. CPU is sampled from the whole browser process tree
// over CDP (SystemInfo.getProcessInfo: cumulative CPU seconds per process).
import { chromium, type Browser, type CDPSession, type Page } from "playwright";
import { isFiniteNumber, isRecord } from "../json.js";

/** apps/web/playwright.e2e.config.ts launch args (fake media + autoplay + SwiftShader allowed). */
export const E2E_FLAGS = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
  "--enable-unsafe-swiftshader",
];
/** Asked for first in headless runs. */
export const GPU_FLAGS = ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"];

export const STAGE_WIDTH = 1920;
export const STAGE_HEIGHT = 1080;

export interface Stage {
  page: Page;
  /** CPU seconds used so far by every browser process; undefined when CDP cannot tell. */
  cpuSeconds(): Promise<number | undefined>;
  close(): Promise<void>;
}

export interface StageLaunch {
  url: string;
  headless: boolean;
  log(line: string): void;
}

async function processCpu(cdp: CDPSession): Promise<number | undefined> {
  try {
    const info: unknown = await cdp.send("SystemInfo.getProcessInfo");
    if (!isRecord(info) || !Array.isArray(info.processInfo)) return undefined;
    let total = 0;
    for (const p of info.processInfo) if (isRecord(p) && isFiniteNumber(p.cpuTime)) total += p.cpuTime;
    return total;
  } catch {
    return undefined;
  }
}

export async function launchStage({ url, headless, log }: StageLaunch): Promise<Stage> {
  const args = headless
    ? [...GPU_FLAGS, ...E2E_FLAGS, "--use-angle=default"]
    : ["--autoplay-policy=no-user-gesture-required", `--window-size=${STAGE_WIDTH},${STAGE_HEIGHT + 140}`];
  // channel "chromium" is the full browser in new-headless mode (the headless shell has no GPU path).
  const browser: Browser = await chromium.launch({ headless, channel: "chromium", args });
  const context = await browser.newContext({ viewport: { width: STAGE_WIDTH, height: STAGE_HEIGHT }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") log(`page ${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", (error) => log(`page error: ${error.message}`));
  page.on("response", (res) => {
    if (res.status() >= 400) log(`page fetch ${res.status()}: ${res.url()}`);
  });
  const cdp = await browser.newBrowserCDPSession();
  await page.goto(url);
  return {
    page,
    cpuSeconds: () => processCpu(cdp),
    async close() {
      await browser.close();
    },
  };
}
