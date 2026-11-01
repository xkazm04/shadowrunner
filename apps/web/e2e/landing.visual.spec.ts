// The first frame, guarded (spec landing requirement 10.1; costume task 2, "The Lantern Slides"):
// the landing on the replay plane with reduced motion at 1600x900 in both themes, at 390x844 in
// halloween, with a slide pulled (its still thrown on the wall), and in the daemon-lost state, with
// Malakor live out of the dark. The running clocks are masked; with reduced motion nothing else
// moves but Malakor's seeded blinks.
// Contrast is measured on the rendered page (contrast.ts): every piece of working text against the
// brightest (or, for dark ink on paper, the darkest) pixel behind it with the text hidden: the
// chalk on the walls (pitch, chat, ghost note, hint), the tray's labels on its wood lit and cold,
// and the slides' paper tabs. And the face stays the brightest thing in the room: brighter than the
// ghost a pulled slide throws on the wall beside it (costume requirement 3.2, 10.4).
import { expect, test, type Locator, type Page } from "@playwright/test";
import { boxOf, percentileLuminance, pixels, ratio, textColour, withStyle, worstContrast, type Box } from "./contrast";

type Theme = "halloween" | "baseline";

/** WCAG 2 AA: normal text, and large text (24 px, or 18.66 px bold, and up). */
const AA = 4.5;
const AA_LARGE = 3;

const WIDE = { width: 1600, height: 900 } as const;
const PHONE = { width: 390, height: 844 } as const;

async function openSet(page: Page, theme: Theme, size: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(size);
  await page.addInitScript((t) => {
    window.localStorage.setItem("sr-theme", t);
  }, theme);
  // No functions run under `vite preview`: health never answers, and ?plane=replay pins replay.
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto("/?plane=replay");
  await expect(page.locator('[data-page="landing"]')).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("[data-shell]")).toHaveAttribute("data-motion", "reduced");
  await expect(page.locator('[data-badge="recorded"]')).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => img.decode().catch(() => undefined)));
  });
  // The face loads after the page (Apparition.tsx): wait for the renderer and a few frames on it.
  await expect(page.locator("[data-avatar] canvas")).toHaveCount(1, { timeout: 15_000 });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 500)));
}

/** The uptime and dead-air clocks tick every second. */
function clocks(page: Page) {
  return [page.locator("[data-clock]")];
}

async function loseDaemon(page: Page): Promise<void> {
  // The replay sample (key D): reduced motion switches to dark at once.
  await page.keyboard.press("d");
  await expect(page.locator('[data-page="landing"]')).toHaveAttribute("data-daemon", "dark");
  await expect(page.locator("[data-lantern]")).toHaveAttribute("data-lantern", "cold");
  await expect(page.locator("[data-no-carrier]")).toBeVisible();
}

/** The middle of `box`: `keep` of its width and height around its centre. */
function middle(box: Box, keep: number): Box {
  const width = Math.max(1, box.width * keep);
  const height = Math.max(1, box.height * keep);
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}

/**
 * Each text's colour against the pixels of its own box, shot with all `hide` text transparent.
 * `keep` < 1 measures only the middle of the box (a rotated paper tab, whose bounding box takes in
 * the dark slide around its corners).
 */
async function contrastOf(page: Page, parts: readonly Locator[], hide: string, inset = 1, keep = 1): Promise<number[]> {
  const colours = await Promise.all(parts.map((p) => textColour(p)));
  const boxes: Box[] = (await Promise.all(parts.map((p) => boxOf(p, inset)))).map((b) => middle(b, keep));
  const css = `${hide} { color: transparent !important; }`;
  const behind = await withStyle(page, css, () => Promise.all(boxes.map((b) => pixels(page, b))));
  return colours.map((c, i) => worstContrast(c, behind[i] ?? []));
}

/** The chalk on the walls: the pitch, and the chat's latest lines (the older ones fade by design). */
async function wallChalk(page: Page): Promise<Record<string, number>> {
  const pitch = page.locator("[data-pitch]");
  const pitchParts = [pitch.locator("p").first(), pitch.locator("h1"), pitch.locator("p").nth(1)];
  const lines = page.locator("[data-chat-line]");
  const n = await lines.count();
  // The phone's band holds the latest line whole (older ones fade under the top mask by design).
  const whole = (page.viewportSize()?.width ?? 0) < 600 ? 1 : 2;
  const latest = [...Array(Math.min(whole, n)).keys()].map((k) => lines.nth(n - 1 - k));
  const names = latest.map((l) => l.locator("span").first());
  const out: Record<string, number> = {};
  const p = await contrastOf(page, pitchParts, "[data-pitch] :is(p, h1, i)");
  ["overline", "title", "lede"].forEach((k, i) => (out[k] = p[i] ?? 0));
  const c = await contrastOf(page, latest, "[data-chat-line], [data-chat-line] *");
  c.forEach((v, i) => (out[`chat line -${i + 1}`] = v));
  const u = await contrastOf(page, names, "[data-chat-line], [data-chat-line] *");
  u.forEach((v, i) => (out[`chat name -${i + 1}`] = v));
  return out;
}

