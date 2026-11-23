import test from "node:test";
import assert from "node:assert/strict";
import {
  emptySession,
  resume,
  ingest,
  pause,
  hide,
  catchUp,
  expire,
  distance,
  activeTime,
  checkpoint,
  restore,
  splits,
  pace,
  segments,
} from "../web/src/engine.ts";
import { gpx } from "../web/src/gpx.ts";
const origin = 1700000000000;
const fix = (x, seconds, accuracy = 5) => ({
  lat: 0,
  lng: x / 111195,
  at: origin + seconds * 1000,
  accuracy,
  altitude: null,
});
const start = () => resume(emptySession(), null, origin, "test-run");
const feed = (s, x, t, accuracy) =>
  ingest(s, fix(x, t, accuracy), origin + t * 1000);
test("steady running measures distance, pace and interpolated km/mile splits", () => {
  let s = start();
  for (let i = 0; i <= 201; i++) s = feed(s, i * 10, i * 3);
  assert.ok(Math.abs(distance(s.draft) - 2010) < 1);
  assert.equal(pace(603000, distance(s.draft), "km"), "5:00");
  const km = splits(s.draft.points, "km");
  assert.equal(km.length, 2);
  assert.ok(Math.abs(km[0].ms - 300000) < 10);
  assert.equal(splits(s.draft.points, "mi").length, 1);
});
test("stationary noise adds no distance but the independent timer continues", () => {
  let s = start();
  for (let i = 0; i < 100; i++) s = feed(s, i % 2, i);
  assert.equal(distance(s.draft), 0);
  assert.equal(activeTime(s.draft, origin + 99000), 99000);
});
// Deterministic noise for the GPS fixtures below.
const noise = ((seed) => () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)(7);
test("indoor jitter inside the reported accuracy adds no distance (#7)", () => {
  // Standing still indoors: accuracy 12-53 m (validFix drops the fixes over 25 m),
  // each fix off the true spot by up to half its accuracy, in any direction.
  let s = start();
  for (let i = 0; i < 300; i++) {
    const accuracy = 12 + noise() * 41,
      r = (accuracy / 2) * noise(),
      a = 2 * Math.PI * noise(),
      at = origin + i * 3000;
    s = ingest(s, { lat: (r * Math.sin(a)) / 111195, lng: (r * Math.cos(a)) / 111195, at, accuracy, altitude: null }, at);
  }
  assert.equal(distance(s.draft), 0);
});
test("a 3 m-accuracy walk counts within 5% of its length (#7)", () => {
  let s = start();
  for (let i = 0; i < 400; i++) {
    const at = origin + i * 1000;
    const f = { lat: (noise() - 0.5) / 111195, lng: (1.4 * i + noise() - 0.5) / 111195, at, accuracy: 3, altitude: null, speed: 1.4 };
    s = ingest(s, f, at);
  }
  const truth = 1.4 * 399;
  assert.ok(Math.abs(distance(s.draft) - truth) / truth < 0.05, `${distance(s.draft)} vs ${truth}`);
});
test("Doppler speed under 0.3 m/s holds the anchor; unknown speed falls back to position (#7)", () => {
  const at = (x, t, speed) => ingest(s, { ...fix(x, t, 3), speed }, origin + t * 1000);
  let s = start();
  s = at(0, 0, 0);
  s = at(8, 3, 0.1);
  assert.equal(distance(s.draft), 0);
  s = at(16, 6, 2);
  assert.ok(Math.abs(distance(s.draft) - 16) < 0.1);
  s = at(24, 9, null);
  assert.ok(Math.abs(distance(s.draft) - 24) < 0.1);
});
test("pause and recovery exclude paused time and never bridge distance", () => {
  let s = feed(feed(start(), 0, 0), 10, 3);
  s = pause(s, origin + 4000);
  assert.equal(activeTime(s.draft, origin + 90000), 4000);
  s = resume(s, null, origin + 100000, "unused");
  s = feed(s, 5000, 100);
  s = feed(s, 5010, 103);
  assert.ok(Math.abs(distance(s.draft) - 20) < 0.1);
  assert.equal(activeTime(s.draft, origin + 104000), 8000);
  assert.equal(segments(s.draft.points).length, 2);
});
test("GPS loss splits route and counts a gap without losing stopwatch time", () => {
  let s = feed(feed(start(), 0, 0), 10, 3);
  s = expire(s, origin + 20000);
  assert.equal(s.draft.gaps, 1);
  assert.equal(s.lastFix, null);
  s = feed(s, 10000, 30);
  s = feed(s, 10010, 33);
  assert.ok(distance(s.draft) < 21);
  assert.equal(activeTime(s.draft, origin + 33000), 33000);
});
test("uncertain, stale, duplicate and teleport fixes cannot inflate distance", () => {
  let s = feed(feed(start(), 0, 0), 10, 3);
  s = feed(s, 100000, 4);
  assert.ok(distance(s.draft) < 11);
  s = feed(s, 100000, 5, 100);
  assert.ok(distance(s.draft) < 11);
  s = ingest(s, fix(0, 0), origin + 60000);
  assert.ok(distance(s.draft) < 11);
  s = feed(s, 20, 7);
  s = feed(s, 40, 7);
  assert.ok(distance(s.draft) < 11);
});
test("restored checkpoints remain paused and reject corrupt timestamps and metrics", () => {
  let s = feed(feed(start(), 0, 0), 10, 3);
  const d = checkpoint(s, origin + 4000);
  const restored = restore(JSON.stringify(d));
  assert.equal(restored.resumed, null);
  assert.equal(restored.activeMs, 4000);
  assert.equal(restore(JSON.stringify({ ...d, activeMs: 1e99 })), null);
  assert.equal(
    restore(
      JSON.stringify({ ...d, points: [{ ...d.points[0], distance: -1 }] }),
    ),
    null,
  );
  assert.equal(restore("broken"), null);
});
test("account-bound draft cannot resume under another identity", () => {
  const s = pause(resume(emptySession(), "alice", origin, "a"), origin + 1000);
  assert.equal(resume(s, "bob", origin + 2000, "b").draft.resumed, null);
  assert.notEqual(resume(s, "alice", origin + 2000, "b").draft.resumed, null);
});
test("GPX escapes text and preserves separate segments and timestamps", () => {
  let s = feed(feed(start(), 0, 0), 10, 3);
  s = pause(s, origin + 4000);
  s = resume(s, null, origin + 10000, "x");
  s = feed(s, 20, 10);
  const xml = gpx("A&B <run>", s.draft);
  assert.match(xml, /A&amp;B &lt;run&gt;/);
  assert.equal((xml.match(/<trkseg>/g) || []).length, 2);
  assert.match(xml, /2023-11-14T/);
});

