import test from "node:test";
import assert from "node:assert/strict";
import { buildPlan, parsePlan, planFrom, stepAt, totalMs, cue, completes, monday, addDays, GOALS } from "../web/src/plan.ts";
import { emptySession, resume, restore } from "../web/src/engine.ts";

const v1 = (goal) => ({ version: 1, id: "p1", goal, start: "2026-11-23", days: [1, 3, 5], created: 1 });
const settings = (goal) => parsePlan(v1(goal));

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

test("a workout completes at 90% of its time, or at a race session's distance", () => {
  const plan = buildPlan(settings("5k"));
  const first = plan[0], total = totalMs(first.steps);
  assert.equal(completes(first, 60000, 200), false, "a 1-minute attempt is not a completed workout");
  assert.equal(completes(first, total * 0.9, 0), true);
  const race = plan.at(-1);
  assert.equal(race.target, 5000);
  assert.equal(completes(race, 32 * 60000, 5000), true, "reaching 5K early completes the race");
  assert.equal(completes(race, 32 * 60000, 4900), false);
  assert.equal(buildPlan(settings("10k")).at(-1).target, 10000);
  assert.equal(cue({ kind: "fast", seconds: 60 }), "Run fast for 1 minute");
  assert.equal(cue({ kind: "easy", seconds: 120 }), "Run easy for 2 minutes");
});

test("version 1 plans upgrade without changing any workout id, date or session", () => {
  const plan = settings("10k");
  assert.equal(plan.version, 2);
  assert.equal(plan.longDay, 5);
  assert.equal(plan.firstStage, 1);
  const workouts = buildPlan(plan);
  assert.deepEqual(workouts.slice(0, 3).map((w) => [w.id, w.date, w.title]), [
    ["p1:1-1", "2026-11-24", "Easy run"],
    ["p1:1-2", "2026-11-26", "Intervals"],
    ["p1:1-3", "2026-11-28", "Long run"],
  ]);
  assert.equal(parsePlan({ ...v1("5k"), days: [1, 3, 5, 6] }), null, "version 1 is always 3 days");
});

const choices = (over = {}) => ({ goal: "10k", firstStage: 1, days: [1, 3, 5], longDay: 5, raceDate: "", later: false, ...over });
const today = new Date(2026, 10, 25); // Wed 25 Nov 2026

test("level, 4th day and long-run day shape the schedule", () => {
  const { plan } = planFrom(choices({ firstStage: 3, days: [0, 2, 4, 6], longDay: 0 }), today, "p2", 1);
  assert.equal(plan.start, "2026-11-23");
  const workouts = buildPlan(plan);
  assert.equal(workouts.length, 6 * 4, "stages 3-8, four sessions each");
  assert.deepEqual(workouts.slice(0, 4).map((w) => [w.week, w.stage, w.date, w.title]), [
    [1, 3, "2026-11-23", "Long run"],
    [1, 3, "2026-11-25", "Easy run"],
    [1, 3, "2026-11-27", "Intervals"],
    [1, 3, "2026-11-29", "Recovery run"],
  ]);
  assert.match(workouts[3].summary, /^Optional/);
  assert.ok(workouts.slice(-4).some((w) => w.title === "Your 10K"));
  assert.equal(planFrom(choices({ later: true }), today, "p", 1).plan.start, "2026-11-30");
  assert.match(planFrom(choices({ days: [1, 3] }), today, "p", 1).error, /3 or 4/);
  assert.match(planFrom(choices({ days: [0, 1, 2, 3, 4] }), today, "p", 1).error, /3 or 4/);
});

test("a race date schedules the plan backwards so the race lands on race day", () => {
  const { plan } = planFrom(choices({ goal: "5k", days: [1, 3, 6], raceDate: "2027-02-28" }), today, "p3", 1);
  assert.equal(plan.longDay, 6, "race day is the long-run day");
  const workouts = buildPlan(plan);
  const race = workouts.find((w) => w.title === "Your first 5K");
  assert.equal(race.date, "2027-02-28");
  assert.equal(race.target, 5000);
  assert.equal(workouts.at(-1).date, "2027-02-28");
  assert.equal(parsePlan(JSON.stringify(plan)).raceDate, "2027-02-28");
  assert.match(planFrom(choices({ raceDate: "2027-02-28" }), today, "p", 1).error, /Sun.*Add Sun/);
  assert.match(planFrom(choices({ days: [1, 3, 6], raceDate: "2026-12-27" }), today, "p", 1).error, /too soon/);
  assert.ok(planFrom(choices({ days: [1, 3, 6], firstStage: 3, raceDate: "2027-01-03" }), today, "p", 1).plan);
  assert.match(planFrom(choices({ raceDate: "2026-11-20" }), today, "p", 1).error, /future/);
});
