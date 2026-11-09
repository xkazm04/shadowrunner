// Avatar packs and their reach, live in a browser (playwright.e2e.config.ts). Every check here was
// first run by hand on 2026-11-04; the first run found the rigs' opaque painted backdrop drawn by
// the overlay, the embed and the studio, which no unit test could see, so transparency is checked
// on PIXELS of the rendered output, not on CSS.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "@playwright/test";

/** RGBA of one pixel of a PNG screenshot, decoded by the browser itself (no image library needed). */
async function pixel(page: Page, png: Buffer, x: number, y: number): Promise<number[]> {
  return page.evaluate(
    async ({ data, x, y }) => {
      const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
      const canvas = new OffscreenCanvas(image.width, image.height);
      const ctx = canvas.getContext("2d");
      if (ctx === null) throw new Error("no 2d context");
      ctx.drawImage(image, 0, 0);
      return [...ctx.getImageData(x, y, 1, 1).data];
    },
    { data: png.toString("base64"), x, y },
  );
}

/** Fails the test on any page error and on any 4xx/5xx except the health probe (no /api on preview). */
function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().endsWith("/api/health")) problems.push(`${response.status()} ${response.url()}`);
  });
  return problems;
}

test("overlay: a cutout on a transparent page, lip-synced to the microphone, moods on keys", async ({ page }) => {
  const problems = watch(page);
  await page.goto("/overlay?pack=moth-widow&mic=1&mood=smug");
  const stage = page.locator("[data-load]");
  await expect(stage).toHaveAttribute("data-load", "ready", { timeout: 30_000 });
  await expect(stage).toHaveAttribute("data-mic", "running", { timeout: 15_000 });
  await expect(page.locator("header")).toHaveCount(0);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgba(0, 0, 0, 0)");

  await page.waitForTimeout(1500);
  const shot = await page.screenshot({ omitBackground: true });
  expect((await pixel(page, shot, 5, 5))[3], "outside the rig").toBe(0);
  expect((await pixel(page, shot, 640, 60))[3], "inside the rig's square, above the head: the backdrop is hidden").toBe(0);
  expect((await pixel(page, shot, 640, 450))[3], "the face").toBe(255);

  const url = page.url();
  for (const key of ["1", "4", "0", "g"]) await page.keyboard.press(key);
  await page.waitForTimeout(500);
  expect(page.url(), "mood keys never reach the shell's channel keys").toBe(url);
  expect(problems).toEqual([]);
});

test("overlay without a source: the setup card", async ({ page }) => {
  await page.goto("/overlay");
  await expect(page.getByText(/enable-media-stream/)).toBeVisible({ timeout: 15_000 });
});

