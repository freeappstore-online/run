import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
maplibregl.setWorkerUrl(mapWorkerUrl);
import { Button } from "./ui";
import { segments, type Point } from "./engine";
export function RouteMap({
  points,
  follow = false,
}: {
  points: Point[];
  follow?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<maplibregl.Map | null>(null),
    current = useRef(points);
  const [ready, setReady] = useState(false),
    [failed, setFailed] = useState(false);
  current.current = points;
  useEffect(() => {
    if (!container.current) return;
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({
        container: container.current,
        center: [0, 20],
        zoom: 1.4,
        attributionControl: { compact: true },
        style: {
          version: 8,
          sources: {
            osm: {
              type: "raster",
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution:
                '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            },
          },
          layers: [{ id: "base", type: "raster", source: "osm" }],
        },
      });
      map.current = m;
      m.addControl(
        new maplibregl.NavigationControl({ showCompass: false }),
        "top-right",
      );
      m.on("load", () => {
        m.addSource("route", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        m.addLayer({
          id: "route-line",
          type: "line",
          source: "route",
          filter: ["==", ["geometry-type"], "LineString"],
          paint: { "line-color": "#087f5b", "line-width": 5 },
          layout: { "line-cap": "round", "line-join": "round" },
        });
        m.addLayer({
          id: "route-point",
          type: "circle",
          source: "route",
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-radius": 7,
            "circle-color": "#087f5b",
            "circle-stroke-width": 3,
            "circle-stroke-color": "#ffffff",
          },
        });
        setReady(true);
      });
      m.on("error", () => setFailed(true));
    } catch {
      setFailed(true);
      return;
    }
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);
  function fit() {
    const p = current.current,
      m = map.current;
    if (!m || !p.length) return;
    const bounds = new maplibregl.LngLatBounds();
    p.forEach((point) => bounds.extend([point.lng, point.lat]));
    m.fitBounds(bounds, { padding: 50, maxZoom: 16, duration: 0 });
  }
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const source = m.getSource("route") as maplibregl.GeoJSONSource;
    if (!source) return;
    const lines = segments(points).filter((line) => line.length > 1);
    source.setData({
      type: "FeatureCollection",
      features: [
        ...lines.map((line) => ({
          type: "Feature" as const,
          properties: {},
          geometry: {
            type: "LineString" as const,
            coordinates: line.map((p) => [p.lng, p.lat]),
          },
        })),
        ...points
          .slice(-1)
          .map((p) => ({
            type: "Feature" as const,
            properties: {},
            geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
          })),
      ],
    });
    if (follow && points.length) {
      const p = points.at(-1)!;
      m.jumpTo({ center: [p.lng, p.lat], zoom: Math.max(m.getZoom(), 15) });
    } else fit();
  }, [points, ready, follow]);
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-panel">
      <div className="relative">
        <div
          ref={container}
          className="h-72 w-full sm:h-96"
          aria-label="Run route map"
          role="region"
        />
        {!points.length && (
          <div className="pointer-events-none absolute bottom-4 left-4 right-4 rounded-xl bg-paper p-3 text-sm text-ink shadow">
            Your route appears here after you start and GPS connects.
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-2">
        <span className="text-xs text-muted">
          {failed
            ? "Map imagery unavailable. GPS recording still works."
            : "Route stays private · map imagery needs internet"}
        </span>
        <Button variant="ghost" onClick={fit} disabled={!points.length}>
          Fit route
        </Button>
      </div>
    </div>
  );
}
