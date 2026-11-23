import { lazy, Suspense, useEffect, useState, type ComponentProps } from "react";
import { Button, Card, PageHeader } from "./ui";
import {
  activeTime,
  clock,
  currentPace,
  distance,
  pace,
  recentPace,
  splits,
  unitMeters,
  type Draft,
  type Unit,
} from "./engine";
import type { useRecorder } from "./useRecorder";
import type { Workout } from "./plan";
import { NextWorkout, WorkoutGuide } from "./PlanPage";
import type { RouteMap } from "./RouteMap";

const LazyRouteMap = lazy(() => import("./RouteMap").then((m) => ({ default: m.RouteMap })));
/** The route map, loaded on first use (MapLibre is large). */
export function RouteMapLazy(props: ComponentProps<typeof RouteMap>) {
  return (
    <Suspense
      fallback={
        <div className={`flex ${props.fill ? "h-full" : "h-72"} items-center justify-center rounded-2xl border border-line text-sm text-muted`}>
          Loading route map…
        </div>
      }
    >
      <LazyRouteMap {...props} />
    </Suspense>
  );
}

export function Metric({ label, value, unit, compact }: { label: string; value: string; unit?: string; compact?: boolean }) {
  return (
    <div className="min-w-0">
      <p className={`${compact ? "text-[11px]" : "text-xs"} font-semibold uppercase tracking-widest text-muted`}>{label}</p>
      <p className={`${compact ? "text-lg" : "mt-2 text-2xl sm:text-3xl"} break-words font-bold tabular-nums tracking-tight`}>
        {value}
        <span className="ml-1 text-sm font-medium text-muted">{unit}</span>
      </p>
    </div>
  );
}

export function SplitTable({ draft, unit }: { draft: Draft; unit: Unit }) {
  const list = splits(draft.points, unit);
  return (
    <Card>
      <h2 className="mb-3 text-lg font-bold">Splits</h2>
      {list.length ? (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line text-muted">
              <th className="py-2">{unit === "km" ? "Kilometre" : "Mile"}</th>
              <th>Time</th>
              <th>Pace /{unit}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr className="border-b border-line" key={s.number}>
                <td className="py-3">{s.number}</td>
                <td>{clock(s.ms)}</td>
                <td>{s.pace}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-muted">Your first split appears after one {unit === "km" ? "kilometre" : "mile"}.</p>
      )}
      {draft.gaps > 0 && (
        <p className="mt-3 text-sm text-muted">GPS gaps occurred. Distance may be understated and pace/splits affected.</p>
      )}
    </Card>
  );
}

