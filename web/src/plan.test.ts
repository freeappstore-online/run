// @ts-nocheck — vendored as-is from proappstore-online/run tests (plain JS).
import { test } from "vitest";
import assert from "node:assert/strict";
import { buildPlan, parsePlan, stepAt, totalMs, cue, monday, addDays, GOALS } from "./plan";
import { emptySession, resume, restore } from "./engine";

const settings = (goal) => ({ version: 1, id: "p1", goal, start: "2026-11-23", days: [1, 3, 5], created: 1 });

test("plans have three dated workouts a week with stable ids", () => {
  for (const goal of ["5k", "10k"]) {
    const plan = buildPlan(settings(goal));
    assert.equal(plan.length, GOALS[goal].weeks * 3);
    assert.deepEqual(plan.slice(0, 3).map((w) => w.date), ["2026-11-24", "2026-11-26", "2026-11-28"]);
    assert.equal(plan[3].date, "2026-12-01");
    assert.equal(new Set(plan.map((w) => w.id)).size, plan.length);
    assert.deepEqual(buildPlan(settings(goal)), plan);
    for (const w of plan) assert.ok(w.steps.every((s) => s.seconds > 0));
  }
});

test("5K plan builds from run/walk intervals to a continuous run and ends with the 5K", () => {
  const plan = buildPlan(settings("5k"));
  const first = plan[0].steps;
  assert.equal(first[0].kind, "warmup");
  assert.equal(first.at(-1).kind, "cooldown");
  assert.notEqual(first.at(-2).kind, "walk", "no walk straight into the cool-down walk");
  assert.equal(first.filter((s) => s.kind === "run").length, 8);
  assert.deepEqual(plan[20].steps.map((s) => s.kind), ["warmup", "run", "cooldown"]);
  assert.equal(plan.at(-1).title, "Your first 5K");
});

test("10K plan rotates easy, intervals and long runs and ends with the 10K", () => {
  const plan = buildPlan(settings("10k"));
  assert.deepEqual(plan.slice(0, 3).map((w) => w.title), ["Easy run", "Intervals", "Long run"]);
  assert.equal(plan[1].steps.filter((s) => s.kind === "fast").length, 6);
  assert.equal(plan.at(-1).title, "Your 10K");
});

test("stepAt walks the steps by active time and reports completion", () => {
  const steps = [{ kind: "warmup", seconds: 60 }, { kind: "run", seconds: 30 }];
  assert.deepEqual(stepAt(steps, 0), { index: 0, remaining: 60000 });
  assert.deepEqual(stepAt(steps, 75000), { index: 1, remaining: 15000 });
  assert.equal(stepAt(steps, totalMs(steps)).index, 2);
  assert.equal(cue({ kind: "walk", seconds: 90 }), "Walk for 1 minute 30 seconds");
});

test("week dates use local Mondays", () => {
  assert.equal(monday(new Date(2026, 10, 29)), "2026-11-23");
  assert.equal(monday(new Date(2026, 10, 23)), "2026-11-23");
  assert.equal(addDays("2026-12-29", 7), "2027-01-05");
});

test("parsePlan rejects malformed settings from storage or the account", () => {
  assert.deepEqual(parsePlan(JSON.stringify(settings("5k"))), settings("5k"));
  for (const bad of [null, "nope", { ...settings("5k"), goal: "marathon" }, { ...settings("5k"), days: [1, 1, 2] }, { ...settings("5k"), days: [1, 2] }, { ...settings("5k"), start: "23/11/2026" }])
    assert.equal(parsePlan(bad), null);
});

test("runs carry the workout they follow through checkpoint and restore", () => {
  const s = resume(emptySession(), null, 1000, "r1", "p1:1-1");
  assert.equal(s.draft.workout, "p1:1-1");
  assert.equal(restore(JSON.stringify(s.draft)).workout, "p1:1-1");
  assert.equal(resume(emptySession(), null, 1000, "r2").draft.workout, undefined);
  assert.equal(restore(JSON.stringify({ ...s.draft, workout: 5 })), null);
});
