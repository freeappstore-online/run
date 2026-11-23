// Shared core between proappstore-online/run and freeappstore-online/run. Copied, not shared
// as a package (no cross-store dependencies), so this keeps the copies byte-identical.
//   node scripts/sync-core.mjs --check        fail if a core file differs from core.json
//   node scripts/sync-core.mjs --write        record the current core files in core.json
//   node scripts/sync-core.mjs <other-repo>   copy the core files from the other app, then --write
// Change core files in one app, run --write there, then sync from it in the other app.
import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FILES = [
  "web/src/engine.ts",
  "web/src/plan.ts",
  "web/src/gpx.ts",
  "web/src/RouteMap.tsx",
  "web/src/useRecorder.ts",
  "web/src/PlanPage.tsx",
  "web/src/RecordScreen.tsx",
  "web/src/IconNav.tsx",
  "tests/engine.test.mjs",
  "tests/plan.test.mjs",
  "scripts/sync-core.mjs",
];
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = resolve(root, "core.json");
const hash = (file) => createHash("sha256").update(readFileSync(resolve(root, file))).digest("hex");
const write = () =>
  writeFileSync(lockPath, JSON.stringify(Object.fromEntries(FILES.map((f) => [f, hash(f)])), null, 2) + "\n");

const arg = process.argv[2];
if (arg === "--check") {
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const drift = FILES.filter((f) => lock[f] !== hash(f));
  if (drift.length) {
    console.error(
      `Shared core changed without a sync: ${drift.join(", ")}.\n` +
        "Make the same change in the other run app, then run `node scripts/sync-core.mjs --write`.",
    );
    process.exit(1);
  }
  console.log("PASS: shared core matches core.json");
} else if (arg === "--write") {
  write();
} else if (arg) {
  for (const file of FILES) copyFileSync(resolve(arg, file), resolve(root, file));
  write();
  console.log(`Synced ${FILES.length} core files from ${arg}`);
} else {
  console.error("Usage: node scripts/sync-core.mjs --check | --write | <path-to-other-run-app>");
  process.exit(2);
}
