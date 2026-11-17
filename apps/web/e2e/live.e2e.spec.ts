// /live in a browser against a fake `fhl/1` server (spec flashhead-live, task 3; fakeLive.ts on
// port 8790, so no GPU): the empty state with the server down, the control page connected with
// its state line and a Speak that reaches the server, and the OBS view drawing frames on a
// transparent page, playing the tone, laying a slide out with Iris in a corner, and the control
// page's Clear slide (an empty 0x13, relayed as an empty 0x03) putting her back in the centre.
// Transparency is checked on pixels of the rendered page, as the overlay's test does.
// Round 2: the Matte switch round-trips through `state`; matted 0x04 frames at 1024 px leave the
// page transparent outside the alpha circle, with the draw time measured; and Stop flushes: the
// out page drops the tone it had scheduled, and the control page's preview flushes before the
// server's marker arrives.
import sharp from "sharp";
import { expect, test, type Page } from "@playwright/test";
import { WebSocket } from "ws";
import { FAKE_PORT, MATTE_RADIUS, startFakeLive, type FakeLive } from "./fakeLive";

const SERVER = `ws://127.0.0.1:${FAKE_PORT}/live`;
const query = `server=${encodeURIComponent(SERVER)}`;

/** RGBA of one pixel of a PNG screenshot, decoded by the browser itself. */
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

/** A coarse fingerprint of what the out canvas shows right now. */
const canvasPrint = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("[data-live-out] canvas");
    const ctx = canvas?.getContext("2d");
    if (canvas === null || canvas === undefined || ctx === null || ctx === undefined || canvas.width === 0) return "empty";
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4099) sum = (sum * 31 + (data[i] ?? 0)) % 1_000_003;
    return String(sum);
  });

function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

/** A node control client: what the control page would send, without the page. */
async function control(): Promise<WebSocket> {
  const ws = new WebSocket(SERVER, { origin: "http://localhost" });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  ws.send(JSON.stringify({ type: "hello", role: "control" }));
  return ws;
}

