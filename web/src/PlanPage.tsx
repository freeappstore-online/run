import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Card, PageHeader } from "./ui";
import {
  GOALS,
  WEEKDAYS,
  addDays,
  cue,
  dayLabel,
  isoDay,
  mmss,
  monday,
  stepAt,
  stepLabel,
  totalMs,
  type Goal,
  type PlanSettings,
  type Workout,
} from "./plan";

/** Speech plus vibration; both are off when the user disables cues. */
export function announce(text: string, enabled: boolean) {
  if (!enabled) return;
  try {
    navigator.vibrate?.([200, 100, 200]);
  } catch {
    // Vibration is optional.
  }
  if ("speechSynthesis" in window) {
    speechSynthesis.cancel();
    speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }
}

const minutes = (workout: Workout) => Math.round(totalMs(workout.steps) / 60000);

function StepList({ workout }: { workout: Workout }) {
  return (
    <ul aria-label="Workout steps" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
      {workout.steps.map((step, i) => (
        <li
          key={i}
          className={`rounded-md px-2 py-1 text-xs font-semibold tabular-nums ${
            step.kind === "walk" || step.kind === "warmup" || step.kind === "cooldown"
              ? "bg-line text-muted"
              : "bg-accent-soft text-accent"
          }`}
        >
          {stepLabel(step)} {mmss(step.seconds * 1000)}
        </li>
      ))}
    </ul>
  );
}

/** The planned workout offered on Record before a run starts. */
export function NextWorkout({
  workout,
  onStart,
  disabled,
}: {
  workout: Workout;
  onStart: () => void;
  disabled: boolean;
}) {
  return (
    <Card>
      <p className="text-xs font-bold uppercase tracking-widest text-accent">
        Next up · Week {workout.week} · {dayLabel(workout.date)}
      </p>
      <h2 className="mt-2 text-xl font-bold">{workout.title}</h2>
      <p className="mt-1 text-sm text-muted">
        {workout.summary} · {minutes(workout)} min
      </p>
      <div className="my-4">
        <StepList workout={workout} />
      </div>
      <Button className="min-h-14 w-full" disabled={disabled} onClick={onStart}>
        Start workout
      </Button>
    </Card>
  );
}

