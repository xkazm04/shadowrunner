// The companions (spec companion-lanes, requirements 5.2 and 6.2-6.3) live in a browser against the
// production build (playwright.e2e.config.ts): Iris and Bun load by slug in the studio, the embed and
// the overlay, and every claim is read back on PIXELS of the rendered output (a canvas that drew, a
// transparent ground outside the figure, a mouth that moves with speech), not on CSS. The creator
// opens a companion with one press (no file picker) and its export round trip keeps the morph files.
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "@playwright/test";

const COMPANIONS = ["iris", "bun"] as const;
type Slug = (typeof COMPANIONS)[number];

interface CompanionRig {
  name: string;
  width: number;
  height: number;
  mouth: { cx: number; lineY: number; width: number };
  morph: { atlas: string; flow?: string; sway?: { map: string }; eyes: [[number, number], [number, number]] };
}

/** The rig the pack is built from (scripts/build-packs.mjs reads the same job). */
function rigOf(slug: Slug): CompanionRig {
  const job = JSON.parse(readFileSync(new URL(`../../../assets/replay/companions/${slug}/job.json`, import.meta.url), "utf8")) as { rig: CompanionRig };
  return job.rig;
}

/** A point between the eyes and the mouth (the nose: skin on both portraits), rig px. */
function facePoint(rig: CompanionRig): [number, number] {
  const [[lx, ly], [rx, ry]] = rig.morph.eyes;
  return [(lx + rx) / 2, ((ly + ry) / 2 + rig.mouth.lineY) / 2];
}

/** Rig px -> CSS px of a box the rig is fitted into whole (contain, centred: @sr/avatar fitView). */
function fit(box: { x: number; y: number; width: number; height: number }, rig: CompanionRig, [x, y]: [number, number]): [number, number] {
  const scale = Math.min(box.width / rig.width, box.height / rig.height);
  return [Math.round(box.x + (box.width - rig.width * scale) / 2 + x * scale), Math.round(box.y + (box.height - rig.height * scale) / 2 + y * scale)];
}

/** RGBA of a w x h block of a PNG screenshot, row-major, decoded by the browser itself. */
async function pixels(page: Page, png: Buffer, x: number, y: number, w = 1, h = 1): Promise<number[]> {
  return page.evaluate(
    async ({ data, x, y, w, h }) => {
      const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
      const canvas = new OffscreenCanvas(image.width, image.height);
      const ctx = canvas.getContext("2d");
      if (ctx === null) throw new Error("no 2d context");
      ctx.drawImage(image, 0, 0);
      return [...ctx.getImageData(x, y, w, h).data];
    },
    { data: png.toString("base64"), x, y, w, h },
  );
}

/** Mean absolute difference of two equal RGBA blocks over RGB. */
function meanDiff(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c += 1) sum += Math.abs((a[i + c] ?? 0) - (b[i + c] ?? 0));
    n += 3;
  }
  return n === 0 ? 0 : sum / n;
}

