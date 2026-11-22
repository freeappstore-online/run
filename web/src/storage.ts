import {
  getRecord,
  openStore,
  withTransaction,
  type LocalStore,
  type StorageResult,
} from "@freeappstore/sdk/persist";
import { checkpoint, restore, type Draft, type Session } from "./engine";
import { parsePlan, type PlanSettings } from "./plan";

// Single-user and device-only: nothing here leaves the browser. GPX export is the backup.
export type SavedRun = {
  id: string;
  ownerId: string | null;
  title: string;
  draft: Draft;
};
const DRAFT_KEY = "run:draft:v1";
export function loadDraft() {
  return restore(localStorage.getItem(DRAFT_KEY));
}
export function writeDraft(state: Session, now = Date.now()) {
  const draft = checkpoint(state, now);
  if (draft) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  else localStorage.removeItem(DRAFT_KEY);
}

const isIndex = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((id) => typeof id === "string");
function unwrap<T>(result: StorageResult<T>, message: string): T {
  if (!result.ok) throw Error(message);
  return result.value;
}
async function withStore<T>(work: (store: LocalStore) => Promise<T>) {
  const opened = unwrap(
    await openStore({ namespace: "run", version: 1 }),
    "Device storage is unavailable in this browser.",
  );
  try {
    return await work(opened);
  } finally {
    opened.close();
  }
}
// Runs are stored one record each, with an "index" record listing their ids.
async function updateIndex(
  store: LocalStore,
  change: (ids: string[]) => string[],
  record: { put: SavedRun } | { delete: string },
  message: string,
) {
  unwrap(
    await withTransaction(store, "readwrite", async (tx) => {
      const ids = await tx.get("index");
      if (ids !== undefined && !isIndex(ids)) throw Error("corrupt index");
      if ("put" in record) await tx.put(`run.${record.put.id}`, record.put);
      else await tx.delete(`run.${record.delete}`);
      await tx.put("index", change(ids ?? []));
    }),
    message,
  );
}
export function archiveRun(run: SavedRun) {
  return withStore(async (store) => {
    await updateIndex(
      store,
      (ids) => (ids.includes(run.id) ? ids : [...ids, run.id]),
      { put: run },
      "Could not save on this device. Your draft is still available.",
    );
    const check = await getRecord<SavedRun>(store, `run.${run.id}`);
    if (!check.ok || JSON.stringify(check.value) !== JSON.stringify(run))
      throw Error("Could not verify the device copy. Your draft is still available.");
  });
}
export function deviceRuns() {
  return withStore(async (store) => {
    const found = unwrap(
      await withTransaction(store, "readonly", async (tx) => {
        const ids = await tx.get("index");
        if (ids === undefined) return [];
        if (!isIndex(ids)) throw Error("corrupt index");
        return Promise.all(ids.map((id) => tx.get(`run.${id}`)));
      }),
      "Device history could not be read.",
    );
    const runs = (found as (SavedRun | undefined)[]).filter(
      (run): run is SavedRun =>
        !!run && typeof run.title === "string" && run.id === run.draft?.id && !!restore(JSON.stringify(run.draft)),
    );
    return runs.sort((a, b) => b.draft.started - a.draft.started);
  });
}
export function removeDeviceRun(id: string) {
  return withStore((store) =>
    updateIndex(store, (ids) => ids.filter((x) => x !== id), { delete: id }, "Could not delete this run."),
  );
}

const PLAN_KEY = "run:plan:v1";
export function readDevicePlan() {
  try {
    return parsePlan(localStorage.getItem(PLAN_KEY));
  } catch {
    return null;
  }
}
export function writeDevicePlan(plan: PlanSettings) {
  localStorage.setItem(PLAN_KEY, JSON.stringify(plan));
}
