import type { Fix, GapSource } from "./engine";

// FAS-only: the FreeAppStore companion's server points as a core GapSource (see engine.ts).
// The caller passes the signed-in user's authenticatedFetch; nothing here runs for a guest.
export type NativeStatus = { available: boolean; enabled: boolean; lastPointAt: number | null };
type NativePoint = { grantId: string; at: number; lat: number; lng: number; accuracy: number; cursorId: string };

export type AuthFetch = (url: string, init?: RequestInit) => Promise<Response>;
export const COMPANION_LINK = "freeappstore://native/apps/run";
const BASE = "https://api.freeappstore.online/v1/apps/run/native";
const PAGE = 500; // the route's fixed page size
const MAX_PAGES = 40; // 40 x 500 = the engine's 20,000-point cap

/** Companion state for the signed-in user; null for a guest or when the read fails. Never reads locations. */
export async function nativeStatus(authFetch: AuthFetch): Promise<NativeStatus | null> {
  try {
    const r = await authFetch(`${BASE}/status`);
    if (!r.ok) return null;
    const s = (await r.json()) as Partial<NativeStatus>;
    return {
      available: s.available === true,
      enabled: s.enabled === true,
      lastPointAt: typeof s.lastPointAt === "number" ? s.lastPointAt : null,
    };
  } catch {
    return null;
  }
}

/** Several phones can be enrolled; keep the one device/stream with the most points so tracks never interleave. */
export function pickStream(points: NativePoint[]): Fix[] {
  const groups = new Map<string, NativePoint[]>();
  for (const p of points) {
    const group = groups.get(p.grantId);
    if (group) group.push(p);
    else groups.set(p.grantId, [p]);
  }
  let best: NativePoint[] = [];
  for (const g of groups.values()) if (g.length > best.length) best = g;
  return best.map((p) => ({ lat: p.lat, lng: p.lng, at: p.at, accuracy: p.accuracy, altitude: null }));
}

/** Points in (since, until], paged by the route's composite cursor. Only called for a draft hidden while recording. */
export function nativeSource(covers: boolean, authFetch: AuthFetch): GapSource {
  return {
    covers,
    async fetch(since, until, signal) {
      const collected: NativePoint[] = [];
      let after = since,
        afterId = "";
      try {
        for (let page = 0; ; page++) {
          const q = new URLSearchParams({ after: String(after), afterId });
          const r = await authFetch(`${BASE}/locations?${q}`, { signal });
          if (!r.ok) throw Error(`locations ${r.status}`);
          const { points } = (await r.json()) as { points: NativePoint[] };
          collected.push(...points.filter((p) => p.at > since && p.at <= until));
          const last = points.at(-1);
          if (points.length < PAGE || !last || last.at > until) break;
          if (page + 1 >= MAX_PAGES) return { fixes: pickStream(collected), complete: false };
          after = last.at;
          afterId = last.cursorId;
        }
      } catch (cause) {
        if (signal.aborted) throw cause;
        return { fixes: pickStream(collected), complete: false };
      }
      return { fixes: pickStream(collected), complete: true };
    },
  };
}
