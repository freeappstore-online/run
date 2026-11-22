import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page) {
  await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
  await page.route("https://tile.openstreetmap.org/**", (r) =>
    r.fulfill({ body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF3cAAAAASUVORK5CYII=", "base64"), contentType: "image/png" }),
  );
  await page.addInitScript(() => {
    let watcher: PositionCallback | null = null;
    Object.defineProperty(navigator, "geolocation", {
      value: { watchPosition: (cb: PositionCallback) => ((watcher = cb), 1), clearWatch: () => (watcher = null) },
    });
    (window as any).emitFix = (m: number) =>
      watcher?.({ coords: { latitude: -37.81, longitude: 144.96 + m / 87850, accuracy: 5, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() } as GeolocationPosition);
    (window as any).spoken = [];
    Object.defineProperty(window, "speechSynthesis", { value: { cancel() {}, speak(u: { text: string }) { (window as any).spoken.push(u.text); } } });
  });
}
async function go(page: Page, label: string) {
  const link = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: label });
  if (!(await link.isVisible())) await page.getByRole("button", { name: /menu/i }).first().click();
  await page.getByRole("link", { name: label }).first().click();
}
async function move(page: Page, from = 0) {
  for (let i = from; i <= from + 4; i++) {
    await page.evaluate((n) => (window as any).emitFix(n * 10), i);
    await page.clock.runFor(3000);
  }
}
const noScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("record a free run, save on device, view, export and survive reload", async ({ page }) => {
  await setup(page);
  await page.clock.install();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Ready for a run?" })).toBeVisible();
  expect(await noScroll(page)).toBe(true);
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await move(page);
  await expect(page.getByText("GPS connected", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  const name = page.getByLabel("Run name");
  await name.fill("");
  await name.pressSequentially("Morning loop");
  await page.getByRole("button", { name: "Save run", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Morning loop" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export GPX" }).first().click();
  expect((await download).suggestedFilename()).toBe("Morning loop.gpx");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Morning loop" })).toBeVisible();
  await page.getByRole("button", { name: "View run" }).click();
  await expect(page.getByText("Total elapsed", { exact: false })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete run" }).click();
  await expect(page.getByText("Your first run starts here")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Your first run starts here")).toBeVisible();
});

test("plan, guided workout with cues, completion tick and profile prefs", async ({ page }) => {
  await setup(page);
  await page.clock.install();
  await page.goto("/plan");
  await expect(page.getByRole("heading", { name: "Your training plan" })).toBeVisible();
  await page.getByText("Sat", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Build my plan" })).toBeDisabled();
  await page.getByText("Sun", { exact: true }).click();
  await page.getByRole("button", { name: "Build my plan" }).click();
  await expect(page.getByText("0 of 27 workouts")).toBeVisible();
  expect(await noScroll(page)).toBe(true);
  await page.screenshot({ path: `test-results/plan-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Start workout" }).click();
  await expect(page.getByText("Next up · Week 1", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Start workout" }).click();
  await expect(page.getByLabel("Step time remaining")).toHaveText("5:00");
  await move(page);
  await page.clock.runFor(300000 - 15000);
  await expect(page.getByText("Next: Walk 1:30")).toBeVisible();
  expect(await page.evaluate(() => (window as any).spoken)).toEqual(["Warm up for 5 minutes", "Run for 1 minute"]);
  await page.screenshot({ path: `test-results/guide-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await expect(page.getByLabel("Run name")).toHaveValue("Week 1 · Run 1");
  await page.getByRole("button", { name: "Save run", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Week 1 · Run 1" })).toBeVisible();
  await go(page, "Plan");
  await expect(page.getByText("1 of 27 workouts")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Week 1" }).getByLabel("Done")).toHaveCount(1);
  await page.goto("/profile");
  await page.getByLabel("Distance units").selectOption("mi");
  await page.getByRole("checkbox", { name: /Voice cues/ }).uncheck();
  await page.reload();
  await expect(page.getByLabel("Distance units")).toHaveValue("mi");
  await expect(page.getByRole("checkbox", { name: /Voice cues/ })).not.toBeChecked();
  expect(await noScroll(page)).toBe(true);
  await page.screenshot({ path: `test-results/profile-${test.info().project.name}.png`, fullPage: true });
});
