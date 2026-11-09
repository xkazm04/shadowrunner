// The studio director (perfection-pass task 6, requirements 6.2-6.4), live in a browser against
// the production build (playwright.e2e.config.ts). Every claim is read back from the recorded
// FILE: its pixel size as the browser decodes it, its alpha on pixels drawn over a known colour,
// and the last line's position in its decoded audio against where the take planned it.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/** Fails the test on any page error and on any 4xx/5xx except the health probe (no /api on preview). */
function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().endsWith("/api/health")) problems.push(`${response.status()} ${response.url()}`);
  });
  return problems;
}

/** The Tallyman on stage (he borrows Malakor's eight standalone recorded lines). */
async function openStudio(page: Page): Promise<void> {
  await page.goto("/studio");
  const cast = page.locator("select").first();
  await expect.poll(() => cast.locator("option").count(), { timeout: 30_000 }).toBeGreaterThan(1);
  await cast.selectOption({ label: "The Tallyman" });
  await expect(page.locator('[data-studio="borrowed"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[aria-label="Script"] li')).toHaveCount(1);
}

/** Picks Malakor's shortest standalone line (b21, 8.8 s) for row 1, to keep single-line takes short. */
async function shortLine(page: Page): Promise<void> {
  const show = JSON.parse(readFileSync(new URL("../../../assets/replay/shows/malakor-night.json", import.meta.url), "utf8")) as { beats: { wav: string; reply: { line: string } }[] };
  const text = show.beats.find((b) => b.wav.endsWith("b21.wav"))?.reply.line ?? "";
  const clip = page.locator('select[data-script="clip"]').first();
  const value = await clip.locator("option").evaluateAll((options, start) => options.find((o) => o.textContent?.startsWith(start))?.getAttribute("value"), text.slice(0, 30));
  await clip.selectOption(value ?? "");
}

interface Recorded {
  width: number;
  height: number;
  frames: number;
  wallMs: number;
  maxGapMs: number;
  driftMs: number;
}

/** Records, waits for the take, reads its figures, and returns them with what the browser decodes of the file. */
async function record(page: Page, timeout: number): Promise<{ take: Recorded; decoded: { width: number; height: number; duration: number } }> {
  await page.locator('[data-studio="record"]').click();
  const take = page.locator('[data-studio="take"]');
  await take.waitFor({ timeout });
  const read = async (name: string) => Number(await take.getAttribute(`data-${name}`));
  const figures: Recorded = {
    width: await read("width"),
    height: await read("height"),
    frames: await read("frames"),
    wallMs: await read("wall-ms"),
    maxGapMs: await read("max-gap-ms"),
    driftMs: await read("drift-ms"),
  };
  const decoded = await page.evaluate(async () => {
    const href = document.querySelector<HTMLAnchorElement>("a[download]")?.href ?? "";
    const video = document.createElement("video");
    video.muted = true;
    video.src = href;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = reject;
    });
    return { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
  });
  return { take: figures, decoded };
}

/** ffprobe's reading of the downloaded file, when ffprobe is installed (optional). */
function probe(file: string, entries: string): string | undefined {
  try {
    return execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", entries, "-of", "default=nw=1", file])
      .toString()
      .replace(/\r/g, "");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function save(page: Page, path: string): Promise<string> {
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("a[download]").click()]);
  await download.saveAs(path);
  return path;
}

for (const [id, width, height] of [
  ["square", 1080, 1080],
  ["landscape", 1920, 1080],
] as const) {
  test(`studio: the ${id} preset records ${width}x${height} whatever the stage's size`, async ({ page }, info) => {
    const problems = watch(page);
    await openStudio(page);
    await shortLine(page);
    const stage = await page.locator('[data-studio="stage"] canvas').boundingBox();
    const before = await page.locator('[data-studio="stage"] canvas').evaluate((c) => [(c as HTMLCanvasElement).width, (c as HTMLCanvasElement).height]);
    await page.locator(`input[name="studio-aspect"][value="${id}"]`).check();
    const { take, decoded } = await record(page, 60_000);
    expect([take.width, take.height]).toEqual([width, height]);
    expect([decoded.width, decoded.height], "the file's own pixel size").toEqual([width, height]);
    const after = await page.locator('[data-studio="stage"] canvas').boundingBox();
    expect([after?.width, after?.height], "the on-screen stage keeps its size").toEqual([stage?.width, stage?.height]);
    expect(
      await page.locator('[data-studio="stage"] canvas').evaluate((c) => [(c as HTMLCanvasElement).width, (c as HTMLCanvasElement).height]),
      "and its drawing buffer (the take drew on a second canvas)",
    ).toEqual(before);
    const file = await save(page, info.outputPath(`${id}.webm`));
    const ff = probe(file, "stream=width,height,nb_read_frames");
    if (ff !== undefined) expect(ff).toContain(`width=${width}\nheight=${height}`);
    info.annotations.push({ type: "take", description: JSON.stringify({ id, ...take, decoded, ffprobe: ff?.replace(/\n/g, " ") }) });
    console.log(`[studio ${id}]`, JSON.stringify({ ...take, decoded, ffprobe: ff?.replace(/\n/g, " ") }));
    expect(problems).toEqual([]);
  });
}

