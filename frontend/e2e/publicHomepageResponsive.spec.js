import { test, expect } from "@playwright/test";

async function noHorizontalOverflow(page) {
  const width = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(width.scroll - width.client).toBeLessThanOrEqual(1);
}

async function tapTarget(locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box.height).toBeGreaterThanOrEqual(44);
}

test("public homepage has a three-card commercial desktop layout", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /Built for the work ahead/i })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Staff login/i }).first()).toHaveAttribute("href", "/login");
  await expect(page.locator(".ch-home__service-card")).toHaveCount(3);
  // The site must render all images even when an external image CDN is blocked.
  await expect(page.locator("img[src^='https://']")).toHaveCount(0);
  for (const image of await page.locator(".ch-home__service-picture img").all()) {
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  }
  const columns = await page.locator(".ch-home__service-grid").evaluate(
    (node) => getComputedStyle(node).gridTemplateColumns.trim().split(/\s+/)
  );
  expect(columns).toHaveLength(3);
  await expect(page.locator(".ch-home__menu-toggle")).toBeHidden();
  const heroImageUrl = await page.locator(".ch-home__hero-image").getAttribute("src");
  expect(heroImageUrl).toBe("/images/home/v1/hero-desktop.webp");
  await expect.poll(() => page.locator(".ch-home__hero-image").evaluate(
    (img) => img.complete && img.naturalWidth > 0
  )).toBe(true);
  expect(await page.locator(".ch-home__hero-image").evaluate(
    (img) => new URL(img.currentSrc).pathname
  )).toBe("/images/home/v1/hero-desktop.webp");
  await expect(page.getByRole("link", { name: /Call our team/i })).toHaveAttribute("href", "tel:+233249469080");
  await noHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("public-homepage-desktop.png"), fullPage: true });
});

test("public homepage mobile menu, contacts and tap targets work at 390px", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect.poll(() => page.locator(".ch-home__hero-image").evaluate(
    (img) => img.complete && img.naturalWidth > 0
  )).toBe(true);
  expect(await page.locator(".ch-home__hero-image").evaluate(
    (img) => new URL(img.currentSrc).pathname
  )).toBe("/images/home/v1/hero-mobile.webp");
  const menu = page.getByRole("button", { name: "Open navigation" });
  await expect(menu).toBeVisible();
  await tapTarget(menu);
  await noHorizontalOverflow(page);
  await menu.click();
  await expect(page.getByRole("button", { name: "Close navigation" })).toHaveAttribute("aria-expanded", "true");
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation).toBeVisible();
  await expect(page.locator(".ch-home__service-card")).toHaveCount(3);
  await tapTarget(navigation.getByRole("link", { name: "Spare parts market" }));
  await navigation.getByRole("link", { name: "Spare parts market" }).click();
  await expect(page).toHaveURL(/\/shop$/);
  await expect(page.getByRole("heading", { level: 1, name: /Find the right part/i })).toBeVisible();
  await expect(page.locator(".pc-catalogue")).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("public-homepage-mobile.png"), fullPage: true });
});

test("public homepage tablet layout keeps navigation and cards readable", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Built for the work ahead/i })).toBeVisible();
  await expect(page.locator(".ch-home__service-card")).toHaveCount(3);
  await noHorizontalOverflow(page);
});
