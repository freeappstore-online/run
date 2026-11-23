import { useEffect, useMemo, useState } from "react";
import type { FreeAppStore } from "@freeappstore/sdk";
import { nativeSource, nativeStatus, type NativeStatus } from "./native";

/** Status for the signed-in user, refreshed when the user changes or the page becomes visible again. */
export function useNativeSource(fas: FreeAppStore) {
  const [userId, setUserId] = useState<string | null>(() => fas.auth.user?.id ?? null);
  const [status, setStatus] = useState<NativeStatus | null>(null);
  useEffect(() => fas.auth.onChange((user) => setUserId(user?.id ?? null)), [fas]);
  const authFetch = useMemo(
    () => async (url: string, init?: RequestInit) => {
      const token = fas.auth.token;
      if (!token) throw Error("Not signed in.");
      const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}` } });
      if (r.status === 401) fas.auth.handleUnauthorized(token);
      return r;
    },
    [fas],
  );
  useEffect(() => {
    let current = true;
    const refresh = () => {
      if (!userId) return setStatus(null);
      void nativeStatus(authFetch).then((s) => current && setStatus(s));
    };
    refresh();
    const visible = () => !document.hidden && refresh();
    document.addEventListener("visibilitychange", visible);
    return () => {
      current = false;
      document.removeEventListener("visibilitychange", visible);
    };
  }, [userId, authFetch]);
  const covers = !!userId && status?.enabled === true;
  const source = useMemo(() => nativeSource(covers, authFetch), [covers, authFetch]);
  return { status, source, signedIn: !!userId };
}
