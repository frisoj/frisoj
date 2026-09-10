import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// axe-core scan across every public page — zero critical/serious findings.
// The cookie banner is dismissed first on each page so it doesn't mask the
// content behind it during the scan (axe still separately covers the
// banner itself, in its own test below).
const PUBLIC_PAGES = [
  "/",
  "/zelfreinigende-kattenbak",
  "/winkelwagen",
  "/vergelijking",
  "/veelgestelde-vragen",
  "/blog",
  "/blog/beste-zelfreinigende-kattenbak-2026",
  "/over-ons",
  "/contact",
  "/order-volgen",
  "/algemene-voorwaarden",
  "/privacyverklaring",
  "/cookiebeleid",
  "/herroepingsrecht",
  "/verzending-en-retour",
  "/garantie",
];

for (const path of PUBLIC_PAGES) {
  test(`axe: no critical/serious violations on ${path}`, async ({ page }) => {
    await page.goto(path);
    const banner = page.getByRole("button", { name: "Alleen noodzakelijk" });
    if (await banner.isVisible().catch(() => false)) await banner.click();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const seriousOrCritical = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(
      seriousOrCritical,
      seriousOrCritical.map((v) => `${v.id}: ${v.help} (${v.nodes.length} node(s))`).join("\n"),
    ).toHaveLength(0);
  });
}

test("axe: cookie banner itself has no critical/serious violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("dialog", { name: "Cookievoorkeuren" })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const seriousOrCritical = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  expect(seriousOrCritical).toHaveLength(0);
});

test("keyboard: skip link is the first focusable element and jumps to main content", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skipLink = page.locator(".skip-link");
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toHaveAttribute("href", "#main-content");
});
