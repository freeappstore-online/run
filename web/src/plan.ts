// Beginner training plans: deterministic, time-based workouts built from a few settings.
export type StepKind = "warmup" | "run" | "easy" | "fast" | "walk" | "cooldown";
export type Step = { kind: StepKind; seconds: number };
export type Goal = "5k" | "10k";
export type PlanSettings = {
  version: 2;
  id: string;
  goal: Goal;
  /** Monday of calendar week 1, local YYYY-MM-DD. */
  start: string;
  /** Three or four weekdays, 0 = Monday … 6 = Sunday, ascending. */
  days: number[];
  /** One of `days`: the long run, and race day. */
  longDay: number;
  /** Plan stage of calendar week 1; later stages skip the early weeks. */
  firstStage: number;
  /** Optional race day, local YYYY-MM-DD; the plan ends on it. */
  raceDate?: string;
  created: number;
};
export type Workout = {
  /** `<planId>:<stage>-<session>`; stable across settings versions. */
  id: string;
  /** Calendar week from the plan start. */
  week: number;
  /** Plan stage that sets the session content. */
  stage: number;
  date: string;
  title: string;
  summary: string;
  steps: Step[];
  /** Race sessions: reaching this distance (metres) completes the workout early. */
  target?: number;
};

export const GOALS: Record<
  Goal,
  { name: string; weeks: number; description: string; levels: { label: string; stage: number }[] }
> = {
  "5k": {
    name: "First 5K",
    weeks: 9,
    description: "New to running. Run/walk intervals build up to 30 minutes non-stop.",
    levels: [
      { label: "I'm new to running", stage: 1 },
      { label: "I can run 5 minutes without stopping", stage: 4 },
      { label: "I can run 15 minutes without stopping", stage: 6 },
    ],
  },
  "10k": {
    name: "Run 10K",
    weeks: 8,
    description: "You can run about 30 minutes. Easy runs, intervals and a weekly long run.",
    levels: [
      { label: "I can run about 30 minutes", stage: 1 },
      { label: "I can run about 45 minutes", stage: 3 },
    ],
  },
};
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const LABELS: Record<StepKind, string> = {
  warmup: "Warm up",
  run: "Run",
  easy: "Easy run",
  fast: "Fast",
  walk: "Walk",
  cooldown: "Cool down",
};
export const stepLabel = (step: Step) => LABELS[step.kind];

const s = (kind: StepKind, minutes: number): Step => ({ kind, seconds: Math.round(minutes * 60) });
const rep = (n: number, ...steps: Step[]) => Array.from({ length: n }, () => steps).flat();

const FIRST_5K: [string, Step[]][] = [
  ["8 × 1 min run, 1:30 walk", rep(8, s("run", 1), s("walk", 1.5))],
  ["6 × 1:30 run, 2 min walk", rep(6, s("run", 1.5), s("walk", 2))],
  ["2 × (1:30 run, 1:30 walk, 3 min run, 3 min walk)", rep(2, s("run", 1.5), s("walk", 1.5), s("run", 3), s("walk", 3))],
  ["3, 5, 3 and 5 min runs with walk breaks", [s("run", 3), s("walk", 1.5), s("run", 5), s("walk", 2.5), s("run", 3), s("walk", 1.5), s("run", 5)]],
  ["3 × 5 min run, 3 min walk", rep(3, s("run", 5), s("walk", 3))],
  ["2 × 10 min run, 3 min walk", rep(2, s("run", 10), s("walk", 3))],
  ["25 min continuous run", [s("run", 25)]],
  ["28 min continuous run", [s("run", 28)]],
  ["30 min continuous run", [s("run", 30)]],
];
const EASY_10K = [25, 25, 30, 30, 30, 35, 35, 25];
const INTERVALS_10K: [number, number, number][] = [
  [6, 1, 2], [6, 1.5, 2], [5, 2, 2], [5, 3, 2], [4, 4, 2], [4, 5, 2.5], [3, 6, 3], [4, 1, 2],
];
const LONG_10K = [35, 40, 45, 50, 55, 60, 65];
const minutes = (m: number) => (Number.isInteger(m) ? `${m}` : `${Math.floor(m)}:30`);