test("studio: a transparent take carries alpha on pixels (the backdrop shows through, the face does not)", async ({ page }, info) => {
  const problems = watch(page);
  await openStudio(page);
  await shortLine(page);
  await page.locator('input[name="studio-aspect"][value="square"]').check();
  await page.locator('[data-studio="transparent"]').click();
  await expect(page.locator('[data-studio="alpha-note"]')).toBeVisible();
  const { take } = await record(page, 60_000);
  expect([take.width, take.height]).toEqual([1080, 1080]);
  // Decode the file, draw a frame 2 s in over magenta, read a corner and the face.
  const pixels = await page.evaluate(async () => {
    const video = document.createElement("video");
    video.muted = true;
    video.src = document.querySelector<HTMLAnchorElement>("a[download]")?.href ?? "";
    await new Promise((resolve) => (video.oncanplay = resolve));
    video.currentTime = 2;
    await new Promise((resolve) => (video.onseeked = resolve));
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const g = canvas.getContext("2d", { willReadFrequently: true });
    if (g === null) throw new Error("no 2d context");
    g.fillStyle = "rgb(255, 0, 255)";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(video, 0, 0);
    const at = (x: number, y: number) => [...g.getImageData(x, y, 1, 1).data];
    // The Tallyman's head reaches the top centre; beside it, at eye height, is backdrop.
    return { corner: at(20, 20), besideHead: at(150, 300), face: at(540, 560) };
  });
  console.log("[studio transparent]", JSON.stringify({ ...take, pixels }));
  const file = await save(page, info.outputPath("transparent.webm"));
  expect(pixels.corner.slice(0, 3), "a corner is the magenta under the video").toEqual([255, 0, 255]);
  expect(pixels.besideHead.slice(0, 3), "beside the head, where the rig's painted backdrop was").toEqual([255, 0, 255]);
  const [r = 0, g = 0, b = 0] = pixels.face;
  expect(Math.abs(r - 255) + g + Math.abs(b - 255), "the face is opaque: not magenta").toBeGreaterThan(120);
  const ff = probe(file, "stream_tags=alpha_mode");
  if (ff !== undefined) expect(ff, "the WebM declares an alpha channel").toMatch(/alpha_mode=1/i);
  expect(problems).toEqual([]);
});

test("studio: an eight-line script at 9:16 is one take, and line 8 is where the plan put it", async ({ page }, info) => {
  test.setTimeout(360_000);
  const problems = watch(page);
  await openStudio(page);
  const add = page.locator('button[data-script="add"]');
  for (let i = 0; i < 7; i += 1) await add.click();
  await expect(page.locator('[aria-label="Script"] li')).toHaveCount(8);
  await expect(add).toBeDisabled();
  await page.locator('input[name="studio-aspect"][value="portrait"]').check();
  const urls = await page.locator('select[data-script="clip"]').evaluateAll((selects) => selects.map((s) => (s as HTMLSelectElement).value));
  expect(new Set(urls).size).toBe(8);

  const started = Date.now();
  const { take, decoded } = await record(page, 300_000);
  const elapsedMs = Date.now() - started;
  expect([take.width, take.height]).toEqual([1080, 1920]);
  expect([decoded.width, decoded.height]).toEqual([1080, 1920]);
  expect(Math.abs(take.driftMs), "picture vs sound by line 8, ms").toBeLessThan(40);

  // The file's own audio: where does each line start, against the plan (clip lengths + 350 ms pauses)?
  const audio = await page.evaluate(async (clips) => {
    const context = new AudioContext();
    const decode = async (url: string) => context.decodeAudioData(await (await fetch(url)).arrayBuffer());
    const sources = await Promise.all(clips.map(decode));
    const take = await decode(document.querySelector<HTMLAnchorElement>("a[download]")?.href ?? "");
    const rate = take.sampleRate;
    /** Mean |sample| per ms, mono. */
    const envelope = (buffer: AudioBuffer, ms: number) => {
      const step = Math.round(buffer.sampleRate / 1000);
      const out = new Float32Array(Math.min(ms, Math.floor(buffer.length / step)));
      for (let c = 0; c < buffer.numberOfChannels; c += 1) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < out.length; i += 1) {
          let sum = 0;
          for (let k = 0; k < step; k += 1) sum += Math.abs(data[i * step + k] ?? 0);
          out[i] = (out[i] ?? 0) + sum / step / buffer.numberOfChannels;
        }
      }
      return out;
    };
    const whole = envelope(take, Math.floor(take.duration * 1000));
    const planned: number[] = [];
    let at = 0;
    for (const [i, s] of sources.entries()) {
      if (i > 0) at += 350;
      planned.push(at);
      at += Math.round(s.length / (s.sampleRate / 1000));
    }
    // Each line: the lag (ms, within +-400 of the plan) that best matches its first 4 s of envelope.
    const found = sources.map((s, i) => {
      const probe = envelope(s, 4000);
      let best = { lag: 0, score: -Infinity };
      for (let lag = -400; lag <= 400; lag += 1) {
        let score = 0;
        const base = (planned[i] ?? 0) + lag;
        for (let k = 0; k < probe.length; k += 1) score += (probe[k] ?? 0) * (whole[base + k] ?? 0);
        if (score > best.score) best = { lag, score };
      }
      return (planned[i] ?? 0) + best.lag;
    });
    await context.close();
    return { rate, planned, found, takeS: take.duration };
  }, urls);
  const offsets = audio.found.map((f, i) => f - (audio.planned[i] ?? 0));
  const fileDriftMs = (offsets.at(-1) ?? 0) - (offsets[0] ?? 0);
  console.log("[studio 8 lines]", JSON.stringify({ ...take, decoded, elapsedMs, audio, offsets, fileDriftMs }));
  expect(Math.abs(fileDriftMs), "line 8's audio vs the plan, relative to line 1, ms").toBeLessThan(40);

  const file = await save(page, info.outputPath("eight-lines-portrait.webm"));
  const ff = probe(file, "stream=width,height,nb_read_frames:format=duration");
  if (ff !== undefined) {
    expect(ff).toContain("width=1080\nheight=1920");
    console.log("[studio 8 lines ffprobe]", ff.replace(/\n/g, " "));
  }
  expect(problems).toEqual([]);
});