/** The tray's labels on the wood, and the tabs' numbers on their paper. */
async function trayText(page: Page): Promise<{ labels: Record<string, number>; tabs: Record<string, number> }> {
  const slides = await page.locator("[data-slide]").all();
  const ids = await Promise.all(slides.map((s) => s.getAttribute("data-slide")));
  const labels = await contrastOf(
    page,
    slides.map((s) => s.locator(":scope > span").last()),
    "[data-slide] > span:last-child",
  );
  const tabs = await contrastOf(
    page,
    slides.map((s) => s.locator(":scope > span").first().locator("span").last()),
    "[data-slide] > span:first-child > span:last-child",
    0,
    0.55,
  );
  const keyed = (v: number[]) => Object.fromEntries(v.map((x, i) => [ids[i] ?? String(i), x]));
  return { labels: keyed(labels), tabs: keyed(tabs) };
}

function expectAll(label: string, values: Record<string, number> | readonly number[], floor = AA): void {
  for (const [key, value] of Object.entries(values)) {
    expect.soft(value, `${label} ${key}: ${value.toFixed(2)}:1`).toBeGreaterThanOrEqual(floor);
  }
}

test("landing 1600x900 halloween", async ({ page }) => {
  await openSet(page, "halloween", WIDE);
  await expect(page).toHaveScreenshot("landing-1600x900-halloween.png", { mask: clocks(page) });
});

test("landing 1600x900 baseline", async ({ page }) => {
  await openSet(page, "baseline", WIDE);
  await expect(page).toHaveScreenshot("landing-1600x900-baseline.png", { mask: clocks(page) });
});

test("landing 390x844 halloween", async ({ page }) => {
  await openSet(page, "halloween", PHONE);
  await expect(page).toHaveScreenshot("landing-390x844-halloween.png", { mask: clocks(page) });
});

test("landing 390x844 daemon lost", async ({ page }) => {
  await openSet(page, "halloween", PHONE);
  await loseDaemon(page);
  await expect(page).toHaveScreenshot("landing-390x844-daemon-lost.png", { mask: clocks(page) });
});

test("landing slide pulled 1600x900 halloween", async ({ page }) => {
  await openSet(page, "halloween", WIDE);
  await page.locator('[data-slide="characters"]').hover();
  await expect(page.locator("[data-projection]")).toHaveAttribute("data-projection", "characters");
  await expect(page.locator("[data-hint]")).toBeVisible();
  await expect(page).toHaveScreenshot("landing-pulled-1600x900.png", { mask: clocks(page) });
});

test("landing daemon lost 1600x900 halloween", async ({ page }) => {
  await openSet(page, "halloween", WIDE);
  await loseDaemon(page);
  await expect(page.locator("[data-no-carrier]")).toContainText("he was right here");
  await expect(page.locator("[data-lamp]")).toHaveText("OFF AIR");
  await expect(page).toHaveScreenshot("landing-daemon-lost-1600x900.png", { mask: clocks(page) });
});

for (const [theme, size] of [
  ["halloween", WIDE],
  ["baseline", WIDE],
  ["halloween", PHONE],
] as const) {
  test(`chalk on the walls clears AA, ${theme} ${size.width}x${size.height}`, async ({ page }) => {
    test.setTimeout(60_000);
    await openSet(page, theme, size);
    expectAll("chalk", await wallChalk(page));
  });

  test(`the tray's labels and tabs clear AA, lit and cold, ${theme} ${size.width}x${size.height}`, async ({ page }) => {
    test.setTimeout(60_000);
    await openSet(page, theme, size);
    const lit = await trayText(page);
    expectAll("lit label", lit.labels);
    expectAll("tab", lit.tabs, AA_LARGE);
    await loseDaemon(page);
    const cold = await trayText(page);
    expectAll("cold label", cold.labels);
    expectAll("cold tab", cold.tabs, AA_LARGE);
  });
}

test("the ghost note and the paused chat clear AA once the daemon is lost", async ({ page }) => {
  await openSet(page, "halloween", WIDE);
  await loseDaemon(page);
  const note = page.locator("[data-no-carrier]");
  const ghost = await contrastOf(page, [note.locator("p").first(), note.locator("p").last()], "[data-no-carrier] p, [data-no-carrier] b");
  expectAll("ghost note", ghost);
  const chat = page.locator("[data-chat]");
  const paused = await contrastOf(page, [chat.locator("p").last(), page.locator("[data-chat-line]").last()], "[data-chat] p, [data-chat] span");
  expectAll("paused chat", paused);
});

test("a pulled slide's hint clears AA, and its ghost on the wall stays dimmer than the face", async ({ page }) => {
  test.setTimeout(90_000);
  await openSet(page, "halloween", WIDE);
  const face = await boxOf(page.locator("[data-apparition]"));
  for (const id of ["air", "characters", "daemon"]) {
    await page.locator(`[data-slide="${id}"]`).hover();
    await expect(page.locator("[data-projection]")).toHaveAttribute("data-projection", id);
    const hint = page.locator("[data-hint]");
    expectAll(`hint ${id}`, await contrastOf(page, [hint], "[data-hint], [data-hint] *", 0));
    // The face's core (its middle half), against the wall the ghost is thrown on beside it.
    const core: Box = { x: face.x + face.width / 4, y: face.y + face.height / 6, width: face.width / 2, height: face.height / 2 };
    const proj = await boxOf(page.locator("[data-projection]"));
    const wall: Box = { x: proj.x + proj.width * 0.08, y: core.y, width: Math.max(1, face.x - proj.x - proj.width * 0.08), height: core.height };
    const faceLum = percentileLuminance(await pixels(page, core), 0.95);
    const ghostLum = percentileLuminance(await pixels(page, wall), 0.95);
    expect.soft(ratio(faceLum, ghostLum), `face over ghost (${id}): ${faceLum.toFixed(3)} vs ${ghostLum.toFixed(3)}`).toBeGreaterThanOrEqual(1.5);
  }
});
