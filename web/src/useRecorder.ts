import { useCallback, useEffect, useRef, useState } from "react";
import {
  emptySession,
  resume,
  pause,
  ingest,
  expire,
  gap,
  hide as hideRun,
  catchUp,
  distance,
  type Draft,
  type Fix,
  type GapSource,
  type Session,
} from "./engine";
import { archiveRun, loadDraft, writeDraft } from "./storage";

const omitHiddenAt = ({ hiddenAt: _hiddenAt, ...draft }: Draft): Draft => draft;
const CATCH_UP_TIMEOUT = 8000;
const RETRY_DELAY = 1500;
const STALE_NEWEST = 20000;
const NO_ROUTE =
  "Paused while locked. The locked-screen route could not be fetched. Tap Resume to continue, or reconnect and try again.";
const NO_LOCKED_ROUTE =
  "No route came from the phone for the locked time (not moving, or weak GPS). Recording continues from now.";

/** Fetch the locked window within one 8 s budget, retrying once when the source looks incomplete or behind. */
async function fetchWindow(source: GapSource, since: number): Promise<Fix[]> {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), CATCH_UP_TIMEOUT);
  const aborted = new Promise<never>((_, reject) =>
    control.signal.addEventListener("abort", () => reject(Error("timeout"))),
  );
  aborted.catch(() => {});
  const attempt = async () => {
    const until = Date.now();
    const result = await Promise.race([source.fetch(since, until, control.signal), aborted]);
    const newest = result.fixes.reduce((n, f) => Math.max(n, f.at), 0);
    return { fixes: result.fixes, behind: !result.complete || until - newest > STALE_NEWEST };
  };
  try {
    const first = await attempt();
    if (!first.behind) return first.fixes;
    await Promise.race([new Promise((r) => setTimeout(r, RETRY_DELAY)), aborted]);
    // The retry re-reads the whole window, so never merge the two reads: each may
    // have chosen a different phone's stream. Keep the first only if the retry fell short.
    const second = await attempt().catch(() => null);
    return second && second.fixes.length >= first.fixes.length ? second.fixes : first.fixes;
  } finally {
    clearTimeout(timer);
    control.abort();
  }
}

