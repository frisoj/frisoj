import { test, expect } from "@playwright/test";

// Full home -> product -> cart -> checkout -> thank-you path. This
// environment has no real Mollie/Supabase/Resend credentials (see
// DECISIONS.md), so a completed checkout lands on the thank-you page in
// its documented "pending" state instead of triggering a real iDEAL
// redirect — that degrade-gracefully behavior is itself real production
// code (app/api/checkout/route.ts), not a test mock, so this still
// exercises the whole client -> server -> order-creation path end to end.
// See TESTING.md for the manual script that covers a real Mollie payment.

test("home -> product -> cart -> checkout -> thank-you (pending, no live Mollie)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Alleen noodzakelijk" }).click();

  await page.getByRole("link", { name: /bekijk de kattenbak/i }).first().click();
  await expect(page).toHaveURL(/zelfreinigende-kattenbak/);

  await page.getByRole("button", { name: /in winkelwagen/i }).first().click();

  // Mini-cart drawer opens with focus on its close button.
  const drawer = page.getByRole("dialog", { name: "Winkelwagen" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Sluiten" })).toBeFocused();

  await drawer.getByRole("link", { name: /afrekenen/i }).click();
  await expect(page).toHaveURL(/afrekenen/);

  await page.getByLabel("E-mailadres").fill("test@example.com");
  await page.getByLabel("Voornaam").fill("Jan");
  await page.getByLabel("Achternaam").fill("Jansen");
  await page.getByLabel("Straatnaam").fill("Kerkstraat");
  await page.getByLabel("Huisnummer").fill("12");
  await page.getByLabel(/Postcode/).fill("1234 AB");
  await page.getByLabel("Plaats").fill("Amsterdam");
  await page.getByLabel(/algemene voorwaarden/i).check();

  await page.getByRole("button", { name: /betalen/i }).click();

  await expect(page).toHaveURL(/\/bedankt\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  await expect(
    page.getByRole("heading", { name: /betaling in behandeling|bedankt voor je bestelling/i }),
  ).toBeVisible();
});

test("checkout validation: invalid postcode and missing terms checkbox block submission", async ({ page }) => {
  await page.goto("/zelfreinigende-kattenbak");
  await page.getByRole("button", { name: /in winkelwagen/i }).first().click();
  await page.goto("/afrekenen");

  await page.getByLabel("E-mailadres").fill("test@example.com");
  await page.getByLabel("Voornaam").fill("Jan");
  await page.getByLabel("Achternaam").fill("Jansen");
  await page.getByLabel("Straatnaam").fill("Kerkstraat");
  await page.getByLabel("Huisnummer").fill("12");
  await page.getByLabel(/Postcode/).fill("NOTAPOSTCODE");
  await page.getByLabel("Plaats").fill("Amsterdam");
  // Terms checkbox intentionally left unchecked.

  await page.getByRole("button", { name: /betalen/i }).click();

  await expect(page).toHaveURL(/afrekenen/); // did not navigate away
  const postcodeError = page.getByText(/postcode/i, { exact: false });
  await expect(postcodeError.first()).toBeVisible();
  const termsError = page.getByText(/akkoord|voorwaarden/i, { exact: false }).last();
  await expect(termsError).toBeVisible();

  // The invalid postcode input is described by its error via aria-describedby.
  const postcodeInput = page.getByLabel(/Postcode/);
  const describedBy = await postcodeInput.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
});

test("order tracking: correct order number + email shows status, wrong email does not leak it", async ({ page }) => {
  // Create a real (mock-store) order via the checkout flow first.
  await page.goto("/zelfreinigende-kattenbak");
  await page.getByRole("button", { name: "Alleen noodzakelijk" }).click();
  await page.getByRole("button", { name: /in winkelwagen/i }).first().click();
  await page.goto("/afrekenen");
  await page.getByLabel("E-mailadres").fill("tracking@example.com");
  await page.getByLabel("Voornaam").fill("Anna");
  await page.getByLabel("Achternaam").fill("de Vries");
  await page.getByLabel("Straatnaam").fill("Dorpsstraat");
  await page.getByLabel("Huisnummer").fill("1");
  await page.getByLabel(/Postcode/).fill("1234 AB");
  await page.getByLabel("Plaats").fill("Utrecht");
  await page.getByLabel(/algemene voorwaarden/i).check();
  await page.getByRole("button", { name: /betalen/i }).click();
  await expect(page).toHaveURL(/\/bedankt\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  const bodyText = await page.locator("body").innerText();
  const match = bodyText.match(/KB-\d{4}-\d{6}/)?.[0];
  expect(match).toBeTruthy();
  const orderNumber = match as string;

  await page.goto("/order-volgen");
  await page.getByLabel("Ordernummer").fill(orderNumber);
  await page.getByLabel("E-mailadres").fill("tracking@example.com");
  await page.getByRole("button", { name: /bekijk status/i }).click();
  await expect(page.getByText(orderNumber)).toBeVisible();
  await expect(page.getByText(/status:/i)).toBeVisible();

  await page.goto("/order-volgen");
  await page.getByLabel("Ordernummer").fill(orderNumber);
  await page.getByLabel("E-mailadres").fill("wrong@example.com");
  await page.getByRole("button", { name: /bekijk status/i }).click();
  await expect(page.getByText(/geen bestelling gevonden/i)).toBeVisible();
});
