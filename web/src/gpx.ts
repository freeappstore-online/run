import { segments, type Draft } from "./engine.ts";
const xml = (text: string) =>
  text.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export function gpx(title: string, draft: Draft) {
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Run" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${xml(title)}</name>${segments(
    draft.points,
  )
    .map(
      (line) =>
        `<trkseg>${line.map((p) => `<trkpt lat="${p.lat}" lon="${p.lng}">${p.altitude === null ? "" : `<ele>${p.altitude}</ele>`}<time>${new Date(p.at).toISOString()}</time></trkpt>`).join("")}</trkseg>`,
    )
    .join("")}</trk></gpx>`;
}
export function downloadGpx(title: string, draft: Draft) {
  const url = URL.createObjectURL(
      new Blob([gpx(title, draft)], { type: "application/gpx+xml" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = `${
    title
      .replace(/[^\p{L}\p{N} _-]/gu, "")
      .trim()
      .slice(0, 80) || "run"
  }.gpx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
