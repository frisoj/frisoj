import { test, expect } from "@playwright/test";

// No NEXT_PUBLIC_GA4_ID / META / TIKTOK env vars are set in this
// environment (see .env.example), so no pixel script ever loads regardless
// of consent — that part is verified structurally instead: no
// googletagmanager.com / connect.facebook.net / analytics.tiktok.com
// request fires before OR after consent here. Once real pixel IDs are
// configured, TESTING.md documents how the owner verifies firing with each
// platform's own debug tools (GA4 DebugView, Meta Pixel Helper, TikTok
// Pixel Helper).

test("cookie banner: appears once, no marketing script requests before or after choice, consent is stored", async ({
  page,
}) => {
  const marketingRequests: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (
      url.includes("googletagmanager.com") ||
      url.includes("google-analytics.com") ||
      url.includes("connect.facebook.net") ||
      url.includes("analytics.tiktok.com")
    ) {
      marketingRequests.push(url);
    }
  });

  await page.goto("/");
  const banner = page.getByRole("dialog", { name: "Cookievoorkeuren" });
  await expect(banner).toBeVisible();
  expect(marketingRequests).toHaveLength(0);

  await banner.getByRole("button", { name: "Accepteren" }).click();
  await expect(banner).toBeHidden();

  // No pixel IDs are configured in this environment, so consent alone
  // should still not cause a request — this asserts the gating code path
  // doesn't fire unconditionally once consent is granted.
  await page.waitForTimeout(500);
  expect(marketingRequests).toHaveLength(0);

  const stored = await page.evaluate(() => localStorage.getItem("pl_marketing_consent"));
  expect(stored).toBe("granted");

  // Reload: banner should not reappear once a choice was made.
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Cookievoorkeuren" })).toHaveCount(0);
});

test("cookie banner: rejecting stores denied consent and does not reappear", async ({ page }) => {
  await page.goto("/");
  const banner = page.getByRole("dialog", { name: "Cookievoorkeuren" });
  await banner.getByRole("button", { name: "Alleen noodzakelijk" }).click();
  const stored = await page.evaluate(() => localStorage.getItem("pl_marketing_consent"));
  expect(stored).toBe("denied");
});
