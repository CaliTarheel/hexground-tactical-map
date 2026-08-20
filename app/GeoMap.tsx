"use client";

import { useEffect, useRef } from "react";
import type { CircleMarker, LayerGroup, Map as LeafletMap, Polygon } from "leaflet";
import {
  BOARD_COLUMNS,
  BOARD_HEIGHT_METERS,
  BOARD_ROWS,
  BOARD_WIDTH_METERS,
  boardCorners,
  boardToGeo,
  hexCenterMeters,
  hexPolygonMeters,
  type GeoPoint,
} from "./map-geometry";
import { levelAtPoint, type ElevationGrid } from "./elevation-engine";

type GeoMapProps = {
  place: GeoPoint;
  bearing: number;
  elevationGrid: ElevationGrid | null;
  showElevation: boolean;
  onCenterChange: (center: GeoPoint) => void;
};

function centersMatch(a: GeoPoint, b: GeoPoint) {
  return Math.abs(a.lat - b.lat) < 0.0000005 && Math.abs(a.lon - b.lon) < 0.0000005;
}

export default function GeoMap({ place, bearing, elevationGrid, showElevation, onCenterChange }: GeoMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const outlineRef = useRef<Polygon | null>(null);
  const centerRef = useRef<CircleMarker | null>(null);
  const gridRef = useRef<LayerGroup | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const currentRef = useRef({ place, bearing, elevationGrid, showElevation, onCenterChange });
  const lastPlaceRef = useRef(place);
  const reportedCenterRef = useRef<GeoPoint>(place);
  currentRef.current = { place, bearing, elevationGrid, showElevation, onCenterChange };

  function redrawBoard(
    nextPlace: GeoPoint,
    nextBearing: number,
    fit: boolean,
    nextElevationGrid = currentRef.current.elevationGrid,
    nextShowElevation = currentRef.current.showElevation,
  ) {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;

    const outline = boardCorners(nextPlace, nextBearing).map(({ lat, lon }) => [lat, lon] as [number, number]);
    outlineRef.current?.setLatLngs(outline);
    centerRef.current?.setLatLng([nextPlace.lat, nextPlace.lon]);

    gridRef.current?.clearLayers();
    for (let row = 0; row < BOARD_ROWS; row += 1) {
      for (let col = 0; col < BOARD_COLUMNS; col += 1) {
        const level = nextElevationGrid ? levelAtPoint(nextElevationGrid, hexCenterMeters(row, col)) : 0;
        const cell = hexPolygonMeters(row, col)
          .map((point) => boardToGeo(point, nextPlace, nextBearing))
          .map(({ lat, lon }) => [lat, lon] as [number, number]);
        L.polygon(cell, {
          color: "#e46f2d",
          weight: 0.65,
          opacity: 0.48,
          fill: nextShowElevation && Boolean(nextElevationGrid),
          fillColor: ["#808157", "#9b7446", "#76502f", "#533621"][level],
          fillOpacity: nextShowElevation && nextElevationGrid ? 0.08 + level * 0.1 : 0,
          interactive: false,
        }).addTo(gridRef.current!);
      }
    }

    if (fit && outlineRef.current) {
      map.fitBounds(outlineRef.current.getBounds(), { padding: [44, 44], animate: false });
    }
  }

  useEffect(() => {
    let disposed = false;
    void import("leaflet").then((L) => {
      if (disposed || !containerRef.current || mapRef.current) return;
      leafletRef.current = L;
      const current = currentRef.current;
      const map = L.map(containerRef.current, {
        zoomControl: true,
        scrollWheelZoom: "center",
        doubleClickZoom: "center",
        touchZoom: "center",
        attributionControl: true,
      });
      map.setView([current.place.lat, current.place.lon], 17);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 20,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);
      gridRef.current = L.layerGroup().addTo(map);
      outlineRef.current = L.polygon([], {
        color: "#e46f2d",
        weight: 3,
        opacity: 0.96,
        fillColor: "#e46f2d",
        fillOpacity: 0.06,
        interactive: false,
      }).addTo(map);
      centerRef.current = L.circleMarker([current.place.lat, current.place.lon], {
        radius: 4,
        color: "#171814",
        weight: 2,
        fillColor: "#e46f2d",
        fillOpacity: 1,
        interactive: false,
      }).addTo(map);
      mapRef.current = map;
      redrawBoard(current.place, current.bearing, true, current.elevationGrid, current.showElevation);

      const syncBoardToMapCenter = () => {
        const center = map.getCenter();
        redrawBoard({ lat: center.lat, lon: center.lng }, currentRef.current.bearing, false);
      };
      const commitMapCenter = () => {
        const center = map.getCenter();
        const nextCenter = { lat: center.lat, lon: center.lng };
        syncBoardToMapCenter();
        if (!centersMatch(nextCenter, reportedCenterRef.current)) {
          reportedCenterRef.current = nextCenter;
          currentRef.current.onCenterChange(nextCenter);
        }
      };
      map.on("move", syncBoardToMapCenter);
      map.on("moveend", commitMapCenter);
      window.setTimeout(() => map.invalidateSize(), 0);
    });

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      outlineRef.current = null;
      centerRef.current = null;
      gridRef.current = null;
      leafletRef.current = null;
    };
  }, []);

  useEffect(() => {
    const moved = lastPlaceRef.current.lat !== place.lat || lastPlaceRef.current.lon !== place.lon;
    const cameFromMap = centersMatch(place, reportedCenterRef.current);
    if (moved && !cameFromMap) reportedCenterRef.current = place;
    redrawBoard(place, bearing, moved && !cameFromMap, elevationGrid, showElevation);
    lastPlaceRef.current = place;
  }, [bearing, elevationGrid, place, showElevation]);

  return (
    <div className="geo-map-shell">
      <div ref={containerRef} className="geo-map" aria-label="Draggable OpenStreetMap with fixed tactical mapboard footprint" />
      <div className="map-navigation-hint" aria-hidden="true">
        <span>Drag to move board</span>
        <span>Wheel or ± to zoom</span>
      </div>
      <div className="map-scale-lock">
        <strong>{BOARD_COLUMNS} × {BOARD_ROWS} / 50 M HEX</strong>
        <span>{Math.round(BOARD_WIDTH_METERS)} × {Math.round(BOARD_HEIGHT_METERS)} M FIXED FOOTPRINT</span>
      </div>
    </div>
  );
}