const WIDE = "(min-width: 1024px)";
function useWide() {
  const [wide, setWide] = useState(() => matchMedia(WIDE).matches);
  useEffect(() => {
    const query = matchMedia(WIDE),
      changed = () => setWide(query.matches);
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  return wide;
}
const VIEWS = [
  { id: "stats", label: "Stats" },
  { id: "map", label: "Map" },
  { id: "splits", label: "Splits" },
] as const;

/**
 * Record, mobile-first: below 1024px it fills one screen with no page scroll. The workout
 * guide (or the next workout) sits on top, a Stats / Map / Splits switcher in the middle and
 * the run controls at the bottom. Wider screens get two columns.
 */
export function RecordScreen({
  recorder,
  unit,
  voice,
  following,
  offered,
  privacy,
  onStartWorkout,
  onFinish,
  onDiscard,
}: {
  recorder: ReturnType<typeof useRecorder>;
  unit: Unit;
  voice: boolean;
  /** The planned workout the current run follows. */
  following: Workout | undefined;
  /** The planned workout offered before a run starts. */
  offered: Workout | undefined;
  /** Where runs are kept, e.g. "Private by default". */
  privacy: string;
  onStartWorkout: (workout: Workout) => void;
  onFinish: () => void;
  onDiscard: () => void;
}) {
  const wide = useWide();
  const [view, setView] = useState<(typeof VIEWS)[number]["id"]>("stats");
  const { draft } = recorder.state;
  const duration = activeTime(draft, recorder.now),
    total = distance(draft);
  const title = draft ? "Your run" : "Ready for a run?";
  const top = following ? (
    <WorkoutGuide
      workout={following}
      ms={duration}
      meters={total}
      pace={recentPace(draft, recorder.now)}
      unit={unit}
      running={recorder.running}
      voice={voice}
    />
  ) : (
    !draft &&
    offered && <NextWorkout workout={offered} disabled={recorder.busy} onStart={() => onStartWorkout(offered)} />
  );
  const status = (
    <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-bold uppercase tracking-widest text-accent">
      {recorder.running ? "Recording" : draft ? "Paused" : "Ready"}
    </span>
  );
  const stats = (
    <Card padding={wide ? undefined : "1rem"} style={wide ? undefined : { height: "100%" }}>
      {wide && (
        <div className="mb-6 flex items-center justify-between gap-2">
          {status}
          <span className="text-xs text-muted">{privacy}</span>
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">Distance</p>
        {!wide && status}
      </div>
      <p className={`${wide ? "mb-7 mt-1 text-7xl" : "mb-2 text-4xl"} font-bold tabular-nums tracking-tighter`}>
        {(total / unitMeters(unit)).toFixed(2)}
        <span className="ml-2 text-xl font-medium text-muted">{unit}</span>
      </p>
      <div className={`grid grid-cols-2 ${wide ? "gap-5" : "gap-x-3 gap-y-2"}`}>
        <Metric compact={!wide} label="Duration" value={clock(duration)} />
        <Metric compact={!wide} label="Average pace" value={pace(duration, total, unit)} unit={`/${unit}`} />
        <Metric compact={!wide} label="Current pace" value={currentPace(draft, recorder.now, unit)} unit={`/${unit}`} />
        <Metric compact={!wide} label="Splits" value={String(splits(draft?.points ?? [], unit).length)} />
      </div>
      <p role="status" className={`${wide ? "mt-5 min-h-10 text-sm" : "mt-2 truncate text-xs"} text-muted`}>
        {recorder.state.message}
      </p>
    </Card>
  );
  const actions = (
    <div className="flex gap-2">
      {recorder.running ? (
        <Button className="min-h-12 flex-1 lg:min-h-14" onClick={() => recorder.stop()}>
          Pause
        </Button>
      ) : (
        <Button
          className="min-h-12 flex-1 lg:min-h-14"
          variant={!draft && offered ? "secondary" : "primary"}
          disabled={recorder.busy}
          onClick={() => recorder.start()}
        >
          {draft ? "Resume" : "Start run"}
        </Button>
      )}
      {draft && (
        <Button className="min-h-12 flex-1 lg:min-h-14" variant="secondary" disabled={recorder.busy} onClick={onFinish}>
          Finish
        </Button>
      )}
      {draft && (
        <Button className="min-h-12 lg:min-h-14" variant="ghost" disabled={recorder.busy} onClick={onDiscard}>
          Discard
        </Button>
      )}
    </div>
  );
  const hint = wide ? (
    <p className="text-xs leading-5 text-muted">
      <strong className="text-ink">Keep Run open.</strong>{" "}
      {recorder.gap.covers
        ? "Locked-screen recording is on; Run adds the route when you return."
        : "Locking your phone or switching apps pauses the run."}{" "}
      {recorder.running && (recorder.awake ? "Screen-awake is on." : "Keep your screen on.")}
    </p>
  ) : (
    <p className="truncate text-xs text-muted">
      <strong className="text-ink">Keep Run open:</strong>{" "}
      {recorder.gap.covers
        ? "locked-screen recording is on; Run adds the route when you return."
        : recorder.running && recorder.awake
          ? "screen-awake is on."
          : "locking the phone pauses the run."}
    </p>
  );
  const splitsView = draft ? (
    <SplitTable draft={draft} unit={unit} />
  ) : (
    <Card>
      <p className="text-sm text-muted">Splits appear here during a run.</p>
    </Card>
  );
  if (!wide)
    return (
      <>
        <h1 className="sr-only">{title}</h1>
        {top}
        <div role="tablist" aria-label="Run view" className="grid shrink-0 grid-cols-3 gap-1 rounded-xl bg-line p-1">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              onClick={() => setView(v.id)}
              className="min-h-10 rounded-lg text-sm font-semibold text-muted aria-selected:bg-paper aria-selected:text-ink aria-selected:shadow-sm"
            >
              {v.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" aria-label={VIEWS.find((v) => v.id === view)!.label} className="min-h-0 flex-1 overflow-y-auto">
          {view === "stats" ? stats : view === "map" ? <RouteMapLazy fill points={draft?.points ?? []} follow={recorder.running} /> : splitsView}
        </div>
        <div className="shrink-0 space-y-2">
          {actions}
          {hint}
        </div>
      </>
    );
  return (
    <>
      <PageHeader title={title} description={draft ? "One step at a time." : "A little movement. A route of your own."} />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <div className="space-y-5">
          {top}
          {stats}
          {actions}
          <div className="rounded-xl border border-line p-4">{hint}</div>
        </div>
        <div className="space-y-5">
          <RouteMapLazy points={draft?.points ?? []} follow={recorder.running} />
          {draft ? (
            <SplitTable draft={draft} unit={unit} />
          ) : (
            <Card>
              <p className="text-xs font-semibold uppercase tracking-widest text-accent">Your next finish line</p>
              <h2 className="mt-2 text-xl font-bold">Just get out there.</h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                Track your route, find your pace and build a history of showing up. Or pick a goal in Plan and follow a
                guided beginner programme.
              </p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