/** Live step guidance. Workout time is the recorder's active time, so pausing pauses the workout. */
export function WorkoutGuide({
  workout,
  ms,
  meters,
  running,
  voice,
}: {
  workout: Workout;
  ms: number;
  meters: number;
  running: boolean;
  voice: boolean;
}) {
  const { steps } = workout;
  const reached = workout.target !== undefined && meters >= workout.target;
  const at = stepAt(steps, ms);
  const index = reached ? steps.length : at.index,
    remaining = at.remaining;
  const complete = index === steps.length;
  const last = useRef(index);
  useEffect(() => {
    if (last.current === index) return;
    last.current = index;
    if (running)
      announce(
        complete
          ? reached
            ? `You've run ${workout.target! / 1000}K. Amazing. Finish when you're ready.`
            : "Workout complete. Great work. Finish when you're ready."
          : cue(steps[index]),
        voice,
      );
  }, [index, complete, reached, running, voice, steps, workout.target]);
  const next = steps[index + 1];
  return (
    <Card>
      <p className="text-xs font-bold uppercase tracking-widest text-accent">
        Week {workout.week} · {workout.title}
      </p>
      {complete ? (
        <>
          <p className="mt-3 text-3xl font-bold">Workout complete</p>
          <p className="mt-1 text-sm text-muted">Great work. Finish and save your run when you're ready.</p>
        </>
      ) : (
        <div className="mt-3 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-3xl font-bold">{stepLabel(steps[index])}</p>
            <p className="mt-1 text-sm text-muted">
              {next ? `Next: ${stepLabel(next)} ${mmss(next.seconds * 1000)}` : "Last step"}
            </p>
          </div>
          <p aria-label="Step time remaining" className="text-5xl font-bold tabular-nums tracking-tighter">
            {mmss(remaining)}
          </p>
        </div>
      )}
      <div
        role="progressbar"
        aria-label="Workout progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.round((ms / totalMs(steps)) * 100))}
        className="mt-4 h-2 overflow-hidden rounded-full bg-line"
      >
        <div
          className="h-full bg-accent"
          style={{ width: `${Math.min(100, (ms / totalMs(steps)) * 100)}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-muted">
        Step {Math.min(index + 1, steps.length)} of {steps.length}
      </p>
    </Card>
  );
}

function PlanSetup({
  initial,
  onSave,
  onCancel,
}: {
  initial: PlanSettings | null;
  onSave: (plan: PlanSettings) => void;
  onCancel?: () => void;
}) {
  const [goal, setGoal] = useState<Goal>(initial?.goal ?? "5k"),
    [days, setDays] = useState<number[]>(initial?.days ?? [1, 3, 5]),
    [later, setLater] = useState(false);
  const thisWeek = monday(new Date());
  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (days.length !== 3) return;
        onSave({
          version: 1,
          id: crypto.randomUUID(),
          goal,
          start: later ? addDays(thisWeek, 7) : thisWeek,
          days,
          created: Date.now(),
        });
      }}
    >
      <fieldset className="space-y-3">
        <legend className="mb-3 text-lg font-bold">What's your goal?</legend>
        {(Object.keys(GOALS) as Goal[]).map((key) => (
          <label
            key={key}
            className="flex cursor-pointer gap-3 rounded-xl border border-line p-4 has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
          >
            <input
              type="radio"
              name="goal"
              className="mt-1 h-5 w-5 accent-accent"
              checked={goal === key}
              onChange={() => setGoal(key)}
            />
            <span>
              <span className="block font-bold">
                {GOALS[key].name} · {GOALS[key].weeks} weeks
              </span>
              <span className="text-sm text-muted">{GOALS[key].description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend className="mb-1 text-lg font-bold">Pick 3 run days</legend>
        <p className="mb-3 text-sm text-muted">Leave a rest day between runs when you can.</p>
        <div className="grid grid-cols-7 gap-1.5">
          {WEEKDAYS.map((name, day) => (
            <label
              key={name}
              className="flex min-h-12 cursor-pointer items-center justify-center rounded-lg border border-line text-sm font-semibold has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent"
            >
              <input
                type="checkbox"
                className="sr-only"
                aria-label={name}
                checked={days.includes(day)}
                onChange={(e) =>
                  setDays((list) =>
                    e.target.checked
                      ? [...list, day].sort((a, b) => a - b)
                      : list.filter((d) => d !== day),
                  )
                }
              />
              {name}
            </label>
          ))}
        </div>
        {days.length !== 3 && (
          <p role="status" className="mt-2 text-sm text-danger">
            Choose exactly 3 days ({days.length} selected).
          </p>
        )}
      </fieldset>
      <label className="flex min-h-12 items-center justify-between gap-4">
        <span className="text-lg font-bold">Start</span>
        <select
          aria-label="Start"
          className="min-h-11 rounded-lg border border-line bg-paper px-4"
          value={later ? "next" : "this"}
          onChange={(e) => setLater(e.target.value === "next")}
        >
          <option value="this">This week</option>
          <option value="next">Next week</option>
        </select>
      </label>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={days.length !== 3}>
          Build my plan
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Keep current plan
          </Button>
        )}
      </div>
    </form>
  );
}

export function PlanPage({
  plan,
  workouts,
  done,
  next,
  error,
  note,
  onSave,
  onStart,
}: {
  plan: PlanSettings | null;
  workouts: Workout[];
  done: Set<string>;
  next: Workout | undefined;
  error: string;
  /** App-specific line under the progress bar, e.g. where the plan is saved. */
  note?: ReactNode;
  onSave: (plan: PlanSettings) => void;
  onStart: (workout: Workout) => void;
}) {
  const [editing, setEditing] = useState(false);
  const today = isoDay(new Date());
  const alert = error && (
    <p role="alert" className="rounded-xl border border-danger p-4 text-sm text-danger">
      {error}
    </p>
  );
  if (!plan || editing)
    return (
      <>
        <PageHeader
          title={plan ? "Change your plan" : "Your training plan"}
          description="Pick a goal and the days that suit you. We'll guide every run."
        />
        {alert}
        <Card>
          <PlanSetup
            initial={plan}
            onCancel={plan ? () => setEditing(false) : undefined}
            onSave={(next) => {
              onSave(next);
              setEditing(false);
            }}
          />
        </Card>
      </>
    );
  const weeks = GOALS[plan.goal].weeks;
  const completed = workouts.filter((w) => done.has(w.id)).length;
  return (
    <>
      <PageHeader
        title={`${GOALS[plan.goal].name} plan`}
        description={`${weeks} weeks · 3 runs a week · ends ${dayLabel(workouts.at(-1)!.date)}`}
        actions={
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Change plan
          </Button>
        }
      />
      {alert}
      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-widest text-accent">Progress</p>
          <p className="text-sm font-semibold tabular-nums">
            {completed} of {workouts.length} workouts
          </p>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-line">
          <div className="h-full bg-accent" style={{ width: `${(completed / workouts.length) * 100}%` }} />
        </div>
        {note && <p className="mt-3 text-sm text-muted">{note}</p>}
      </Card>
      {next ? (
        <NextWorkout workout={next} disabled={false} onStart={() => onStart(next)} />
      ) : (
        <Card>
          <h2 className="text-xl font-bold">Plan complete 🎉</h2>
          <p className="mt-1 text-sm text-muted">Every workout done. Pick a new goal when you're ready.</p>
        </Card>
      )}
      {Array.from({ length: weeks }, (_, i) => i + 1).map((week) => {
        const from = addDays(plan.start, (week - 1) * 7);
        const current = today >= from && today <= addDays(from, 6);
        return (
          <section key={week} aria-label={`Week ${week}`}>
            <Card>
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-bold">Week {week}</h2>
                <span className="text-xs text-muted">
                  {current && (
                    <span className="mr-2 rounded-full bg-accent-soft px-2 py-0.5 font-bold uppercase tracking-widest text-accent">
                      This week
                    </span>
                  )}
                  {dayLabel(from)}
                </span>
              </div>
              <ul className="m-0 list-none divide-y divide-line p-0">
                {workouts
                  .filter((w) => w.week === week)
                  .map((w) => (
                    <li key={w.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="font-semibold">
                          {done.has(w.id) && (
                            <span aria-label="Done" className="mr-1.5 text-accent">
                              ✓
                            </span>
                          )}
                          {w.title}
                          <span className="ml-2 text-xs font-normal text-muted">{dayLabel(w.date)}</span>
                        </p>
                        <p className="text-sm text-muted">
                          {w.summary} · {minutes(w)} min
                        </p>
                      </div>
                      {!done.has(w.id) && (
                        <Button variant="ghost" aria-label={`Start ${w.title}, week ${week}`} onClick={() => onStart(w)}>
                          Start
                        </Button>
                      )}
                    </li>
                  ))}
              </ul>
            </Card>
          </section>
        );
      })}
    </>
  );
}
