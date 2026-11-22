import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  timeout: 45000,
  expect: { timeout: 12000 },
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:4195", serviceWorkers: "block", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 360, height: 800 } } },
  ],
  webServer: {
    command: "pnpm build && pnpm --filter @run/web preview --host 127.0.0.1 --port 4195 --strictPort",
    url: "http://127.0.0.1:4195",
    timeout: 120000,
  },
});
