// Beginner training plans: deterministic, time-based workouts built from a few settings.
export type StepKind = "warmup" | "run" | "easy" | "fast" | "walk" | "cooldown";
export type Step = { kind: StepKind; seconds: number };
export type Goal = "5k" | "10k";
export type PlanSettings = {
  version: 1;
  id: string;
  goal: Goal;
  /** Monday of week 1, local YYYY-MM-DD. */
  start: string;
  /** Three weekdays, 0 = Monday … 6 = Sunday, ascending. */
  days: number[];
  created: number;
};
export type Workout = {
  id: string;
  week: number;
  date: string;
  title: string;
  summary: string;
  steps: Step[];
};

export const GOALS: Record<Goal, { name: string; weeks: number; description: string }> = {
  "5k": {
    name: "First 5K",
    weeks: 9,
    description: "New to running. Run/walk intervals build up to 30 minutes non-stop.",
  },
  "10k": {
    name: "Run 10K",
    weeks: 8,
    description: "You can run about 30 minutes. Easy runs, intervals and a weekly long run.",
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

function session(goal: Goal, week: number, n: number): Omit<Workout, "id" | "week" | "date"> {
  if (goal === "5k") {
    if (week === 9 && n === 2)
      return {
        title: "Your first 5K",
        summary: "Run 5K at an easy pace. Short walk breaks are fine.",
        steps: [s("warmup", 5), s("run", 35), s("cooldown", 5)],
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
  const workouts: Workout[] = [];
  for (let week = 1; week <= GOALS[plan.goal].weeks; week++)
    plan.days.forEach((day, n) =>
      workouts.push({
        id: `${plan.id}:${week}-${n + 1}`,
        week,
        date: addDays(plan.start, (week - 1) * 7 + day),
        ...session(plan.goal, week, n),
      }),
    );
  return workouts;
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
export const cue = (step: Step) => `${stepLabel(step)} for ${spoken(step.seconds)}`;
export function mmss(ms: number) {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Validates plan settings read from device storage or the account. */
export function parsePlan(raw: unknown): PlanSettings | null {
  try {
    const p = (typeof raw === "string" ? JSON.parse(raw) : raw) as PlanSettings;
    return p &&
      p.version === 1 &&
      typeof p.id === "string" &&
      p.id.length > 0 &&
      p.id.length <= 64 &&
      (p.goal === "5k" || p.goal === "10k") &&
      typeof p.start === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(p.start) &&
      Array.isArray(p.days) &&
      p.days.length === 3 &&
      p.days.every((d, i) => Number.isInteger(d) && d >= 0 && d <= 6 && (i === 0 || d > p.days[i - 1])) &&
      Number.isFinite(p.created)
      ? { version: 1, id: p.id, goal: p.goal, start: p.start, days: [...p.days], created: p.created }
      : null;
  } catch {
    return null;
  }
}
