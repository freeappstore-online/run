import test from "node:test";
import assert from "node:assert/strict";
import { nativeSource, nativeStatus, pickStream } from "../web/src/native.ts";

const point = (n, grantId = "g1", at = 1000 + n * 1000) => ({
  grantId,
  at,
  lat: -37.81,
  lng: 144.96 + n / 1000,
  accuracy: 5,
  cursorId: `${grantId}:${n}`,
});
const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const signal = () => new AbortController().signal;

test("status reads the route's shape and treats errors and odd bodies as unavailable", async () => {
  assert.deepEqual(await nativeStatus(() => json({ available: true, enabled: true, lastPointAt: 5, capabilities: {} })), {
    available: true,
    enabled: true,
    lastPointAt: 5,
  });
  assert.deepEqual(await nativeStatus(() => json({ available: true, enabled: false, lastPointAt: null })), {
    available: true,
    enabled: false,
    lastPointAt: null,
  });
  assert.deepEqual(await nativeStatus(() => json({})), { available: false, enabled: false, lastPointAt: null });
  assert.equal(await nativeStatus(() => json({ error: "not signed in" }, 401)), null);
  assert.equal(await nativeStatus(() => Promise.reject(Error("offline"))), null);
});

test("covers mirrors the argument", () => {
  assert.equal(nativeSource(true, () => json({})).covers, true);
  assert.equal(nativeSource(false, () => json({})).covers, false);
});

test("fetch maps points to fixes, asks for after=since and keeps only at <= until", async () => {
  const urls = [];
  const src = nativeSource(true, (url) => {
    urls.push(url);
    return json({ points: [point(0), point(1), point(2), point(3)] });
  });
  const r = await src.fetch(1500, 3500, signal());
  assert.equal(r.complete, true);
  assert.deepEqual(r.fixes.map((f) => f.at), [2000, 3000]);
  assert.equal(r.fixes[0].altitude, null);
  assert.equal(r.fixes[0].accuracy, 5);
  const q = new URL(urls[0], "https://x.test");
  assert.equal(q.pathname, "/v1/apps/run/native/locations");
  assert.equal(q.searchParams.get("after"), "1500");
  assert.equal(q.searchParams.get("afterId"), "");
});

test("fetch pages by the composite cursor until a short page or past until", async () => {
  const pages = [
    Array.from({ length: 500 }, (_, i) => point(i, "g1", 2000 + i)),
    Array.from({ length: 500 }, (_, i) => point(500 + i, "g1", 2500 + i)),
    Array.from({ length: 10 }, (_, i) => point(1000 + i, "g1", 3000 + i)),
  ];
  const urls = [];
  const src = nativeSource(true, (url) => {
    urls.push(new URL(url, "https://x.test").searchParams);
    return json({ points: pages[urls.length - 1] });
  });
  const r = await src.fetch(1000, 10000, signal());
  assert.equal(r.fixes.length, 1010);
  assert.equal(r.complete, true);
  assert.equal(urls.length, 3);
  assert.equal(urls[1].get("after"), "2499");
  assert.equal(urls[1].get("afterId"), "g1:499");
  // A full page whose last point is already past `until` stops without another request.
  let calls = 0;
  const stop = nativeSource(true, () => (calls++, json({ points: pages[0] })));
  const early = await stop.fetch(1000, 2100, signal());
  assert.equal(calls, 1);
  assert.equal(early.fixes.length, 101);
  assert.equal(early.complete, true);
});

test("with several devices only the stream with the most points is used", async () => {
  const src = nativeSource(true, () =>
    json({ points: [point(0, "a", 2000), point(1, "b", 3000), point(2, "a", 4000), point(3, "b", 5000), point(4, "b", 6000)] }),
  );
  const r = await src.fetch(1000, 9000, signal());
  assert.deepEqual(r.fixes.map((f) => f.at), [3000, 5000, 6000]);
  assert.deepEqual(pickStream([]), []);
});

test("choosing the stream stays linear: a 20,000-point window is grouped in well under the catch-up budget", () => {
  const points = Array.from({ length: 20000 }, (_, i) => point(i, i % 4 ? "a" : "b", 1000 + i));
  const started = performance.now();
  assert.equal(pickStream(points).length, 15000);
  assert.ok(performance.now() - started < 250, `${Math.round(performance.now() - started)} ms`);
});

test("a failing response is complete:false, keeping what was already read", async () => {
  const failing = nativeSource(true, () => json({ error: "nope" }, 500));
  assert.deepEqual(await failing.fetch(0, 9000, signal()), { fixes: [], complete: false });
  const offline = nativeSource(true, () => Promise.reject(Error("offline")));
  assert.deepEqual(await offline.fetch(0, 9000, signal()), { fixes: [], complete: false });
  let n = 0;
  const midway = nativeSource(true, () =>
    ++n === 1 ? json({ points: Array.from({ length: 500 }, (_, i) => point(i, "g1", 2000 + i)) }) : json({}, 503),
  );
  const r = await midway.fetch(1000, 99999, signal());
  assert.equal(r.complete, false);
  assert.equal(r.fixes.length, 500);
});

test("an aborted request rejects instead of reporting an empty route", async () => {
  const c = new AbortController();
  const src = nativeSource(true, () => {
    c.abort();
    return Promise.reject(new DOMException("aborted", "AbortError"));
  });
  await assert.rejects(src.fetch(0, 9000, c.signal));
});