/** Session n of a stage: 0–1 regular, 2 the key session on the long-run day, 3 the optional 4th-day session. */
function session(goal: Goal, week: number, n: number): Omit<Workout, "id" | "week" | "stage" | "date"> {
  if (n === 3)
    return goal === "5k"
      ? { title: "Easy walk", summary: "Optional · 30 min brisk walk", steps: [s("walk", 30)] }
      : { title: "Recovery run", summary: "Optional · 20 min very easy", steps: [s("easy", 20)] };
  if (goal === "5k") {
    if (week === 9 && n === 2)
      return {
        title: "Your first 5K",
        summary: "Run 5K at an easy pace. Short walk breaks are fine.",
        steps: [s("warmup", 5), s("run", 35), s("cooldown", 5)],
        target: 5000,
      };
    const [summary, main] = FIRST_5K[week - 1];
    // A final walk would run straight into the cool-down walk.
    const body = main.at(-1)?.kind === "walk" ? main.slice(0, -1) : main;
    return { title: `Run ${n + 1}`, summary, steps: [s("warmup", 5), ...body, s("cooldown", 5)] };
  }
  if (n === 0)
    return {
      title: "Easy run",
      summary: `${EASY_10K[week - 1]} min at a pace you could chat at`,
      steps: [s("easy", EASY_10K[week - 1])],
    };
  if (n === 1) {
    const [reps, fast, easy] = INTERVALS_10K[week - 1];
    return {
      title: "Intervals",
      summary: `${reps} × ${minutes(fast)} min fast, ${minutes(easy)} min easy`,
      steps: [s("warmup", 10), ...rep(reps, s("fast", fast), s("easy", easy)).slice(0, -1), s("cooldown", 5)],
    };
  }
  if (week === 8)
    return {
      title: "Your 10K",
      summary: "Run 10K. Start easy and save something for the last 2K.",
      steps: [s("warmup", 5), s("easy", 70), s("cooldown", 5)],
      target: 10000,
    };
  return {
    title: "Long run",
    summary: `${LONG_10K[week - 1]} min easy. Slow is the point.`,
    steps: [s("easy", LONG_10K[week - 1])],
  };
}