/** Standard deviation of the luma of an RGBA block: a flat fill is ~0, a drawn face is not. */
function lumaSpread(block: readonly number[]): number {
  const luma: number[] = [];
  for (let i = 0; i < block.length; i += 4) luma.push(0.299 * (block[i] ?? 0) + 0.587 * (block[i + 1] ?? 0) + 0.114 * (block[i + 2] ?? 0));
  const mean = luma.reduce((s, v) => s + v, 0) / luma.length;
  return Math.sqrt(luma.reduce((s, v) => s + (v - mean) ** 2, 0) / luma.length);
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

for (const slug of COMPANIONS) {
  const rig = rigOf(slug);

  test(`overlay: ${rig.name} by slug, a cutout on a transparent page`, async ({ page }) => {
    const problems = watch(page);
    await page.goto(`/overlay?pack=${slug}&mood=amused`);
    await expect(page.locator("[data-load]")).toHaveAttribute("data-load", "ready", { timeout: 30_000 });
    await page.waitForTimeout(1500);
    const shot = await page.screenshot({ omitBackground: true });
    const viewport = page.viewportSize() ?? { width: 1280, height: 860 };
    const [fx, fy] = fit({ x: 0, y: 0, ...viewport }, rig, facePoint(rig));
    expect((await pixels(page, shot, 5, 5))[3], "a corner, outside the figure (the painted backdrop is hidden)").toBe(0);
    expect((await pixels(page, shot, 5, viewport.height - 5))[3], "the bottom-left corner").toBe(0);
    const face = await pixels(page, shot, fx - 4, fy - 4, 9, 9);
    expect(face.filter((_, i) => i % 4 === 3).every((a) => a === 255), "the face is opaque").toBe(true);
    expect(lumaSpread(await pixels(page, shot, fx - 40, fy - 60, 81, 121)), "the face has drawn detail").toBeGreaterThan(8);
    expect(problems).toEqual([]);
  });

  test(`studio: ${rig.name} from the index, drawn on the stage, listed under Companions`, async ({ page }) => {
    const problems = watch(page);
    await page.goto("/studio");
    const cast = page.locator("select").first();
    await expect.poll(() => cast.locator("option").count(), { timeout: 30_000 }).toBeGreaterThan(2);
    // The studio still opens on a cast member (the index sorts "bun" first; the cast comes first).
    await expect(page.locator('[data-studio="stage"] canvas')).toHaveAttribute("aria-label", /, live$/, { timeout: 30_000 });
    await expect(page.locator('[data-studio="stage"] canvas')).not.toHaveAttribute("aria-label", /^(Iris|Bun),/);
    await expect(cast.locator('optgroup[label="Companions"] option')).toHaveText(["Bun", "Iris"]);
    await cast.selectOption({ label: rig.name });
    const canvas = page.locator('[data-studio="stage"] canvas');
    await expect(canvas).toHaveAttribute("aria-label", `${rig.name}, live`, { timeout: 30_000 });
    await page.waitForTimeout(1500);
    const box = await canvas.boundingBox();
    if (box === null) throw new Error("no stage canvas");
    const shot = await page.screenshot();
    const ground = await page.locator('[data-studio="stage"]').evaluate((el) => getComputedStyle(el).backgroundColor);
    const rgb = (ground.match(/\d+/g) ?? []).slice(0, 3).map(Number);
    const corner = await pixels(page, shot, Math.round(box.x) + 4, Math.round(box.y) + 4);
    corner.slice(0, 3).forEach((v, i) => expect(Math.abs(v - (rgb[i] ?? -999)), "the stage colour shows at the corner: no painted backdrop").toBeLessThanOrEqual(2));
    const [fx, fy] = fit(box, rig, facePoint(rig));
    const face = await pixels(page, shot, fx - 30, fy - 45, 61, 91);
    expect(lumaSpread(face), "the canvas drew a face").toBeGreaterThan(8);
    expect(meanDiff(face.slice(0, 4), corner), "the face is not the stage colour").toBeGreaterThan(20);
    expect(problems).toEqual([]);
  });
}

test.describe("embed", () => {
  let host: Server;
  let hostUrl: string;

  test.beforeAll(async ({ baseURL }) => {
    // Another origin with a page that paints nothing: the element's own pixels decide the alpha.
    host = createServer((request, response) => {
      const slug = new URL(request.url ?? "/", "http://x").searchParams.get("pack") ?? "iris";
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html><html><body style="margin:0">
<script type="module" src="${baseURL}/embed/sr-avatar.js"></script>
<sr-avatar id="a" src="${baseURL}/packs/${slug}.srpack" style="width:360px;height:360px;display:block"></sr-avatar>
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

  for (const slug of COMPANIONS) {
    const rig = rigOf(slug);
    test(`<sr-avatar> ${rig.name}: transparent outside the figure, opaque face, the mouth moves with the level`, async ({ page }) => {
      const problems = watch(page);
      // Reduced motion stills the idle drift and the saccades, so the mouth region changes only with speech.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`${hostUrl}?pack=${slug}`);
      await expect(page).toHaveTitle("ready", { timeout: 30_000 });
      await page.waitForTimeout(1500);
      const box = { x: 0, y: 0, width: 360, height: 360 };
      const shot = await page.screenshot({ omitBackground: true });
      expect((await pixels(page, shot, 3, 3))[3], "a corner, outside the figure").toBe(0);
      expect((await pixels(page, shot, 356, 3))[3], "the other top corner").toBe(0);
      const [fx, fy] = fit(box, rig, facePoint(rig));
      const face = await pixels(page, shot, fx - 2, fy - 2, 5, 5);
      expect(face.filter((_, i) => i % 4 === 3).every((a) => a === 255), "the face is opaque").toBe(true);

      // The mouth's region (Rig.mouth), sampled twice in silence and once while speaking.
      const [mx, my] = fit(box, rig, [rig.mouth.cx, rig.mouth.lineY]);
      const half = Math.max(8, Math.round((rig.mouth.width * 360) / rig.width / 2) + 4);
      const roi = async (): Promise<number[]> => pixels(page, await page.screenshot({ omitBackground: true }), mx - half, my - half, half * 2, half * 2);
      const quiet = async (): Promise<number[]> => {
        await page.evaluate(() => (document.getElementById("a") as HTMLElement & { setLevel(l: number | undefined): void }).setLevel(0));
        await page.waitForTimeout(700);
        return roi();
      };
      const silent1 = await quiet();
      const silent2 = await quiet();
      await page.evaluate(() => (document.getElementById("a") as HTMLElement & { setLevel(l: number | undefined): void }).setLevel(1));
      await page.waitForTimeout(700);
      const speaking = await roi();
      const still = meanDiff(silent1, silent2);
      const moved = meanDiff(silent2, speaking);
      console.log(`[embed ${slug}] mouth ROI ${half * 2}px: silence vs silence ${still.toFixed(2)}, silence vs speech ${moved.toFixed(2)}`);
      expect(moved, "the mouth region changes with speech").toBeGreaterThan(3);
      expect(moved, "by far more than it drifts in silence").toBeGreaterThan(still * 3 + 1);
      expect(problems).toEqual([]);
    });
  }
});

test("creator: a companion opens with one press, no file picker; the cast offers stay as they were", async ({ page }) => {
  const problems = watch(page);
  await page.goto("/creator");
  const iris = page.locator('li[data-offer="iris"][data-offer-kind="companion"] button');
  await iris.waitFor({ timeout: 30_000 });
  await expect(page.locator('li[data-offer-kind="companion"]')).toHaveCount(2);
  await iris.click();
  await expect(page.locator('li[data-character="iris"]')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator('li[data-offer="iris"]')).toHaveCount(0);
  await page.locator('li[data-character="iris"] button').first().click();
  await expect(page.getByRole("region", { name: "The glass: Iris" })).toBeVisible({ timeout: 15_000 });
  expect(problems).toEqual([]);
});

test("creator: a companion's export keeps its morph files, and the pack imports back", async ({ page }, info) => {
  const problems = watch(page);
  await page.goto("/creator");
  const bun = page.locator('li[data-offer="bun"] button');
  await bun.waitFor({ timeout: 30_000 });
  await bun.click();
  const card = page.locator('li[data-character="bun"]');
  await expect(card).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByRole("region", { name: "The glass: Bun" })).toBeVisible({ timeout: 15_000 });
  await page.locator("button[data-export-pack]").click();
  const sheet = page.locator('[data-export-sheet] [role="dialog"]');
  const [download] = await Promise.all([page.waitForEvent("download"), sheet.getByRole("button", { name: "Download" }).click()]);
  const pack = info.outputPath(download.suggestedFilename());
  await download.saveAs(pack);
  const bytes = readFileSync(pack);
  const rig = rigOf("bun");
  for (const name of [rig.morph.atlas, rig.morph.flow, rig.morph.sway?.map].filter((n): n is string => n !== undefined)) {
    expect(bytes.includes(`files/${name}`), `the pack carries ${name}`).toBe(true);
  }
  await page.locator("input[data-import-input]").setInputFiles(pack);
  await expect(page.locator('[data-import-notice="done"]')).toContainText("Bun (copy)", { timeout: 30_000 });
  await page.locator('li[data-character]:has-text("Bun (copy)") button').first().click();
  await expect(page.getByRole("region", { name: "The glass: Bun (copy)" })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  const glass = page.getByRole("region", { name: "The glass: Bun (copy)" }).locator("canvas").first();
  const box = await glass.boundingBox();
  if (box === null) throw new Error("no glass canvas");
  const shot = await page.screenshot();
  const [fx, fy] = fit(box, rig, facePoint(rig));
  expect(lumaSpread(await pixels(page, shot, fx - 30, fy - 45, 61, 91)), "the re-imported copy draws a face").toBeGreaterThan(8);
  expect(problems).toEqual([]);
});
