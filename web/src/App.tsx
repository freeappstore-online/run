import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { initApp } from "@freeappstore/sdk";
import {
  Card,
  EmptyState,
  Modal,
  PageHeader,
  ProfilePage,
  Shell,
  useDocumentTitle,
  type NavItem,
} from "@freeappstore/sdk/ui";
import {
  activeTime,
  clock,
  currentPace,
  distance,
  pace,
  splits,
  unitMeters,
  type Draft,
  type Unit,
} from "./engine";
import { deviceRuns, readDevicePlan, removeDeviceRun, writeDevicePlan, type SavedRun } from "./storage";
import { downloadGpx } from "./gpx";
import { useRecorder } from "./useRecorder";
import { buildPlan, completes, cue, type PlanSettings, type Workout } from "./plan";
import { announce, NextWorkout, PlanPage, WorkoutGuide } from "./PlanPage";
import { Button } from "./ui";

export const fas = initApp({ appId: "run" });

const LazyRouteMap = lazy(() => import("./RouteMap").then((m) => ({ default: m.RouteMap })));
function RouteMap(props: Parameters<typeof LazyRouteMap>[0]) {
  return (
    <Suspense
      fallback={
        <div className="flex h-72 items-center justify-center rounded-2xl border border-line text-sm text-muted">
          Loading route map…
        </div>
      }
    >
      <LazyRouteMap {...props} />
    </Suspense>
  );
}

