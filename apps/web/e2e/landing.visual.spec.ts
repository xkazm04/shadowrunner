// The first frame, guarded (spec landing requirement 10.1): the landing on the replay plane with
// reduced motion at 1600x900 in both themes, at 390x844 in halloween, and in the daemon-lost state
// at 1600x900, with the set (task 5.2) and Malakor live on its glass. The running clocks are
// masked; with reduced motion nothing else on the set moves but Malakor's seeded blinks.
// Contrast is measured on the rendered page (landing tasks 5.2 and 11): phosphor on the glass
// (the lower third and the channel caption) at 4.5:1 against the brightest pixel behind it, and
// the carved numbers against the cut behind them (design.md "Fixes") at 3:1, WCAG AA for large
// text: the numerals are 800-weight display glyphs, 52 css px at 1600x900 and 28 at 390x844.
import { expect, test, type Page } from "@playwright/test";
import { boxOf, carvedContrast, pixels, textColour, withStyle, worstOnBackground } from "./contrast";

type Theme = "halloween" | "baseline";

/** WCAG 2 AA: normal text, and large text (24 px, or 18.66 px bold, and up). */
const AA = 4.5;
const AA_LARGE = 3;

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
  // The picture loads after the page (Glass.tsx): wait for the renderer and a few frames on it.
  await expect(page.locator("[data-avatar] canvas")).toHaveCount(1, { timeout: 15_000 });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 500)));
}

/** The uptime and dead-air clocks tick every second. */
function clocks(page: Page) {
  return [page.locator("[data-status-bar]").getByText(/^\d\d:\d\d:\d\d$/)];
}

/** Phosphor on the glass: each line of the lower third against the band with the text hidden. */
async function lowerThirdContrast(page: Page): Promise<number[]> {
  const third = page.locator("[data-lower-third]");
  await expect(third).toBeVisible();
  const lines = [third.locator("span").first(), third.locator("span").nth(1)];
  const colours = await Promise.all(lines.map((l) => textColour(l)));
  // Inset past the 5 px border and the band's antialiased edge.
  const band = await boxOf(third, 6);
  const behind = await withStyle(page, "[data-lower-third], [data-lower-third] * { color: transparent !important; }", () =>
    pixels(page, band),
  );
  return colours.map((c) => worstOnBackground(c, behind));
}

/** Phosphor on the glass: the hovered channel's name, kicker and subtitle against the dimmed tube. */
async function captionContrast(page: Page): Promise<number[]> {
  const caption = page.locator("[data-glass-caption]");
  await expect(caption).toBeVisible();
  const parts = [caption.locator("p").first(), caption.locator("svg"), caption.locator("p").last()];
  const colours = [await textColour(parts[0] ?? caption), await textColour(caption.locator("svg text")), await textColour(parts[2] ?? caption)];
  const hide = "[data-glass-caption] p, [data-glass-caption] text { color: transparent !important; fill: transparent !important; }";
  const boxes = await Promise.all(parts.map((p) => boxOf(p, 2)));
  const behind = await withStyle(page, hide, () => Promise.all(boxes.map((b) => pixels(page, b))));
  return colours.map((c, i) => worstOnBackground(c, behind[i] ?? []));
}

/** Each gourd's carved number against the cut behind it. */
async function carvedNumbers(page: Page): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const gourd of await page.locator("nav [data-channel]").all()) {
    const channel = (await gourd.getAttribute("data-channel")) ?? "?";
    const numeral = gourd.locator("svg text").nth(2);
    const box = await boxOf(numeral);
    const lit = await pixels(page, box);
    const sel = `nav [data-channel="${channel}"] svg text:nth-of-type(3)`;
    const cut = await withStyle(page, `${sel} { visibility: hidden !important; }`, () => pixels(page, box));
    out[channel] = carvedContrast(lit, cut);
  }
  return out;
}

function expectAll(label: string, values: readonly number[] | Record<string, number>, floor = AA): void {
  for (const [key, value] of Object.entries(values)) {
    expect.soft(value, `${label} ${key}: ${value.toFixed(2)}:1`).toBeGreaterThanOrEqual(floor);
  }
}

test("landing 1600x900 halloween", async ({ page }) => {
  await openSet(page, "halloween", { width: 1600, height: 900 });
  await expect(page).toHaveScreenshot("landing-1600x900-halloween.png", { mask: clocks(page) });
});

test("landing 1600x900 baseline", async ({ page }) => {
  await openSet(page, "baseline", { width: 1600, height: 900 });
  await expect(page).toHaveScreenshot("landing-1600x900-baseline.png", { mask: clocks(page) });
});

test("landing 390x844 halloween", async ({ page }) => {
  await openSet(page, "halloween", { width: 390, height: 844 });
  await expect(page).toHaveScreenshot("landing-390x844-halloween.png", { mask: clocks(page) });
});

test("landing daemon lost 1600x900 halloween", async ({ page }) => {
  await openSet(page, "halloween", { width: 1600, height: 900 });
  // The replay sample (key D): reduced motion switches to dark at once.
  await page.keyboard.press("d");
  await expect(page.locator('[data-page="landing"]')).toHaveAttribute("data-daemon", "dark");
  await expect(page.locator("[data-no-carrier]")).toBeVisible();
  await expect(page.locator("[data-eye-note]")).toHaveText("IT IS STILL LOOKING");
  await expect(page).toHaveScreenshot("landing-daemon-lost-1600x900.png", { mask: clocks(page) });
});

for (const [theme, size] of [
  ["halloween", { width: 1600, height: 900 }],
  ["baseline", { width: 1600, height: 900 }],
  ["halloween", { width: 390, height: 844 }],
] as const) {
  test(`phosphor on the glass clears AA, ${theme} ${size.width}x${size.height}`, async ({ page }) => {
    await openSet(page, theme, size);
    expectAll("lower third line", await lowerThirdContrast(page));
    if (size.width > 1000) {
      await page.locator('nav [data-channel="3"]').hover();
      expectAll("caption part", await captionContrast(page));
    }
  });

  test(`carved numbers clear AA, ${theme} ${size.width}x${size.height}`, async ({ page }) => {
    await openSet(page, theme, size);
    expectAll("lit numeral, channel", await carvedNumbers(page), AA_LARGE);
  });
}

test("carved numbers stay readable as cold cuts once the daemon is lost", async ({ page }) => {
  await openSet(page, "halloween", { width: 1600, height: 900 });
  await page.keyboard.press("d");
  await expect(page.locator('[data-page="landing"]')).toHaveAttribute("data-daemon", "dark");
  expectAll("cold numeral, channel", await carvedNumbers(page), AA_LARGE);
});
