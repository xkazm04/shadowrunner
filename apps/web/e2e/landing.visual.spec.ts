// The first frame, guarded (spec landing requirement 10.1): the landing on the replay plane with
// reduced motion at 1600x900 in both themes, at 390x844 in halloween, and in the daemon-lost state
// at 1600x900. The running clocks are masked; nothing else on the set moves with reduced motion.
// NOTE: the set (landing task 5.2) is not built yet; these baselines must be re-taken after it lands.
import { expect, test, type Page } from "@playwright/test";

type Theme = "halloween" | "baseline";

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
}

/** The uptime and dead-air clocks tick every second. */
function clocks(page: Page) {
  return [page.locator("[data-status-bar]").getByText(/^\d\d:\d\d:\d\d$/)];
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