export function isoDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function addDays(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDay(new Date(y, m - 1, d + n));
}
export function monday(date: Date) {
  return addDays(isoDay(date), -((date.getDay() + 6) % 7));
}
export function dayLabel(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export function buildPlan(plan: PlanSettings): Workout[] {
  // The key session takes the long-run day; the others fill the remaining days in order.
  const others = plan.days.filter((d) => d !== plan.longDay);
  const slots = [
    { n: 0, day: others[0] },
    { n: 1, day: others[1] },
    { n: 2, day: plan.longDay },
    ...(others.length > 2 ? [{ n: 3, day: others[2] }] : []),
  ].sort((a, b) => a.day - b.day);
  const workouts: Workout[] = [];
  for (let stage = plan.firstStage; stage <= GOALS[plan.goal].weeks; stage++) {
    const week = stage - plan.firstStage + 1;
    for (const { n, day } of slots)
      workouts.push({
        id: `${plan.id}:${stage}-${n + 1}`,
        week,
        stage,
        date: addDays(plan.start, (week - 1) * 7 + day),
        ...session(plan.goal, stage, n),
      });
  }
  return workouts;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export type PlanChoices = {
  goal: Goal;
  firstStage: number;
  days: number[];
  longDay: number;
  /** Empty for no race. */
  raceDate: string;
  /** Without a race: start next week instead of this one. */
  later: boolean;
};
/** Turns setup choices into settings, or explains what to change. */
export function planFrom(
  c: PlanChoices,
  today: Date,
  id: string,
  created: number,
): { plan: PlanSettings } | { error: string } {
  if (c.days.length < 3 || c.days.length > 4) return { error: `Choose 3 or 4 run days (${c.days.length} selected).` };
  const thisWeek = monday(today);
  const weeks = GOALS[c.goal].weeks - c.firstStage + 1;
  let start = c.later ? addDays(thisWeek, 7) : thisWeek,
    longDay = c.longDay;
  if (c.raceDate) {
    if (!ISO.test(c.raceDate)) return { error: "Enter a valid race date." };
    if (c.raceDate < isoDay(today)) return { error: "Pick a race date in the future." };
    const [y, m, d] = c.raceDate.split("-").map(Number);
    longDay = (new Date(y, m - 1, d).getDay() + 6) % 7;
    if (!c.days.includes(longDay))
      return { error: `Your race is on a ${WEEKDAYS[longDay]}. Add ${WEEKDAYS[longDay]} to your run days.` };
    start = addDays(monday(new Date(y, m - 1, d)), -(weeks - 1) * 7);
    if (start < thisWeek)
      return {
        error: `From your level this plan needs ${weeks} weeks, so the race is too soon. Pick a later race, a higher starting level, or no race date.`,
      };
  }
  if (!c.days.includes(longDay)) return { error: "Pick your long-run day from your run days." };
  return {
    plan: {
      version: 2,
      id,
      goal: c.goal,
      start,
      days: [...c.days].sort((a, b) => a - b),
      longDay,
      firstStage: c.firstStage,
      ...(c.raceDate ? { raceDate: c.raceDate } : {}),
      created,
    },
  };
}

export const totalMs = (steps: Step[]) => steps.reduce((sum, step) => sum + step.seconds * 1000, 0);
/** The step running at `ms` of active time; index === steps.length once the workout is complete. */
export function stepAt(steps: Step[], ms: number) {
  let end = 0;
  for (let index = 0; index < steps.length; index++) {
    end += steps[index].seconds * 1000;
    if (ms < end) return { index, remaining: end - ms };
  }
  return { index: steps.length, remaining: 0 };
}
export function spoken(seconds: number) {
  const m = Math.floor(seconds / 60), r = seconds % 60;
  const parts = [m && `${m} minute${m === 1 ? "" : "s"}`, r && `${r} seconds`].filter(Boolean);
  return parts.join(" ");
}
const VERBS: Record<StepKind, string> = {
  warmup: "Warm up",
  run: "Run",
  easy: "Run easy",
  fast: "Run fast",
  walk: "Walk",
  cooldown: "Cool down",
};
export const cue = (step: Step) => `${VERBS[step.kind]} for ${spoken(step.seconds)}`;
/** A run completes a workout once it covers 90% of the planned time, or a race session's distance. */
export const completes = (workout: Workout, activeMs: number, meters: number) =>
  activeMs >= totalMs(workout.steps) * 0.9 || (workout.target !== undefined && meters >= workout.target);
export function mmss(ms: number) {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Validates plan settings read from device storage or the account. Version 1 plans (3 days, no
 * level or race) upgrade to version 2 with the same workouts and ids.
 */
export function parsePlan(raw: unknown): PlanSettings | null {
  try {
    const p = (typeof raw === "string" ? JSON.parse(raw) : raw) as Omit<PlanSettings, "version"> & { version: 1 | 2 };
    if (
      !p ||
      (p.version !== 1 && p.version !== 2) ||
      typeof p.id !== "string" ||
      p.id.length === 0 ||
      p.id.length > 64 ||
      (p.goal !== "5k" && p.goal !== "10k") ||
      typeof p.start !== "string" ||
      !ISO.test(p.start) ||
      !Array.isArray(p.days) ||
      !p.days.every((d, i) => Number.isInteger(d) && d >= 0 && d <= 6 && (i === 0 || d > p.days[i - 1])) ||
      !Number.isFinite(p.created)
    )
      return null;
    const v1 = p.version === 1;
    const days = [...p.days],
      longDay = v1 ? days[2] : p.longDay,
      firstStage = v1 ? 1 : p.firstStage;
    if (
      (v1 ? days.length !== 3 : days.length < 3 || days.length > 4) ||
      !days.includes(longDay) ||
      !Number.isInteger(firstStage) ||
      firstStage < 1 ||
      firstStage > GOALS[p.goal].weeks ||
      (!v1 && p.raceDate !== undefined && (typeof p.raceDate !== "string" || !ISO.test(p.raceDate)))
    )
      return null;
    return {
      version: 2,
      id: p.id,
      goal: p.goal,
      start: p.start,
      days,
      longDay,
      firstStage,
      ...(!v1 && p.raceDate ? { raceDate: p.raceDate } : {}),
      created: p.created,
    };
  } catch {
    return null;
  }
}