const hiddenRun = () => {
  let s = feed(feed(feed(start(), 0, 0), 10, 3), 20, 6);
  return hide(s, origin + 9000, true);
};
const locked = (from, to, step = 2, speed = 3) => {
  const out = [];
  for (let t = from; t <= to; t += step) out.push(fix(20 + (t - 6) * speed, t));
  return out;
};
test("hide marks only a recording draft, and only when a source covers it", () => {
  const s = feed(start(), 0, 0);
  const covered = hide(s, origin + 5000, true);
  assert.equal(covered.draft.hiddenAt, origin + 5000);
  assert.equal(covered.draft.resumed, null);
  assert.match(covered.message, /Phone locked/);
  const plain = hide(s, origin + 5000, false);
  assert.equal(plain.draft.hiddenAt, undefined);
  assert.equal(plain.draft.resumed, null);
  const paused = pause(s, origin + 3000);
  assert.equal(hide(paused, origin + 5000, true), paused);
  assert.equal(hide(emptySession(), origin, true).draft, null);
});
test("catchUp credits the locked time, appends the window and clears hiddenAt", () => {
  const h = hiddenRun();
  const before = h.draft.points.at(-1);
  const now = origin + 75000;
  const { state, added } = catchUp(h, locked(10, 70), now);
  assert.equal(added, 31);
  assert.equal(state.draft.hiddenAt, undefined);
  assert.equal(state.draft.resumed, origin + 9000);
  assert.equal(state.draft.segment, h.draft.segment + 1);
  const last = state.draft.points.at(-1);
  assert.equal(last.activeMs, h.draft.activeMs + (last.at - (origin + 9000)));
  assert.ok(distance(state.draft) > before.distance + 100);
  assert.equal(state.draft.points.at(-1).segment, state.draft.segment);
  assert.ok(restore(JSON.stringify(checkpoint(state, now))));
});
test("catchUp drops fixes at or before hiddenAt or after now, and is idempotent", () => {
  const h = hiddenRun();
  const now = origin + 40000;
  const fixes = [...locked(0, 9), ...locked(10, 60)];
  const first = catchUp(h, fixes, now);
  assert.ok(first.state.draft.points.every((p) => p.at <= now));
  assert.equal(first.state.draft.points.filter((p) => p.at <= origin + 9000).length, h.draft.points.length);
  const again = catchUp(first.state, fixes, now);
  assert.equal(again.added, 0);
  assert.equal(again.state, first.state);
});
test("catchUp keeps the usual rules: accuracy, jumps and gaps over 15 s", () => {
  const h = hiddenRun();
  const fixes = [
    fix(40, 10),
    fix(45, 12, 80),
    fix(50000, 14),
    fix(60, 16),
    fix(5000, 40),
    fix(5010, 42),
  ];
  const { state } = catchUp(h, fixes, origin + 50000);
  assert.ok(!state.draft.points.some((p) => p.accuracy > 25));
  assert.ok(!state.draft.points.some((p) => p.lng * 111195 > 50000));
  const late = state.draft.points.filter((p) => p.at >= origin + 40000);
  assert.equal(late.length, 2);
  assert.ok(late[0].segment > state.draft.points.find((p) => p.at === origin + 16000).segment);
  assert.equal(late[0].distance, state.draft.points.find((p) => p.at === origin + 16000).distance);
  assert.ok(distance(state.draft) < 100);
});
test("catchUp with nothing usable returns the identical state", () => {
  const h = hiddenRun();
  for (const fixes of [[], [fix(40, 5)], [fix(40, 200)], [fix(40, 10, 99)]]) {
    const r = catchUp(h, fixes, origin + 100000);
    assert.equal(r.added, 0);
    assert.equal(r.state, h);
  }
  const plain = feed(start(), 0, 0);
  assert.equal(catchUp(plain, locked(10, 20), origin + 30000).state, plain);
  const paused = pause(plain, origin + 1000);
  assert.equal(catchUp(paused, locked(10, 20), origin + 30000).added, 0);
});
test("catchUp inserts out-of-order fixes in order", () => {
  const h = hiddenRun();
  const shuffled = locked(10, 40).reverse();
  const a = catchUp(h, shuffled, origin + 45000);
  const b = catchUp(h, locked(10, 40), origin + 45000);
  assert.deepEqual(a.state.draft.points, b.state.draft.points);
});
test("restore round-trips hiddenAt and rejects values outside started..updated", () => {
  const h = hiddenRun();
  const d = checkpoint(h, origin + 9000);
  assert.equal(restore(JSON.stringify(d)).hiddenAt, origin + 9000);
  assert.equal(restore(JSON.stringify({ ...d, hiddenAt: d.started - 1 })), null);
  assert.equal(restore(JSON.stringify({ ...d, hiddenAt: d.updated + 1 })), null);
  assert.equal(restore(JSON.stringify({ ...d, hiddenAt: "x" })), null);
});
test("an explicit resume drops hiddenAt", () => {
  const r = resume(hiddenRun(), null, origin + 20000, "x");
  assert.equal(r.draft.hiddenAt, undefined);
});