test.describe("live", () => {
  let fake: FakeLive | undefined;

  test.afterEach(async () => {
    await fake?.close();
    fake = undefined;
  });

  test("with the server down: the start-the-server empty state, then connects when it comes up", async ({ page }) => {
    const problems = watch(page);
    await page.goto(`/live?${query}`);
    const empty = page.locator('[data-live="empty"]');
    await expect(empty).toBeVisible({ timeout: 15_000 });
    await expect(empty).toContainText("Start the live server:");
    await expect(empty.locator("code").first()).toHaveText(`uv run th live --port ${FAKE_PORT}`);
    await expect(empty.getByRole("button", { name: "Copy" })).toBeVisible();
    await expect(page.locator('[data-page="live"]')).toHaveAttribute("data-status", "down");
    await expect(page.locator('[data-live="speak"]')).toBeDisabled();

    fake = await startFakeLive();
    await expect(page.locator('[data-page="live"]')).toHaveAttribute("data-status", "open", { timeout: 15_000 });
    await expect(empty).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test("control: connected with its state line; Speak sends a say the server receives", async ({ page }) => {
    const problems = watch(page);
    fake = await startFakeLive();
    await page.goto(`/live?${query}`);
    await expect(page.locator('[data-page="live"]')).toHaveAttribute("data-status", "open", { timeout: 15_000 });
    await expect(page.locator('[data-live="connection"]')).toContainText("Connected");
    await expect(page.locator('[data-live="state"]')).toHaveText("ready · 25 fps · upscale none · delay 250 ms · queue 0 · 512 px · source text · matte off · idle loop · motion plain");

    await page.locator('[data-live="line-text"]').fill("Good evening from the cellar.");
    await page.locator('[data-live="speak"]').click();
    const live = fake;
    await expect.poll(() => live.received.find((r) => r.message.type === "say")?.message.text, { timeout: 5000 }).toBe("Good evening from the cellar.");
    expect(live.received.find((r) => r.message.type === "say")?.role).toBe("control");
    const line = page.locator('[data-live="lines"] li').first();
    await expect(line).toHaveAttribute("data-state", "done", { timeout: 5000 });
    await expect(line).toContainText("chunk 410 ms");
    await expect(line).toContainText("1.0 s");

    // The upscaler switch round-trips through the server's state.
    await page.getByRole("radio", { name: "Real-ESRGAN" }).check();
    await expect(page.locator('[data-live="state"]')).toContainText("upscale realesrgan");
    // The preview is an `out` client too: it draws the stream.
    const preview = page.locator('[data-live-out="preview"]');
    await expect.poll(async () => Number(await preview.getAttribute("data-drawn")), { timeout: 10_000 }).toBeGreaterThan(5);

    // The matte switch round-trips through the server's state too.
    await page.locator('[data-live="matte"]').getByRole("radio", { name: "On" }).check();
    await expect.poll(() => live.received.find((r) => r.message.type === "matte")?.message.on, { timeout: 5000 }).toBe(true);
    await expect(page.locator('[data-live="state"]')).toContainText("1024 px · source text · matte on · idle loop");
    await expect(page.locator('[data-live="matte"]').getByRole("radio", { name: "On" })).toBeChecked();

    // Stop flushes the preview at once (the local flush), then again on the server's marker.
    await page.locator('[data-live="line-text"]').fill("Cut me off.");
    await page.locator('[data-live="speak"]').click();
    await expect(page.locator('[data-live="state"]')).toContainText("idle live", { timeout: 5000 });
    await page.locator('[data-live="stop"]').click();
    await expect(preview).toHaveAttribute("data-flushes", "2", { timeout: 5000 });
    await expect(page.locator('[data-live="state"]')).toContainText("idle loop");
    expect(problems).toEqual([]);
  });

  test("out: frames on a transparent page with no chrome, the tone scheduled, a slide with Iris in a corner, then cleared", async ({ page }) => {
    const problems = watch(page);
    fake = await startFakeLive();
    await page.goto(`/live?out=1&${query}`);
    const out = page.locator('[data-live-out="page"]');
    await expect(out).toHaveAttribute("data-status", "open", { timeout: 15_000 });
    await expect(page.locator("header")).toHaveCount(0);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgba(0, 0, 0, 0)");

    await expect.poll(async () => Number(await out.getAttribute("data-drawn")), { timeout: 10_000 }).toBeGreaterThan(10);
    await expect(out).toHaveAttribute("data-size", "512x512");
    const first = await canvasPrint(page);
    await page.waitForTimeout(300);
    expect(await canvasPrint(page), "the canvas changes as frames play").not.toBe(first);

    const shot = await page.screenshot({ omitBackground: true });
    expect((await pixel(page, shot, 5, 5))[3], "the corner is transparent").toBe(0);
    expect((await pixel(page, shot, 640, 430))[3], "Iris's frame, centred, is opaque").toBe(255);

    const ws = await control();
    ws.send(JSON.stringify({ type: "say", id: "e2e-1", text: "A tone." }));
    await expect.poll(async () => Number(await out.getAttribute("data-chunks")), { timeout: 5000 }).toBeGreaterThan(20);

    const slide = await sharp({ create: { width: 160, height: 90, channels: 3, background: { r: 200, g: 180, b: 120 } } }).png().toBuffer();
    ws.send(JSON.stringify({ type: "slide", index: 0 }));
    ws.send(Buffer.concat([Buffer.from([0x13]), slide]));
    await expect(out).toHaveAttribute("data-slide", "0", { timeout: 5000 });
    await expect(page.getByRole("img", { name: "Slide 1" })).toBeVisible();
    const box = await page.locator('[data-live-out="page"] canvas').boundingBox();
    expect(box, "Iris has moved to the bottom-right corner").not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeGreaterThan(1200);
    expect(box?.width ?? 0).toBeLessThan(420);
    ws.close();

    // The control page's "Clear slide": `slide` + an EMPTY 0x13, relayed as an empty 0x03, puts
    // Iris back in the centre at full size.
    const controlPage = await page.context().newPage();
    const controlProblems = watch(controlPage);
    await controlPage.goto(`/live?${query}`);
    await expect(controlPage.locator('[data-page="live"]')).toHaveAttribute("data-status", "open", { timeout: 15_000 });
    await controlPage.getByRole("tab", { name: "Slides" }).click();
    await controlPage.locator('[data-live="slide-clear"]').click();
    await expect(out).not.toHaveAttribute("data-slide", /.*/, { timeout: 5000 });
    await expect(page.getByRole("img", { name: "Slide 1" })).toHaveCount(0);
    const live = fake;
    const clearMsg = live.received.filter((r) => r.message.type === "slide").at(-1);
    expect(clearMsg?.role, "the clear comes from the control page").toBe("control");
    expect(live.binary.at(-1)).toBe(0x13);
    const centred = await page.locator('[data-live-out="page"] canvas').boundingBox();
    expect(centred?.width ?? 0, "Iris is full size again").toBeGreaterThan(800);
    expect(Math.abs((centred?.x ?? 0) + (centred?.width ?? 0) / 2 - 640), "and centred").toBeLessThan(2);
    await controlPage.close();
    expect(controlProblems).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("out, matte on: 0x04 at 1024 px keeps the page transparent outside the alpha circle, and keeps up", async ({ page }) => {
    const problems = watch(page);
    fake = await startFakeLive();
    await page.goto(`/live?out=1&${query}`);
    const out = page.locator('[data-live-out="page"]');
    await expect(out).toHaveAttribute("data-status", "open", { timeout: 15_000 });
    const ws = await control();
    ws.send(JSON.stringify({ type: "matte", on: true }));
    await expect(out).toHaveAttribute("data-size", "1024x1024", { timeout: 10_000 });
    await expect(out).toHaveAttribute("data-composite", /^(webgl|cpu)$/);

    // The canvas is a centred square as tall as the 860 px viewport; the circle sits in its middle.
    const box = await page.locator('[data-live-out="page"] canvas').boundingBox();
    if (box === null) throw new Error("no canvas box");
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const r = MATTE_RADIUS * box.width;
    const shot = await page.screenshot({ omitBackground: true });
    const alphaAt = async (x: number, y: number) => (await pixel(page, shot, Math.round(x), Math.round(y)))[3];
    expect(await alphaAt(cx, cy), "inside the circle: opaque").toBeGreaterThan(0);
    expect(await alphaAt(cx, cy - r * 0.8), "inside, near the edge: opaque").toBeGreaterThan(0);
    for (const [x, y] of [
      [box.x + 12, box.y + 12],
      [box.x + box.width - 12, box.y + box.height - 12],
      [cx - r * 1.2, cy],
      [cx, cy + r * 1.1],
    ] as const) {
      expect(await alphaAt(x, y), `outside the circle at ${Math.round(x)},${Math.round(y)}, within the frame: clear`).toBe(0);
    }

    // Keeping up: over 4 s at 25 fps, the frames drawn and dropped, and the draw time per frame.
    const read = async () => ({
      drawn: Number(await out.getAttribute("data-drawn")),
      dropped: Number(await out.getAttribute("data-dropped")),
    });
    const before = await read();
    await page.waitForTimeout(4000);
    const after = await read();
    const figures = {
      composite: await out.getAttribute("data-composite"),
      fps: (after.drawn - before.drawn) / 4,
      dropped: after.dropped - before.dropped,
      drawP50Ms: Number(await out.getAttribute("data-draw-p50")),
      drawP95Ms: Number(await out.getAttribute("data-draw-p95")),
      decodeP95Ms: Number(await out.getAttribute("data-decode-p95")),
    };
    console.log(`matte 1024 px: ${JSON.stringify(figures)}`);
    test.info().annotations.push({ type: "matte-draw", description: JSON.stringify(figures) });
    expect(figures.fps, "draws at the stream's 25 fps").toBeGreaterThanOrEqual(23);
    expect(figures.dropped, "drops nothing").toBeLessThanOrEqual(2);
    expect(figures.drawP95Ms, "a frame's draw fits a 40 ms frame with room").toBeLessThan(20);
    ws.close();
    expect(problems).toEqual([]);
  });

  test("out, Stop: the server's stop marker flushes the scheduled tone; nothing plays past the flush", async ({ page }) => {
    const problems = watch(page);
    fake = await startFakeLive();
    await page.goto(`/live?out=1&${query}`);
    const out = page.locator('[data-live-out="page"]');
    await expect(out).toHaveAttribute("data-status", "open", { timeout: 15_000 });
    await expect.poll(async () => Number(await out.getAttribute("data-drawn")), { timeout: 10_000 }).toBeGreaterThan(5);

    const ws = await control();
    ws.send(JSON.stringify({ type: "say", id: "e2e-stop", text: "A tone to cut." }));
    await expect.poll(async () => Number(await out.getAttribute("data-chunks")), { timeout: 5000 }).toBe(25);
    const ahead = Number(await out.getAttribute("data-audio-ahead"));
    expect(ahead, "the tone is scheduled ahead of the audio clock").toBeGreaterThan(300);
    ws.send(JSON.stringify({ type: "stop" }));
    await expect(out).toHaveAttribute("data-flushes", "1", { timeout: 5000 });
    await expect(out).toHaveAttribute("data-audio-ahead", "0");
    const live = fake;
    expect(live.received.at(-1)?.message.type).toBe("stop");
    // Nothing scheduled after the flush either, and the stream plays on.
    const drawn = Number(await out.getAttribute("data-drawn"));
    await page.waitForTimeout(600);
    await expect(out).toHaveAttribute("data-audio-ahead", "0");
    await expect(out).toHaveAttribute("data-chunks", "25");
    expect(Number(await out.getAttribute("data-drawn"))).toBeGreaterThan(drawn + 5);
    ws.close();
    expect(problems).toEqual([]);
  });
});
