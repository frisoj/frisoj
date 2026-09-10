import { defineConfig, devices } from "@playwright/test";

// E2E config. Runs against a production build (`npm run build && npm run
// start`) on a fixed port, started automatically via webServer below so
// `npx playwright test` works standalone in CI too. See TESTING.md for
// what these tests cover vs. what still needs a human with real Mollie/
// Supabase/Resend credentials (this repo has none — see DECISIONS.md).
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run build && npm run start -- -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