const icon = (d: string) => (
  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const NAV: NavItem[] = [
  { label: "Record", href: "/", title: "Record — Run", icon: icon("M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-2 5 6 4-6 4V8Z") },
  { label: "Plan", href: "/plan", title: "Plan — Run", icon: icon("M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z") },
  { label: "History", href: "/history", title: "History — Run", icon: icon("M3 12a9 9 0 1 0 3-6.7M3 3v6h6m3-2v5l3 2") },
];
function readPref(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function navigate(path: string) {
  history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export default function App() {
  const [path, setPath] = useState(location.pathname);
  const [unit, setUnit] = useState<Unit>(() => (readPref("run:units", "km") === "mi" ? "mi" : "km"));
  const [keepAwake, setKeepAwake] = useState(() => readPref("run:awake", "true") !== "false");
  const [voice, setVoice] = useState(() => readPref("run:voice", "true") !== "false");
  // Single-user: runs belong to this device, never to an account.
  const recorder = useRecorder(null, keepAwake);
  useEffect(() => {
    const changed = () => setPath(location.pathname);
    window.addEventListener("popstate", changed);
    return () => window.removeEventListener("popstate", changed);
  }, []);
  return (
    <Shell app={fas} appName="Run" nav={NAV} onNavigate={navigate} profileHref="/profile" headerAppearance={false}>
      <Workspace
        path={path}
        recorder={recorder}
        unit={unit}
        setUnit={setUnit}
        keepAwake={keepAwake}
        setKeepAwake={setKeepAwake}
        voice={voice}
        setVoice={setVoice}
      />
    </Shell>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted">{label}</p>
      <p className="mt-2 break-words text-2xl font-bold tabular-nums tracking-tight sm:text-3xl">
        {value}
        <span className="ml-1 text-sm font-medium text-muted">{unit}</span>
      </p>
    </div>
  );
}
function SplitTable({ draft, unit }: { draft: Draft; unit: Unit }) {
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

function useRuns(revision: number) {
  const [runs, setRuns] = useState<SavedRun[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    deviceRuns()
      .then((found) => {
        if (!cancelled) {
          setRuns(found);
          setError("");
        }
      })
      .catch(() => {
        if (!cancelled) setError("Device history could not be read. Try again without clearing browser storage.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [revision, refresh]);
  return { runs, loading, error, reload: () => setRefresh((n) => n + 1) };
}

function Workspace({
  path,
  recorder,
  unit,
  setUnit,
  keepAwake,
  setKeepAwake,
  voice,
  setVoice,
}: {
  path: string;
  recorder: ReturnType<typeof useRecorder>;
  unit: Unit;
  setUnit: (value: Unit) => void;
  keepAwake: boolean;
  setKeepAwake: (value: boolean) => void;
  voice: boolean;
  setVoice: (value: boolean) => void;
}) {
  const { draft } = recorder.state;
  const [finishOpen, setFinishOpen] = useState(false),
    [discardOpen, setDiscardOpen] = useState(false),
    [title, setTitle] = useState(""),
    [notice, setNotice] = useState("");
  const runs = useRuns(recorder.revision);
  const [plan, setPlan] = useState<PlanSettings | null>(readDevicePlan),
    [planError, setPlanError] = useState(""),
    [chosen, setChosen] = useState<string | null>(null);
  const workouts = useMemo(() => (plan ? buildPlan(plan) : []), [plan]);
  const done = new Set(
    workouts
      .filter((w) =>
        runs.runs.some((run) => run.draft.workout === w.id && completes(w, run.draft.activeMs, distance(run.draft))),
      )
      .map((w) => w.id),
  );
  const next = workouts.find((w) => !done.has(w.id));
  const offered = workouts.find((w) => w.id === chosen) ?? next;
  const following = workouts.find((w) => w.id === draft?.workout);
  const startWorkout = (workout: Workout) => {
    recorder.start(workout.id);
    announce(cue(workout.steps[0]), voice);
    setChosen(null);
  };
  const heading = path === "/history" ? "History" : path === "/plan" ? "Plan" : path === "/profile" ? "Profile" : "Record";
  useDocumentTitle(`${heading} — Run`);
  const duration = activeTime(draft, recorder.now),
    total = distance(draft);
  const setPreference = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      setNotice("Preference changed for this session. Browser storage is unavailable.");
    }
  };
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      {recorder.running && path !== "/" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-accent-soft p-4">
          <span className="font-semibold">
            Recording · {clock(duration)} · {(total / unitMeters(unit)).toFixed(2)} {unit}
          </span>
          <Button onClick={() => navigate("/")}>Back to run</Button>
        </div>
      )}
      {notice && (
        <p role="status" className="rounded-xl bg-accent-soft p-4 text-sm">
          {notice}
        </p>
      )}
      {recorder.error && (
        <p role="alert" className="rounded-xl border border-danger p-4 text-sm text-danger">
          {recorder.error}
        </p>
      )}
      {path === "/history" ? (
        <History unit={unit} runs={runs} />
      ) : path === "/plan" ? (
        <PlanPage
          plan={plan}
          workouts={workouts}
          done={done}
          next={next}
          error={planError}
          onSave={(settings) => {
            setPlan(settings);
            try {
              writeDevicePlan(settings);
              setPlanError("");
            } catch {
              setPlanError("Browser storage is unavailable. Your plan lasts for this session only.");
            }
          }}
          onStart={(workout) => {
            setChosen(workout.id);
            navigate("/");
          }}
        />
      ) : path === "/profile" ? (
        <ProfilePage app={fas}>
          <div className="space-y-6">
            <p className="text-sm text-muted">
              Signing in is optional. Run is single-user and never uploads anything: runs and your plan stay in this
              browser. Export GPX from History for a copy that survives clearing site data.
            </p>
            <Card>
              <h2 className="mb-4 text-lg font-bold">Running preferences</h2>
              <label className="flex min-h-12 items-center justify-between gap-4">
                Distance units
                <select
                  className="min-h-11 rounded-lg border border-line bg-paper px-4"
                  value={unit}
                  onChange={(e) => {
                    const v = e.target.value as Unit;
                    setUnit(v);
                    setPreference("run:units", v);
                  }}
                >
                  <option value="km">Kilometres</option>
                  <option value="mi">Miles</option>
                </select>
              </label>
              <label className="mt-4 flex min-h-12 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-[var(--accent)]"
                  checked={keepAwake}
                  onChange={(e) => {
                    setKeepAwake(e.target.checked);
                    setPreference("run:awake", String(e.target.checked));
                  }}
                />
                Keep screen awake while recording, when supported
              </label>
              <label className="mt-4 flex min-h-12 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-[var(--accent)]"
                  checked={voice}
                  onChange={(e) => {
                    setVoice(e.target.checked);
                    setPreference("run:voice", String(e.target.checked));
                  }}
                />
                Voice cues during workouts (vibration too, when supported)
              </label>
            </Card>
            <Card>
              <h2 className="mb-2 text-lg font-bold">How recording works</h2>
              <p className="text-sm leading-7 text-muted">
                Keep Run open and visible. Locking your phone or switching apps pauses recording; return and tap Resume.
                GPS needs location permission, but recording and saves work without internet after the app is loaded. Map
                imagery needs a connection. Saved runs are accessible to anyone using this browser profile and can be lost
                if browser storage is cleared.
              </p>
            </Card>
          </div>
        </ProfilePage>
      ) : (
        <>
          <PageHeader
            title={draft ? "Your run" : "Ready for a run?"}
            description={draft ? "One step at a time." : "A little movement. A route of your own."}
          />
          <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
            <div className="space-y-5">
              {following && <WorkoutGuide workout={following} ms={duration} meters={total} running={recorder.running} voice={voice} />}
              {!draft && offered && (
                <NextWorkout workout={offered} disabled={recorder.busy} onStart={() => startWorkout(offered)} />
              )}
              <Card>
                <div className="mb-6 flex items-center justify-between gap-2">
                  <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-bold uppercase tracking-widest text-accent">
                    {recorder.running ? "Recording" : draft ? "Paused" : "Ready"}
                  </span>
                  <span className="text-xs text-muted">Stays on this device</span>
                </div>
                <div className="mb-7">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted">Distance</p>
                  <p className="mt-1 text-6xl font-bold tabular-nums tracking-tighter sm:text-7xl">
                    {(total / unitMeters(unit)).toFixed(2)}
                    <span className="ml-2 text-xl font-medium text-muted">{unit}</span>
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-5">
                  <Metric label="Duration" value={clock(duration)} />
                  <Metric label="Average pace" value={pace(duration, total, unit)} unit={`/${unit}`} />
                  <Metric label="Current pace" value={currentPace(draft, recorder.now, unit)} unit={`/${unit}`} />
                  <Metric label="Complete splits" value={String(splits(draft?.points ?? [], unit).length)} />
                </div>
                <p role="status" className="mt-5 min-h-10 text-sm text-muted">
                  {recorder.state.message}
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  {recorder.running ? (
                    <Button className="min-h-14 flex-1" onClick={() => recorder.stop()}>
                      Pause
                    </Button>
                  ) : (
                    <Button className="min-h-14 flex-1" disabled={recorder.busy} onClick={() => recorder.start()}>
                      {draft ? "Resume" : "Start run"}
                    </Button>
                  )}
                  {draft && (
                    <Button
                      className="min-h-14 flex-1"
                      variant="secondary"
                      disabled={recorder.busy}
                      onClick={() => {
                        recorder.stop();
                        setTitle(
                          following
                            ? `Week ${following.week} · ${following.title}`
                            : `Run · ${new Date(draft.started).toLocaleDateString()}`,
                        );
                        setFinishOpen(true);
                      }}
                    >
                      Finish
                    </Button>
                  )}
                </div>
                {draft && (
                  <Button
                    variant="ghost"
                    className="mt-2"
                    disabled={recorder.busy}
                    onClick={() => {
                      recorder.stop();
                      setDiscardOpen(true);
                    }}
                  >
                    Discard draft
                  </Button>
                )}
              </Card>
              <div className="rounded-xl border border-line p-4 text-sm leading-6 text-muted">
                <strong className="text-ink">Keep this app open.</strong> Locking your phone or switching apps pauses
                your run.{" "}
                {recorder.running
                  ? recorder.awake
                    ? "Screen-awake is active."
                    : "Keep your screen on; screen-awake is unavailable or disabled."
                  : "We will request location when you start."}
              </div>
            </div>
            <div className="space-y-5">
              <RouteMap points={draft?.points ?? []} follow={recorder.running} />
              {draft ? (
                <SplitTable draft={draft} unit={unit} />
              ) : (
                <Card>
                  <p className="text-xs font-semibold uppercase tracking-widest text-accent">Your next finish line</p>
                  <h2 className="mt-2 text-xl font-bold">Just get out there.</h2>
                  <p className="mt-2 text-sm leading-6 text-muted">
                    Track your route, find your pace and build a history of showing up. Or pick a goal in Plan and
                    follow a guided beginner programme.
                  </p>
                </Card>
              )}
            </div>
          </div>
        </>
      )}
      <Modal open={finishOpen} onClose={() => !recorder.busy && setFinishOpen(false)} title="Finish your run">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void recorder.finish(title).then((ok) => {
              if (ok) {
                setFinishOpen(false);
                setNotice("Run saved on this device. Export GPX from History for a separate copy.");
                navigate("/history");
              }
            });
          }}
        >
          <label className="block text-sm font-semibold">
            Run name
            <input
              className="mt-1 block min-h-11 w-full rounded-lg border border-line bg-paper px-3 text-base font-normal"
              value={title}
              maxLength={100}
              required
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          {recorder.error && (
            <p role="alert" className="text-sm text-danger">
              {recorder.error}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" loading={recorder.busy}>
              Save run
            </Button>
            {draft && (
              <Button variant="secondary" disabled={recorder.busy} onClick={() => downloadGpx(title, draft)}>
                Export GPX
              </Button>
            )}
          </div>
        </form>
      </Modal>
      <Modal open={discardOpen} onClose={() => setDiscardOpen(false)} title="Discard this draft?">
        <p className="mb-5 text-sm">This removes the unfinished run from this device.</p>
        <div className="flex gap-3">
          <Button
            variant="danger"
            onClick={() => {
              recorder.discard();
              setDiscardOpen(false);
            }}
          >
            Discard run
          </Button>
          <Button variant="secondary" onClick={() => setDiscardOpen(false)}>
            Keep run
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function History({ unit, runs }: { unit: Unit; runs: ReturnType<typeof useRuns> }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<SavedRun | null>(null),
    [deleting, setDeleting] = useState<SavedRun | null>(null);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const week = runs.runs.filter((run) => run.draft.started >= start.getTime());
  const shown = error || runs.error;
  return (
    <>
      <PageHeader
        title="History"
        description="A record of showing up."
        actions={
          <Button variant="secondary" disabled={runs.loading || busy} onClick={runs.reload}>
            Refresh
          </Button>
        }
      />
      <Card>
        <p className="mb-4 text-xs font-bold uppercase tracking-widest text-accent">This week · from Monday</p>
        <div className="grid grid-cols-3 gap-3">
          <Metric label="Runs" value={String(week.length)} />
          <Metric
            label="Distance"
            value={(week.reduce((sum, r) => sum + distance(r.draft), 0) / unitMeters(unit)).toFixed(1)}
            unit={unit}
          />
          <Metric label="Duration" value={clock(week.reduce((sum, r) => sum + r.draft.activeMs, 0))} />
        </div>
      </Card>
      {shown && (
        <p role="alert" className="rounded-xl border border-danger p-4 text-sm text-danger">
          {shown}
        </p>
      )}
      {runs.loading ? (
        <p role="status">Loading your runs…</p>
      ) : !runs.runs.length ? (
        <EmptyState
          title="Your first run starts here"
          message="Finish a run to see your route, pace and splits."
          action={<Button onClick={() => navigate("/")}>Record a run</Button>}
        />
      ) : (
        <div className="space-y-4">
          {runs.runs.map((run) => (
            <Card key={run.id}>
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  <h2 className="break-words text-lg font-bold">{run.title}</h2>
                  <p className="mt-1 text-xs text-muted">{new Date(run.draft.started).toLocaleString()}</p>
                </div>
                <p className="text-lg font-bold tabular-nums">
                  {(distance(run.draft) / unitMeters(unit)).toFixed(2)} {unit}
                </p>
              </div>
              <p className="my-4 text-sm text-muted">
                {clock(run.draft.activeMs)} duration · {pace(run.draft.activeMs, distance(run.draft), unit)} /{unit}{" "}
                average pace{run.draft.gaps ? " · GPS gaps recorded" : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setSelected(run)}>
                  View run
                </Button>
                <Button variant="ghost" onClick={() => downloadGpx(run.title, run.draft)}>
                  Export GPX
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setDeleting(run)}>
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.title}>
        {selected && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Duration {clock(selected.draft.activeMs)} · Total elapsed{" "}
              {clock(selected.draft.updated - selected.draft.started)} · Paused{" "}
              {clock(selected.draft.updated - selected.draft.started - selected.draft.activeMs)}
            </p>
            <RouteMap points={selected.draft.points} />
            <SplitTable draft={selected.draft} unit={unit} />
            <Button variant="secondary" onClick={() => downloadGpx(selected.title, selected.draft)}>
              Export GPX
            </Button>
          </div>
        )}
      </Modal>
      <Modal open={!!deleting} onClose={() => !busy && setDeleting(null)} title="Delete this run?">
        <p className="mb-4 text-sm">
          Remove “{deleting?.title}” from this device? Export GPX first if you want a copy.
        </p>
        <Button
          variant="danger"
          loading={busy}
          onClick={() => {
            const run = deleting;
            if (!run) return;
            setBusy(true);
            setError("");
            removeDeviceRun(run.id)
              .then(() => {
                setDeleting(null);
                runs.reload();
              })
              .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Delete failed."))
              .finally(() => setBusy(false));
          }}
        >
          Delete run
        </Button>
      </Modal>
    </>
  );
}
