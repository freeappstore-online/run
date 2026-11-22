// Foreground recorder adapted from Ski's segmented GPS and recoverable-draft model.
export type Fix = {
  lat: number;
  lng: number;
  at: number;
  accuracy: number;
  altitude: number | null;
};
export type Point = Fix & {
  segment: number;
  distance: number;
  activeMs: number;
};
export type Draft = {
  version: 1;
  id: string;
  ownerId: string | null;
  started: number;
  updated: number;
  activeMs: number;
  resumed: number | null;
  segment: number;
  gaps: number;
  points: Point[];
  /** Planned workout this run follows, if any. */
  workout?: string;
};
export type Session = {
  draft: Draft | null;
  lastFix: Fix | null;
  message: string;
};
export const emptySession = (): Session => ({
  draft: null,
  lastFix: null,
  message: "Ready when you are.",
});
export function meters(a: Fix, b: Fix) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) *
      Math.cos(b.lat * rad) *
      Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
export const activeTime = (draft: Draft | null, now: number) =>
  draft
    ? draft.activeMs +
      (draft.resumed === null ? 0 : Math.max(0, now - draft.resumed))
    : 0;
export const distance = (draft: Draft | null) =>
  draft?.points.at(-1)?.distance ?? 0;
export function resume(
  state: Session,
  ownerId: string | null,
  now: number,
  id: string,
  workout?: string,
): Session {
  if (state.draft?.resumed != null) return state;
  if (state.draft?.ownerId && state.draft.ownerId !== ownerId)
    return {
      ...state,
      message:
        "Sign in to the account that started this run, or save it on this device.",
    };
  const draft: Draft = state.draft
    ? {
        ...state.draft,
        resumed: now,
        updated: now,
        segment: state.draft.segment + 1,
      }
    : {
        version: 1,
        id,
        ownerId,
        started: now,
        updated: now,
        activeMs: 0,
        resumed: now,
        segment: 0,
        gaps: 0,
        points: [],
        ...(workout ? { workout } : {}),
      };
  return {
    draft,
    lastFix: null,
    message: "Waiting for accurate GPS. The timer is running.",
  };
}
export function pause(
  state: Session,
  now: number,
  message = "Paused. Resume when you are ready.",
): Session {
  if (!state.draft || state.draft.resumed === null) return state;
  return {
    draft: {
      ...state.draft,
      activeMs: activeTime(state.draft, now),
      resumed: null,
      updated: now,
    },
    lastFix: null,
    message,
  };
}
export function gap(state: Session, message: string): Session {
  if (!state.draft || state.draft.resumed === null) return state;
  return {
    ...state,
    lastFix: null,
    message,
    draft: state.lastFix
      ? {
          ...state.draft,
          segment: state.draft.segment + 1,
          gaps: state.draft.gaps + 1,
        }
      : state.draft,
  };
}
export function expire(state: Session, now: number): Session {
  return state.lastFix && now - state.lastFix.at > 15000
    ? gap(
        state,
        "GPS signal lost. Timer continues; missing distance is not guessed.",
      )
    : state;
}
export function validFix(p: Fix) {
  return (
    p &&
    [p.lat, p.lng, p.at, p.accuracy].every(Number.isFinite) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180 &&
    p.at >= 0 &&
    p.at <= 8640000000000000 &&
    p.accuracy >= 0 &&
    p.accuracy <= 25 &&
    (p.altitude === null || Number.isFinite(p.altitude))
  );
}
export function ingest(state: Session, fix: Fix, now: number): Session {
  const d = state.draft;
  if (!d || d.resumed === null) return state;
  if (now - fix.at > 15000 || fix.at > now + 2000 || fix.at < d.resumed)
    return gap(state, "Waiting for a fresh GPS fix.");
  if (!validFix(fix))
    return gap(
      state,
      "GPS is uncertain. Move to an open area; the timer continues.",
    );
  if (state.lastFix && fix.at <= state.lastFix.at) return state;
  if (state.lastFix && fix.at - state.lastFix.at > 15000)
    return ingest(gap(state, "GPS recovered."), fix, now);
  if (
    state.lastFix &&
    meters(state.lastFix, fix) / ((fix.at - state.lastFix.at) / 1000) > 12
  )
    return gap(state, "GPS jump ignored. Waiting for a reliable position.");
  if (d.points.length >= 20000)
    return pause(
      state,
      now,
      "Recording limit reached. Finish and save this run.",
    );
  const anchor = d.points.at(-1);
  if (anchor && fix.at <= anchor.at) return state;
  const same = anchor && anchor.segment === d.segment;
  const delta = same ? meters(anchor, fix) : 0;
  const threshold = Math.max(
    3,
    Math.min(anchor?.accuracy ?? fix.accuracy, fix.accuracy) * 0.5,
  );
  const points =
    same && delta < threshold
      ? d.points
      : [
          ...d.points,
          {
            ...fix,
            segment: d.segment,
            distance: distance(d) + delta,
            activeMs: activeTime(d, now),
          },
        ];
  return {
    draft: { ...d, points, updated: now },
    lastFix: fix,
    message: `GPS connected · ±${Math.round(fix.accuracy)} m`,
  };
}
export function checkpoint(state: Session, now: number): Draft | null {
  return pause(state, now).draft;
}
export function restore(raw: string | null): Draft | null {
  try {
    const d: Draft = JSON.parse(raw || "null");
    if (
      !d ||
      d.version !== 1 ||
      typeof d.id !== "string" ||
      !d.id ||
      d.id.length > 128 ||
      !(d.ownerId === null || typeof d.ownerId === "string") ||
      ![d.started, d.updated, d.activeMs, d.segment, d.gaps].every(
        Number.isFinite,
      ) ||
      d.started < 0 ||
      d.updated < d.started ||
      d.updated > 8640000000000000 ||
      d.activeMs < 0 ||
      d.activeMs > d.updated - d.started + 1 ||
      !Number.isSafeInteger(d.segment) ||
      d.segment < 0 ||
      !Number.isSafeInteger(d.gaps) ||
      d.gaps < 0 ||
      !Array.isArray(d.points) ||
      d.points.length > 20000 ||
      !(d.workout === undefined || (typeof d.workout === "string" && d.workout.length <= 128))
    )
      return null;
    let previous: Point | undefined;
    for (const p of d.points) {
      if (
        !validFix(p) ||
        !Number.isSafeInteger(p.segment) ||
        p.segment < 0 ||
        p.segment > d.segment ||
        !Number.isFinite(p.distance) ||
        p.distance < 0 ||
        p.distance > 500000 ||
        !Number.isFinite(p.activeMs) ||
        p.activeMs < 0 ||
        p.activeMs > d.activeMs ||
        p.at < d.started ||
        p.at > d.updated + 2000 ||
        (previous &&
          (p.at <= previous.at ||
            p.distance < previous.distance ||
            p.activeMs < previous.activeMs ||
            p.segment < previous.segment))
      )
        return null;
      previous = p;
    }
    return { ...d, resumed: null, segment: d.segment + 1 };
  } catch {
    return null;
  }
}
export type Unit = "km" | "mi";
export const unitMeters = (unit: Unit) => (unit === "km" ? 1000 : 1609.344);
export function clock(ms: number) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(s / 3600)
    .toString()
    .padStart(
      2,
      "0",
    )}:${Math.floor(s / 60) % 60 < 10 ? "0" : ""}${Math.floor(s / 60) % 60}:${(s % 60).toString().padStart(2, "0")}`;
}
export function pace(ms: number, meters: number, unit: Unit) {
  if (meters < 10 || ms <= 0) return "—";
  const seconds = Math.round(ms / 1000 / (meters / unitMeters(unit)));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function currentPace(d: Draft | null, now: number, unit: Unit) {
  if (!d || d.resumed === null) return "—";
  const last = d.points.at(-1);
  if (!last || now - last.at > 10000) return "—";
  const recent = d.points.filter(
    (p) => p.segment === last.segment && last.at - p.at <= 30000,
  );
  const first = recent[0];
  return first
    ? pace(last.activeMs - first.activeMs, last.distance - first.distance, unit)
    : "—";
}
export function splits(points: Point[], unit: Unit) {
  const length = unitMeters(unit),
    result: { number: number; ms: number; pace: string }[] = [];
  let target = length,
    prior = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    if (a.segment !== b.segment || b.distance <= a.distance) continue;
    while (b.distance >= target) {
      const at =
        a.activeMs +
        ((b.activeMs - a.activeMs) * (target - a.distance)) /
          (b.distance - a.distance);
      result.push({
        number: result.length + 1,
        ms: at - prior,
        pace: pace(at - prior, length, unit),
      });
      prior = at;
      target += length;
    }
  }
  return result;
}
export function segments(points: Point[]) {
  const out: Point[][] = [];
  for (const p of points) {
    if (out.at(-1)?.at(-1)?.segment !== p.segment) out.push([]);
    out.at(-1)!.push(p);
  }
  return out;
}
