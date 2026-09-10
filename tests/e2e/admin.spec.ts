import { test, expect } from "@playwright/test";

// No live Supabase project exists in this environment (see DECISIONS.md),
// so the full "log in, change status, enter track & trace, trigger a
// shipping email" admin flow needs a real Supabase Auth user + project —
// that is documented as a manual step in TESTING.md. What IS testable here
// without credentials is the degrade-gracefully contract itself: /admin
// must never be reachable without a configured, authenticated, allowlisted
// session, and must fail closed (redirect to login), not open.

test("admin: unauthenticated /admin redirects to /admin/login", async ({ page }) => {
  await page.goto("/admin/orders");
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test("admin: login page shows a clear 'not configured' notice without Supabase credentials", async ({ page }) => {
  await page.goto("/admin/login");
  await expect(page.getByText(/nog geen supabase-project gekoppeld/i)).toBeVisible();
  const submit = page.getByRole("button", { name: /inloggen/i });
  await expect(submit).toBeDisabled();
});

test("admin: login route rate-limits repeated attempts", async ({ request }) => {
  let lastStatus = 0;
  for (let i = 0; i < 10; i++) {
    const res = await request.post("/api/admin/login", {
      data: { email: "nobody@example.com", password: "wrong" },
    });
    lastStatus = res.status();
    if (lastStatus === 429) break;
  }
  expect(lastStatus).toBe(429);
});

test("admin routes are noindex", async ({ page }) => {
  await page.goto("/admin/login");
  const robotsMeta = page.locator('meta[name="robots"]');
  await expect(robotsMeta).toHaveAttribute("content", /noindex/);
});
