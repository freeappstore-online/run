import { test, expect, type Page, type Route } from "@playwright/test";

// The shipped app (production build, real web/src/native.ts) against a mocked FAS API:
// locked-screen catch-up must resume the run on its own, as on a phone.
const API = "https://api.freeappstore.online/v1/apps/run/native";
const session = { token: "t", user: { id: "gh:1", login: "runner", avatarUrl: null, dateOfBirth: null } };

type Api = { enabled: boolean; statusDelay: number; statusCalls: number; locationCalls: number };

async function boot(page: Page, opts: { signedIn?: boolean; enabled?: boolean; statusDelay?: number } = {}) {
  const api: Api = { enabled: opts.enabled ?? true, statusDelay: opts.statusDelay ?? 0, statusCalls: 0, locationCalls: 0 };
  await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
  await page.route("https://tile.openstreetmap.org/**", (r) => r.fulfill({ status: 404, body: "" }));
  await page.route("https://api.freeappstore.online/**", async (r: Route) => {
    const url = new URL(r.request().url());
    const json = (body: unknown) =>
      r.fulfill({ body: JSON.stringify(body), contentType: "application/json", headers: { "access-control-allow-origin": "*" } });
    if (url.pathname.endsWith("/native/status")) {
      api.statusCalls++;
      if (api.statusDelay) await new Promise((done) => setTimeout(done, api.statusDelay));
      return json({ available: true, enabled: api.enabled, lastPointAt: null });
    }
    if (url.pathname.endsWith("/native/locations")) {
      api.locationCalls++;
      // A walk recorded by the phone every 2 s after the page hid, up to now (as uploaded).
      const after = Number(url.searchParams.get("after"));
      const now = await page.evaluate(() => Date.now());
      const points = [];
      for (let at = after + 2000, i = 0; at <= now - 1000 && i < 400; at += 2000, i++)
        points.push({ id: `p${i}`, grantId: "g", at, lat: -37.81, lng: 144.96 + (i * 6) / 87850, accuracy: 3, cursorId: `g:p${i}` });
      return json({ points: url.searchParams.get("afterId") ? [] : points });
    }
    return json({});
  });
  await page.addInitScript(
    ([s, signedIn]) => {
      if (signedIn) localStorage.setItem("fas:session", JSON.stringify(s));
      let watcher: PositionCallback | null = null;
      Object.defineProperty(navigator, "geolocation", {
        value: { watchPosition: (cb: PositionCallback) => ((watcher = cb), 1), clearWatch: () => (watcher = null) },
      });
      (window as any).emitFix = (m: number) =>
        watcher?.({ coords: { latitude: -37.81, longitude: 144.96 + m / 87850, accuracy: 5, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() } as GeolocationPosition);
      (window as any).speechSynthesis = { cancel() {}, speak() {} };
    },
    [session, opts.signedIn ?? true] as const,
  );
  return api;
}
const setHidden = (page: Page, hidden: boolean) =>
  page.evaluate((h) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("run:draft:v1") || "null"));
async function startRecording(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Locked-screen recording is on", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  for (let i = 0; i <= 4; i++) {
    await page.evaluate((n) => (window as any).emitFix(n * 10), i);
    await page.waitForTimeout(1100);
  }
  await expect(page.getByText("GPS connected", { exact: false })).toBeVisible();
}
const resumed = (page: Page) =>
  expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible({ timeout: 15000 });

test("signed in with the companion on: lock, unlock, the run resumes by itself with the locked route", async ({ page }) => {
  const api = await boot(page);
  await startRecording(page);
  await setHidden(page, true);
  await page.waitForTimeout(8000);
  await setHidden(page, false);
  await resumed(page);
  await expect(page.getByText("recorded while locked", { exact: false })).toBeVisible();
  expect(api.locationCalls).toBeGreaterThan(0);
  expect((await stored(page)).hiddenAt).toBeUndefined();
});

test("iOS reloads the backgrounded app: on reopen the run still resumes by itself", async ({ page }) => {
  const api = await boot(page);
  await startRecording(page);
  await setHidden(page, true);
  await page.waitForTimeout(6000);
  expect((await stored(page)).hiddenAt).toBeGreaterThan(0);
  await page.reload();
  await resumed(page);
  expect(api.locationCalls).toBeGreaterThan(0);
});

test("a slow status answer on return still resumes the run once it arrives", async ({ page }) => {
  const api = await boot(page);
  await startRecording(page);
  await setHidden(page, true);
  await page.waitForTimeout(6000);
  api.statusDelay = 3000;
  await page.reload();
  await resumed(page);
});

test("iOS pagehide while locked keeps the locked stretch for catch-up", async ({ page }) => {
  await boot(page);
  await startRecording(page);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  await setHidden(page, true);
  await page.waitForTimeout(6000);
  await setHidden(page, false);
  await resumed(page);
});

test("signed out: Run says sign-in is needed to keep recording when locked", async ({ page }) => {
  const api = await boot(page, { signedIn: false });
  await page.goto("/");
  await expect(page.getByText("Sign in", { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/keep recording when locked/i).first()).toBeVisible();
  expect(api.statusCalls).toBe(0);
});
