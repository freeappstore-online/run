// @ts-nocheck — vendored as-is from proappstore-online/run tests (plain JS).
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  emptySession,
  resume,
  ingest,
  pause,
  expire,
  distance,
  activeTime,
  checkpoint,
  restore,
  splits,
  pace,
  segments,
} from "./engine";
import { gpx } from "./gpx";
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
