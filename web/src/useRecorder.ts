import { useCallback, useEffect, useRef, useState } from "react";
import {
  emptySession,
  resume,
  pause,
  ingest,
  expire,
  gap,
  distance,
  type Session,
} from "./engine";
import { archiveRun, loadDraft, writeDraft } from "./storage";

export function useRecorder(owner: string | null, keepAwake: boolean) {
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
    [busy, setBusy] = useState(false);
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
  const running = state.draft?.resumed != null;
  useEffect(() => {
    const timer = setInterval(() => {
      const at = Date.now();
      setNow(at);
      update(expire(current.current, at));
    }, 1000);
    const checkpoint = setInterval(backup, 5000);
    const hidden = () => {
      if (document.hidden)
        stop(
          "Paused because the app was hidden. Resume explicitly to continue.",
        );
    };
    const hide = () => stop("Recovered run. Resume explicitly to continue.");
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", hide);
    return () => {
      clearInterval(timer);
      clearInterval(checkpoint);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", hide);
    };
  }, [update, stop, backup]);
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
  function start(workout?: string) {
    if (locked.current || document.hidden) return;
    update(resume(current.current, owner, Date.now(), crypto.randomUUID(), workout));
    backup();
  }
  async function finish(title: string) {
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
        draft,
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
    revision,
    start,
    stop,
    finish,
    discard,
  };
}