test("studio: a borrowed recorded line, recorded into a WebM with video and audio", async ({ page }, info) => {
  const problems = watch(page);
  await page.goto("/studio");
  const cast = page.locator("select").first();
  await expect.poll(() => cast.locator("option").count(), { timeout: 30_000 }).toBeGreaterThan(1);
  await cast.selectOption({ label: "The Tallyman" });
  await expect(page.locator('[data-studio="borrowed"]')).toBeVisible({ timeout: 15_000 });
  // The script starts as one recorded line (perfection-pass task 6; the multi-line, preset and
  // transparent takes are studio.e2e.spec.ts).
  await expect(page.locator('[aria-label="Script"] li')).toHaveCount(1);

  await page.locator('[data-studio="record"]').click();
  const link = page.locator("a[download]");
  await link.waitFor({ timeout: 60_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  const file = info.outputPath(download.suggestedFilename());
  await download.saveAs(file);
  expect(file).toMatch(/\.webm$/);
  expect(statSync(file).size).toBeGreaterThan(100_000);
  const bytes = readFileSync(file);
  expect(bytes.subarray(0, 4).toString("hex"), "EBML (Matroska/WebM) header").toBe("1a45dfa3");
  expect(bytes.includes("V_VP"), "a VP8/VP9 video track").toBe(true);
  expect(bytes.includes("A_OPUS"), "an Opus audio track").toBe(true);
  // MediaRecorder writes no Duration; the studio adds it so editors can seek (webmDuration.ts).
  const at = bytes.subarray(0, 512).indexOf(Buffer.from([0x44, 0x89, 0x88]));
  expect(at, "a Duration element in the header").toBeGreaterThan(0);
  expect(bytes.readDoubleBE(at + 3), "the take's length, ms").toBeGreaterThan(1000);
  try {
    const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type:format=duration", "-of", "default=nw=1", file]).toString();
    expect(probe).toMatch(/codec_type=video/);
    expect(probe).toMatch(/codec_type=audio/);
    expect(Number(/duration=([\d.]+)/.exec(probe)?.[1]), "ffprobe reads a duration, s").toBeGreaterThan(1);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; // ffprobe is optional
  }
  expect(problems).toEqual([]);
});

test("creator: export a cast character, import it back as a copy, refuse junk; Malakor stays", async ({ page }, info) => {
  const problems = watch(page);
  await page.goto("/creator");
  const card = page.locator("li[data-character]:has(button[data-export])").first();
  await card.waitFor({ state: "attached", timeout: 30_000 });
  await expect(page.locator('li[data-character*="malakor"] button[data-export]')).toHaveCount(0);
  await card.hover();
  await card.locator("button[data-export]").click();

  const sheet = page.locator('[data-export-sheet] [role="dialog"]');
  await sheet.locator('input[name="author"]').fill("E2E tester");
  await sheet.locator('select[name="licence"]').selectOption("CC-BY-4.0");
  const [download] = await Promise.all([page.waitForEvent("download"), sheet.getByRole("button", { name: "Download" }).click()]);
  const pack = info.outputPath(download.suggestedFilename());
  await download.saveAs(pack);
  expect(pack).toMatch(/\.srpack$/);
  expect(readFileSync(pack).subarray(0, 2).toString(), "a zip").toBe("PK");

  const before = await page.locator("li[data-character]").count();
  await page.locator("input[data-import-input]").setInputFiles(pack);
  await expect(page.locator('[data-import-notice="done"]')).toContainText("(copy)", { timeout: 30_000 });
  await expect(page.locator("li[data-character]")).toHaveCount(before + 1);

  const junk = info.outputPath("junk.srpack");
  writeFileSync(junk, "not a zip");
  await page.locator("input[data-import-input]").setInputFiles(junk);
  await expect(page.locator('[data-import-notice="failed"]')).toHaveText("That file is not a Shadowrunner pack.");
  expect(problems).toEqual([]);
});

test.describe("embed", () => {
  let host: Server;
  let hostUrl: string;

  test.beforeAll(async ({ baseURL }) => {
    // Another origin: the host page loads the script and the pack cross-origin.
    host = createServer((_, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html><html><body style="margin:0;background:#222222">
<script type="module" src="${baseURL}/embed/sr-avatar.js"></script>
<sr-avatar id="a" src="${baseURL}/packs/the-tallyman.srpack" mood="smug" style="width:360px;height:360px;display:block"></sr-avatar>
<script>
  const a = document.getElementById("a");
  a.addEventListener("sr-ready", () => { document.title = "ready"; });
  a.addEventListener("sr-error", (e) => { document.title = "error: " + e.detail; });
</script></body></html>`);
    });
    await new Promise<void>((resolve) => host.listen(0, "127.0.0.1", resolve));
    hostUrl = `http://127.0.0.1:${(host.address() as AddressInfo).port}/`;
  });

  test.afterAll(async () => {
    await new Promise((resolve) => host.close(resolve));
  });

  test("<sr-avatar> on another origin: ready, a cutout over the host page, API and removal", async ({ page }) => {
    const problems = watch(page);
    await page.goto(hostUrl);
    await expect(page).toHaveTitle("ready", { timeout: 30_000 });
    await page.waitForTimeout(1500);
    const shot = await page.screenshot();
    expect((await pixel(page, shot, 20, 20)).slice(0, 3), "the host page shows through the backdrop").toEqual([34, 34, 34]);
    await page.evaluate(() => (document.getElementById("a") as HTMLElement & { setMood(m: string): void }).setMood("irritated"));
    await page.evaluate(() => document.getElementById("a")?.remove());
    await page.waitForTimeout(300);
    expect(problems).toEqual([]);
  });

  test("/embed shows the snippet", async ({ page }) => {
    await page.goto("/embed");
    await expect(page.locator("[data-embed-snippet]")).toContainText("/embed/sr-avatar.js", { timeout: 15_000 });
  });
});
