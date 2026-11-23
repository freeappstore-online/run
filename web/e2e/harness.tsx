// Dev-server-only page for tests/browser: the real recorder and Record screen with a fake GapSource
// the test controls through window.gap. Not part of the production build (vite builds index.html only).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../src/index.css";
import { RecordScreen } from "../src/RecordScreen";
import { useRecorder } from "../src/useRecorder";
import type { GapSource } from "../src/engine";

type Control = {
  covers: boolean;
  behavior: "fixes" | "empty" | "reject";
  calls: { since: number; until: number }[];
};
const gap: Control = ((window as unknown as { gap: Control }).gap = { covers: true, behavior: "fixes", calls: [] });
const source: GapSource = {
  get covers() {
    return gap.covers;
  },
  async fetch(since, until) {
    gap.calls.push({ since, until });
    if (gap.behavior === "reject") throw Error("offline");
    if (gap.behavior === "empty") return { fixes: [], complete: true };
    const fixes = Array.from({ length: 30 }, (_, i) => ({
      lat: -37.81,
      lng: 144.96 + (50 + i * 6) / 87850,
      at: since + 2000 * (i + 1),
      accuracy: 5,
      altitude: null,
    })).filter((f) => f.at <= until);
    return { fixes, complete: true };
  },
};

function Harness() {
  const recorder = useRecorder(null, false, source);
  return (
    <RecordScreen
      recorder={recorder}
      unit="km"
      voice={false}
      following={undefined}
      offered={undefined}
      privacy="Stays on this device"
      onStartWorkout={() => {}}
      onFinish={() => void recorder.finish("Test run")}
      onDiscard={recorder.discard}
    />
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
