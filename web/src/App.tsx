import { useEffect, useMemo, useState } from "react";
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
  recentPace,
  splits,
  unitMeters,
  type Draft,
  type Unit,
} from "./engine";
import { deviceRuns, readDevicePlan, removeDeviceRun, writeDevicePlan, type SavedRun } from "./storage";
import { downloadGpx } from "./gpx";
import { useRecorder } from "./useRecorder";
import { COMPANION_LINK } from "./native";
import { useNativeSource } from "./useNativeSource";
import { buildPlan, completes, cue, type PlanSettings, type Workout } from "./plan";
import { announce, PlanPage } from "./PlanPage";
import { Metric, RecordScreen, RouteMapLazy, SplitTable } from "./RecordScreen";
import { ICONS, IconNavigation, NavigationIcon } from "./IconNav";
import { Button } from "./ui";

export const fas = initApp({ appId: "run" });

const NAV: NavItem[] = [
  { label: "Record", href: "/", title: "Record — Run", icon: <NavigationIcon path={ICONS.record} /> },
  { label: "Plan", href: "/plan", title: "Plan — Run", icon: <NavigationIcon path={ICONS.plan} /> },
  { label: "History", href: "/history", title: "History — Run", icon: <NavigationIcon path={ICONS.history} /> },
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
  // Single-user: runs belong to this device, never to an account. The companion
  // source only fills a locked stretch from the signed-in user's own points.
  const { status, signedIn, source } = useNativeSource(fas);
  const recorder = useRecorder(null, keepAwake, source);
  const offerCompanion = signedIn && status?.available === true && !status.enabled;
  useEffect(() => {
    const changed = () => setPath(location.pathname);
    window.addEventListener("popstate", changed);
    return () => window.removeEventListener("popstate", changed);
  }, []);
  return (
    <Shell
      app={fas}
      appName="Run"
      nav={NAV}
      renderNav={(context) => (
        <IconNavigation {...context} activity={recorder.running ? { href: "/", label: "Run recording" } : undefined} />
      )}
      onNavigate={navigate}
      profileHref="/profile"
      headerAppearance={false}
    >
      <Workspace
        path={path}
        recorder={recorder}
        unit={unit}
        setUnit={setUnit}
        keepAwake={keepAwake}
        setKeepAwake={setKeepAwake}
        voice={voice}
        setVoice={setVoice}
        offerCompanion={offerCompanion}
        signedIn={signedIn}
      />
    </Shell>
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
  offerCompanion,
  signedIn,
}: {
  path: string;
  recorder: ReturnType<typeof useRecorder>;
  unit: Unit;
  setUnit: (value: Unit) => void;
  keepAwake: boolean;
  setKeepAwake: (value: boolean) => void;
  voice: boolean;
  setVoice: (value: boolean) => void;
  offerCompanion: boolean;
  signedIn: boolean;
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
    <div
      className={
        path === "/"
          ? // Record fills one phone screen below 1024px: the page itself never scrolls.
            "mx-auto flex h-[calc(100dvh-4rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full max-w-5xl flex-col gap-3 px-3 py-3 sm:px-6 lg:block lg:h-auto lg:space-y-6 lg:py-10"
          : "mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-10"
      }
    >
      {recorder.running && path !== "/" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-accent-soft p-4">
          <span className="font-semibold">
            Recording · {clock(duration)} · {(total / unitMeters(unit)).toFixed(2)} {unit}
          </span>
          <Button onClick={() => navigate("/")}>Back to run</Button>
        </div>
      )}
      {notice && (
        <p role="status" className="shrink-0 rounded-xl bg-accent-soft p-3 text-sm">
          {notice}
        </p>
      )}
      {recorder.error && (
        <p role="alert" className="shrink-0 rounded-xl border border-danger p-3 text-sm text-danger">
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
          note="Your plan is saved on this device."
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
                If you are signed in and the FreeAppStore phone app shares location with Run, Run adds the route that
                app recorded while locked when you return.
                GPS needs location permission, but recording and saves work without internet after the app is loaded. Map
                imagery needs a connection. Saved runs are accessible to anyone using this browser profile and can be lost
                if browser storage is cleared.
              </p>
            </Card>
          </div>
        </ProfilePage>
      ) : (
        <>
          <RecordScreen
            recorder={recorder}
            unit={unit}
            voice={voice}
            following={following}
            offered={offered}
            privacy="Stays on this device"
            onStartWorkout={startWorkout}
            onFinish={() => {
              if (!draft) return;
              recorder.stop();
              setTitle(
                following
                  ? `Week ${following.week} · ${following.title}`
                  : `Run · ${new Date(draft.started).toLocaleDateString()}`,
              );
              setFinishOpen(true);
            }}
            onDiscard={() => {
              recorder.stop();
              setDiscardOpen(true);
            }}
          />
          {offerCompanion && (
            <p className="mt-3 text-xs text-muted">
              Keep recording when locked:{" "}
              <a className="font-semibold text-accent underline" href={COMPANION_LINK}>
                open the FreeAppStore app
              </a>
            </p>
          )}
          {!signedIn && (
            <p className="mt-3 text-xs text-muted">
              Keep recording when locked: sign in, then turn on Run in the FreeAppStore phone app.
            </p>
          )}
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
            <RouteMapLazy points={selected.draft.points} />
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