export function useRecorder(owner: string | null, keepAwake: boolean, source?: GapSource) {
  const [initial] = useState(() => {
    try {
      const draft = loadDraft();
      return {
        state: {
          ...emptySession(),
          draft,
          message: draft
            ? "Recovered run. Resume explicitly when ready."
            : "Ready when you are.",
        },
        error: "",
      };
    } catch {
      return {
        state: emptySession(),
        error:
          "Device backup is unavailable. Keep this page open and export your run before leaving.",
      };
    }
  });
  const [state, setState] = useState<Session>(initial.state),
    current = useRef(state);
  const [error, setError] = useState(""),
    [backupError, setBackupError] = useState(initial.error),
    [now, setNow] = useState(Date.now()),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(false);
  const [awake, setAwake] = useState(false),
    locked = useRef(false),
    [revision, setRevision] = useState(0);
  const update = useCallback((next: Session) => {
    current.current = next;
    setState(next);
  }, []);
  const backup = useCallback(() => {
    try {
      writeDraft(current.current);
      setBackupError("");
    } catch {
      setBackupError(
        "Device backup failed. Keep this page open; finish and export your run.",
      );
    }
  }, []);
  const stop = useCallback(
    (message?: string) => {
      update(pause(current.current, Date.now(), message));
      backup();
    },
    [update, backup],
  );
  const sourceRef = useRef(source),
    ownerRef = useRef(owner);
  sourceRef.current = source;
  ownerRef.current = owner;
  /** Add the points recorded while locked; true when the run now continues from them. */
  const catchUpNow = useCallback(
    async (): Promise<boolean> => {
      const src = sourceRef.current,
        draft = current.current.draft;
      if (!src?.covers || draft?.hiddenAt == null || draft.resumed !== null || locked.current)
        return false;
      // Another account's locked-screen points never enter this draft.
      if (draft.ownerId !== ownerRef.current) return false;
      locked.current = true;
      setBusy(true);
      setPending(true);
      update({ ...current.current, message: "Adding the route recorded while locked..." });
      try {
        const fixes = await fetchWindow(src, draft.hiddenAt).catch(() => null);
        const result = fixes ? catchUp(current.current, fixes, Date.now()) : { added: 0, state: current.current };
        if (result.added > 0) {
          update({ ...result.state, message: "Added the route recorded while locked." });
          // Locked again while fetching: pause once more instead of recording in the background.
          if (document.hidden) update(hideRun(current.current, Date.now(), true));
          return true;
        }
        // The phone answered but had no usable route (standing still, or poor indoor fixes):
        // keep recording from now. The locked stretch stays a gap; nothing is guessed.
        if (fixes && !document.hidden) {
          const next = resume(current.current, ownerRef.current, Date.now(), crypto.randomUUID());
          if (next.draft?.resumed != null) {
            update({ ...next, message: NO_LOCKED_ROUTE });
            return true;
          }
        }
        update({ ...current.current, message: NO_ROUTE });
        return false;
      } finally {
        backup();
        locked.current = false;
        setPending(false);
        setBusy(false);
      }
    },
    [update, backup],
  );
  const running = state.draft?.resumed != null;
  useEffect(() => {
    const timer = setInterval(() => {
      const at = Date.now();
      setNow(at);
      update(expire(current.current, at));
    }, 1000);
    const checkpoint = setInterval(backup, 5000);
    const retry = () => {
      const draft = current.current.draft;
      if (!document.hidden && draft?.hiddenAt != null && draft.resumed === null)
        void catchUpNow();
    };
    const hidden = () => {
      if (document.hidden) {
        if (sourceRef.current) {
          update(hideRun(current.current, Date.now(), sourceRef.current.covers));
          backup();
        } else
          stop(
            "Paused because the app was hidden. Resume explicitly to continue.",
          );
      } else if (sourceRef.current) retry();
    };
    // iOS can fire pagehide before (or instead of) visibilitychange when a PWA is backgrounded:
    // keep the locked stretch for catch-up when a source covers it.
    const hide = () => {
      if (sourceRef.current?.covers) {
        update(hideRun(current.current, Date.now(), true));
        backup();
      } else stop("Recovered run. Resume explicitly to continue.");
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", hide);
    window.addEventListener("online", retry);
    return () => {
      window.removeEventListener("online", retry);
      clearInterval(timer);
      clearInterval(checkpoint);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", hide);
    };
  }, [update, stop, backup, catchUpNow]);
  // A source that starts covering while a hidden recording draft waits (iOS reloaded the app, or
  // the status answer arrived after the page became visible) catches up without a tap.
  const covers = !!source?.covers;
  useEffect(() => {
    const draft = current.current.draft;
    if (covers && !document.hidden && draft?.hiddenAt != null && draft.resumed === null)
      void catchUpNow();
  }, [covers, catchUpNow]);
  const lastOwner = useRef(owner);
  useEffect(() => {
    if (lastOwner.current !== owner) {
      lastOwner.current = owner;
      stop("Account changed. Run paused and preserved on this device.");
    }
  }, [owner, stop]);
  useEffect(() => {
    if (!running) return;
    if (!navigator.geolocation) {
      stop("This browser does not support location.");
      return;
    }
    let disposed = false;
    const watch = navigator.geolocation.watchPosition(
      (position) => {
        if (disposed || document.hidden) return;
        update(
          ingest(
            current.current,
            {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
              accuracy: position.coords.accuracy,
              altitude: position.coords.altitude,
              speed: position.coords.speed,
              at: position.timestamp,
            },
            Date.now(),
          ),
        );
      },
      (cause) => {
        if (disposed) return;
        if (cause.code === 1)
          stop(
            "Location permission denied. Enable it in browser settings, then resume.",
          );
        else
          update(
            gap(current.current, "Waiting for GPS. Move to an open area."),
          );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
    return () => {
      disposed = true;
      navigator.geolocation.clearWatch(watch);
    };
  }, [running, stop, update]);
  useEffect(() => {
    if (!running || !keepAwake || !navigator.wakeLock) return;
    let disposed = false,
      lock: WakeLockSentinel | undefined;
    void navigator.wakeLock
      .request("screen")
      .then((value) => {
        if (disposed) void value.release();
        else {
          lock = value;
          setAwake(true);
          value.addEventListener("release", () => setAwake(false));
        }
      })
      .catch(() => setAwake(false));
    return () => {
      disposed = true;
      setAwake(false);
      void lock?.release();
    };
  }, [running, keepAwake]);
  useEffect(() => {
    if (!running) return;
    const unload = (e: BeforeUnloadEvent) => {
      backup();
      e.preventDefault();
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [running, backup]);
  function begin(workout?: string, message?: string) {
    const next = resume(current.current, owner, Date.now(), crypto.randomUUID(), workout);
    update(message && next.draft?.resumed != null ? { ...next, message } : next);
    backup();
  }
  async function resumeAfterCatchUp(workout?: string) {
    if (await catchUpNow()) return;
    begin(workout, "No locked-screen route was received; recording resumed from now.");
  }
  function start(workout?: string) {
    if (locked.current || document.hidden) return;
    if (current.current.draft?.hiddenAt != null) void resumeAfterCatchUp(workout);
    else begin(workout);
  }
  async function finish(title: string) {
    if (locked.current) return false;
    if (current.current.draft?.hiddenAt != null) await catchUpNow();
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    stop();
    try {
      const draft = current.current.draft;
      if (!draft || draft.points.length < 2 || distance(draft) < 3)
        throw Error(
          "Record a little movement before saving, or discard this draft.",
        );
      await archiveRun({
        id: draft.id,
        ownerId: draft.ownerId,
        title: title.trim().slice(0, 100) || "My run",
        draft: omitHiddenAt(draft),
      });
      writeDraft(emptySession());
      update(emptySession());
      setRevision((n) => n + 1);
      setError("");
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Save failed. Your draft is still available.",
      );
      return false;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  function discard() {
    if (locked.current) return;
    stop();
    try {
      writeDraft(emptySession());
      update(emptySession());
      setError("");
    } catch {
      setError("Could not clear the device draft.");
    }
  }
  return {
    state,
    now,
    running,
    awake,
    error: error || backupError,
    busy,
    gap: { covers, pending },
    revision,
    start,
    stop,
    finish,
    discard,
  };
}
