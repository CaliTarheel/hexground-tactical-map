"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import GeoMap from "./GeoMap";
import TacticalBoard from "./TacticalBoard";
import {
  createElevationGrid,
  elevationAtPoint,
  elevationSampleLocations,
  levelAtPoint,
  type ElevationGrid,
} from "./elevation-engine";
import {
  BOARD_COLUMNS,
  BOARD_ROWS,
  boardDimensions,
  boardHexAddress,
  hexCenterMeters,
  hexPolygonMeters,
} from "./map-geometry";
import {
  projectOsmFeatures,
  terrainFromFeatures,
  type Layer,
  type OsmElement,
  type Terrain,
} from "./terrain-engine";
import { loadTerrariumElevations } from "./terrain-tiles";

type Place = {
  label: string;
  address: string;
  lat: number;
  lon: number;
  elevation: number;
};


const DEFAULT_PLACE: Place = {
  label: "Hamilton Hall",
  address: "102 Emerson Drive, Chapel Hill, NC 27514",
  lat: 35.91163,
  lon: -79.04876,
  elevation: 146,
};

const TERRAIN_LABELS: Record<Terrain, string> = {
  lawn: "Open ground",
  woods: "Woods",
  building: "Building",
  road: "Paved road",
  path: "Footpath",
  hill: "Hill hex",
  garden: "Garden",
};

const LAYER_LABELS: Record<Layer, string> = {
  buildings: "Buildings",
  roads: "Roads + paths",
  trees: "Tree canopy",
  elevation: "Relief",
};

function normalizeBearing(value: number) {
  return ((Math.round(value) % 360) + 360) % 360;
}

function formatBearing(value: number) {
  return normalizeBearing(value).toString().padStart(3, "0");
}

export default function Home() {
  const [query, setQuery] = useState("Hamilton Hall, UNC Chapel Hill");
  const [place, setPlace] = useState<Place>(DEFAULT_PLACE);
  const [density, setDensity] = useState(2);
  const scale = 50;
  const [bearing, setBearing] = useState(0);
  const [boardCols, setBoardCols] = useState(1);
  const [boardRows, setBoardRows] = useState(1);
  const [layers, setLayers] = useState<Record<Layer, boolean>>({
    buildings: true,
    roads: true,
    trees: true,
    elevation: true,
  });
  const [selectedHex, setSelectedHex] = useState("G4");
  const [status, setStatus] = useState("Hamilton Hall source area ready");
  const [searching, setSearching] = useState(false);
  const [osmElements, setOsmElements] = useState<OsmElement[]>([]);
  const [sourceState, setSourceState] = useState<"loading" | "ready" | "error">("loading");
  const [elevationGrid, setElevationGrid] = useState<ElevationGrid | null>(null);
  const [elevationState, setElevationState] = useState<"loading" | "ready" | "error">("loading");
  const [refreshKey, setRefreshKey] = useState(0);
  const dimensions = useMemo(() => boardDimensions(boardCols, boardRows), [boardCols, boardRows]);

  useEffect(() => {
    const controller = new AbortController();
    setSourceState("loading");
    setStatus(`Reading OpenStreetMap geometry around ${place.label}…`);
    const queryRadius = Math.ceil(Math.hypot(dimensions.widthMeters, dimensions.heightMeters) / 2 + 120);
    const query = `[out:json][timeout:25];(
      way["building"](around:${queryRadius},${place.lat},${place.lon});
      way["highway"](around:${queryRadius},${place.lat},${place.lon});
      way["natural"="wood"](around:${queryRadius},${place.lat},${place.lon});
      way["landuse"~"forest|grass|meadow|recreation_ground"](around:${queryRadius},${place.lat},${place.lon});
      way["leisure"~"garden|park"](around:${queryRadius},${place.lat},${place.lon});
      node["natural"="tree"](around:${queryRadius},${place.lat},${place.lon});
    );out geom;`;
    const isDefaultPlace = Math.abs(place.lat - DEFAULT_PLACE.lat) < 0.00001 && Math.abs(place.lon - DEFAULT_PLACE.lon) < 0.00001;
    const sources = [
      ...(isDefaultPlace && dimensions.boardCount === 1 ? ["/data/hamilton-hall-osm.json"] : []),
      `/api/osm?lat=${place.lat}&lon=${place.lon}&radius=${queryRadius}`,
      `https://overpass.kumi.systems/api/interpreter?data=${encodeURIComponent(query)}`,
      `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`,
    ];
    const loadSource = async () => {
      for (const source of sources) {
        try {
          const response = await fetch(source, {
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
          });
          if (response.ok) return response.json() as Promise<{ elements?: OsmElement[] }>;
        } catch (error: unknown) {
          if (error instanceof DOMException && error.name === "AbortError") throw error;
        }
      }
      throw new Error("OSM geometry request failed");
    };
    void loadSource()
      .then(async (response) => {
        return response;
      })
      .then((payload) => {
        const elements = payload.elements ?? [];
        setOsmElements(elements);
        setSourceState("ready");
        setStatus(`${elements.length.toLocaleString()} OpenStreetMap features aligned to the ${dimensions.boardCols} × ${dimensions.boardRows} board mosaic`);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setOsmElements([]);
        setSourceState("error");
        setStatus("OpenStreetMap geometry is temporarily unavailable — no terrain was invented");
      });
    return () => controller.abort();
  }, [dimensions, place.label, place.lat, place.lon, refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    setElevationState("loading");
    const timer = window.setTimeout(() => {
      const samples = elevationSampleLocations(place, bearing, boardCols, boardRows);
      const coordinates = samples.map(({ geoPoint }) => geoPoint);
      const loadElevation = async () => {
        try {
          const response = await fetch("/api/elevation", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ coordinates }),
            signal: controller.signal,
          });
          if (!response.ok) throw new Error("Hosted elevation request failed");
          return await response.json() as {
            elevations?: number[];
            source?: ElevationGrid["source"];
            resolutionMeters?: number;
          };
        } catch (error: unknown) {
          if (error instanceof DOMException && error.name === "AbortError") throw error;
          return loadTerrariumElevations(coordinates, controller.signal);
        }
      };
      void loadElevation()
        .then(({ elevations = [], source, resolutionMeters }) => {
          const grid = createElevationGrid(elevations, source, resolutionMeters, boardCols, boardRows);
          if (!grid) throw new Error("Incomplete elevation surface");
          setElevationGrid(grid);
          setElevationState("ready");
          setStatus(`Relief resolved from ${Math.round(grid.minimum)} to ${Math.round(grid.maximum)} metres`);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setElevationGrid(null);
          setElevationState("error");
          setStatus("Elevation data is temporarily unavailable — relief has been withheld");
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [bearing, boardCols, boardRows, place.lat, place.lon, refreshKey]);

  const projectedFeatures = useMemo(() => {
    return projectOsmFeatures(osmElements, place, bearing);
  }, [bearing, osmElements, place]);

  const hexes = useMemo(() => {
    return Array.from({ length: dimensions.rows }, (_, row) =>
      Array.from({ length: dimensions.columns }, (_, col) => {
        const coordinate = boardHexAddress(row, col, boardCols, boardRows);
        const interpreted = terrainFromFeatures(
          hexCenterMeters(row, col, boardCols, boardRows),
          hexPolygonMeters(row, col, boardCols, boardRows),
          projectedFeatures,
          density,
          layers,
        );
        const terrain = interpreted.terrain;
        const center = hexCenterMeters(row, col, boardCols, boardRows);
        const elevation = elevationGrid ? elevationAtPoint(elevationGrid, center) : null;
        const level = elevationGrid ? levelAtPoint(elevationGrid, center) : 0;
        return { row, col, coordinate, terrain, routeAngle: interpreted.routeAngle, elevation, level };
      }),
    ).flat();
  }, [boardCols, boardRows, density, dimensions, elevationGrid, layers, projectedFeatures]);

  useEffect(() => {
    setSelectedHex(boardHexAddress(3, 6, boardCols, boardRows));
  }, [boardCols, boardRows]);

  const terrainCounts = useMemo(() => {
    const counts = hexes.reduce<Record<Terrain, number>>(
      (counts, hex) => ({ ...counts, [hex.terrain]: counts[hex.terrain] + 1 }),
      { lawn: 0, woods: 0, building: 0, road: 0, path: 0, hill: 0, garden: 0 },
    );
    counts.hill = hexes.filter((hex) => hex.level > 0).length;
    return counts;
  }, [hexes]);

  const selected = hexes.find((hex) => hex.coordinate === selectedHex) ?? hexes[0];
  const centerElevation = elevationGrid ? elevationAtPoint(elevationGrid, { x: 0, y: 0 }) : null;

  async function locate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    setSearching(true);
    setStatus("Locating source area…");
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(trimmed)}`,
        { headers: { "Accept-Language": "en" } },
      );
      if (!response.ok) throw new Error("Location lookup failed");
      const result = (await response.json()) as Array<{
        lat: string;
        lon: string;
        display_name: string;
        name?: string;
      }>;
      if (!result[0]) throw new Error("No matching place found");

      const nextPlace: Place = {
        label: result[0].name || trimmed.split(",")[0],
        address: result[0].display_name,
        lat: Number(result[0].lat),
        lon: Number(result[0].lon),
        elevation: DEFAULT_PLACE.elevation,
      };
      setPlace(nextPlace);
      setStatus(`${nextPlace.label} located — reading mapped features`);
    } catch {
      setStatus("Live lookup unavailable — keeping the current source area");
    } finally {
      setSearching(false);
    }
  }

  function toggleLayer(layer: Layer) {
    setLayers((current) => ({ ...current, [layer]: !current[layer] }));
    setStatus(`${LAYER_LABELS[layer]} layer updated`);
  }

  function reinterpret() {
    setRefreshKey((current) => current + 1);
    setStatus("Refreshing OpenStreetMap geometry…");
  }

  function rotateBoard(nextBearing: number) {
    const normalized = normalizeBearing(nextBearing);
    setBearing(normalized);
    setStatus(`Mapboard bearing set to ${formatBearing(normalized)} degrees`);
  }

  function moveBoardCenter(center: { lat: number; lon: number }) {
    setPlace((current) => ({
      ...current,
      lat: center.lat,
      lon: center.lon,
      address: `Board center ${center.lat.toFixed(5)}, ${center.lon.toFixed(5)}`,
    }));
    setStatus(`Board center moved to ${center.lat.toFixed(5)}, ${center.lon.toFixed(5)}`);
  }

  function updateBoardLayout(axis: "cols" | "rows", value: number) {
    if (axis === "cols") setBoardCols(value);
    else setBoardRows(value);
    setStatus("Board layout updated — refreshing the enlarged footprint");
  }

  function downloadSpec() {
    const payload = {
      schema: "hexground-board-spec/v2",
      source: place,
      board: {
        boardsWide: dimensions.boardCols,
        boardsHigh: dimensions.boardRows,
        boardCount: dimensions.boardCount,
        columnsPerBoard: BOARD_COLUMNS,
        rowsPerBoard: BOARD_ROWS,
        columns: dimensions.columns,
        rows: dimensions.rows,
        metersPerHex: scale,
        bearingDegrees: bearing,
        footprintMeters: { width: dimensions.widthMeters, height: dimensions.heightMeters },
      },
      interpretation: {
        geometrySource: "OpenStreetMap",
        featureCount: osmElements.length,
        elevationSource: elevationGrid?.source ?? null,
        elevationResolutionMeters: elevationGrid?.resolutionMeters ?? null,
        elevationRangeMeters: elevationGrid ? { minimum: elevationGrid.minimum, maximum: elevationGrid.maximum } : null,
        elevationLevelIntervalMeters: elevationGrid?.interval ?? null,
      },
      layers,
      hexes: hexes.map(({ coordinate, terrain, routeAngle, elevation, level }) => ({
        coordinate,
        terrain,
        elevationMeters: elevation === null ? null : Number(elevation.toFixed(1)),
        elevationLevel: level,
        routeAngleDegrees: routeAngle,
      })),
    };
    const file = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${place.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${dimensions.boardCols}x${dimensions.boardRows}-boards.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus("Board specification downloaded");
  }

  function downloadPng() {
    const source = document.getElementById("tactical-board-canvas") as HTMLCanvasElement | null;
    if (!source) {
      setStatus("The board image is not ready yet");
      return;
    }

    const output = document.createElement("canvas");
    output.width = source.width;
    output.height = source.height;
    const context = output.getContext("2d");
    if (!context) return;
    context.drawImage(source, 0, 0);

    const margin = 28;
    context.fillStyle = "rgba(12, 14, 10, .78)";
    context.fillRect(margin - 10, output.height - 72, 190, 48);
    context.fillStyle = "rgba(240, 233, 211, .94)";
    context.font = "900 31px ui-monospace, monospace";
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText(`${dimensions.boardCols}×${dimensions.boardRows} MOSAIC`, margin, output.height - 48);

    const northX = output.width - 156;
    const northY = 54;
    context.fillStyle = "rgba(12, 14, 10, .78)";
    context.fillRect(northX - 32, 20, 168, 68);
    context.save();
    context.translate(northX, northY);
    context.rotate((-bearing * Math.PI) / 180);
    context.strokeStyle = "#e46f2d";
    context.fillStyle = "#e46f2d";
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(0, 18);
    context.lineTo(0, -18);
    context.stroke();
    context.beginPath();
    context.moveTo(0, -24);
    context.lineTo(-8, -10);
    context.lineTo(8, -10);
    context.closePath();
    context.fill();
    context.restore();
    context.fillStyle = "rgba(240, 233, 211, .92)";
    context.font = "700 15px ui-monospace, monospace";
    context.textAlign = "left";
    context.fillText(`N / ${formatBearing(bearing)}° BRG`, northX + 22, northY);

    output.toBlob((blob) => {
      if (!blob) {
        setStatus("PNG export could not be created");
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${place.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${dimensions.boardCols}x${dimensions.boardRows}-boards.png`;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus(`High-resolution PNG exported at ${output.width} × ${output.height} px`);
    }, "image/png");
  }

  return (
    <main className="site-shell">
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label="Hexground home">
          <span className="wordmark-mark" aria-hidden="true">H</span>
          <span>HEXGROUND</span>
        </a>
        <div className="system-strip" aria-label="Current board specification">
          <span>PROTO—01</span>
          <span>{scale} M / HEX</span>
          <span>{formatBearing(bearing)}° BRG</span>
          <span>{dimensions.boardCols} × {dimensions.boardRows} BOARDS</span>
        </div>
        <button className="quiet-button" onClick={downloadSpec}>Download spec</button>
      </header>

      <section className="intro" id="top">
        <p className="eyebrow">REAL TERRAIN → PLAYABLE TACTICS</p>
        <h1>Build a battlefield<br />from somewhere real.</h1>
        <p className="intro-copy">
          Locate a place. Read its buildings, roads, woods and relief. Resolve it into a board that follows the
          Lock ’n Load Tactical language: approximately 50 meters per hex on one board or a seamless multi-board mosaic.
        </p>
        <ol className="steps" aria-label="Map creation steps">
          <li className="is-active"><span>01</span> Locate</li>
          <li><span>02</span> Interpret</li>
          <li><span>03</span> Resolve</li>
        </ol>
      </section>

      <section className="workspace" aria-label="Hexground map workspace">
        <aside className="source-panel">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">01 / SOURCE AREA</p>
              <h2>{place.label}</h2>
            </div>
            <span className={`live-pill is-${sourceState}`}>
              <i /> {sourceState === "loading" ? "READING OSM" : sourceState === "ready" ? `${projectedFeatures.length} MAPPED` : "SOURCE ERROR"}
            </span>
          </div>

          <form className="location-form" onSubmit={locate}>
            <label htmlFor="location">Real-world location</label>
            <div className="search-row">
              <input
                id="location"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search an address or landmark"
              />
              <button type="submit" disabled={searching}>{searching ? "Locating" : "Locate"}</button>
            </div>
          </form>

          <GeoMap
            place={place}
            bearing={bearing}
            boardCols={boardCols}
            boardRows={boardRows}
            elevationGrid={elevationGrid}
            showElevation={layers.elevation}
            onCenterChange={moveBoardCenter}
          />

          <p className="address">{place.address}</p>
          <div className={`relief-readout is-${elevationState}`}>
            <span>{elevationGrid?.source ?? "Terrain elevation surface"}</span>
            <strong>
              {elevationState === "loading" ? "Sampling elevation…" : elevationState === "error" || !elevationGrid
                ? "Relief unavailable"
                : `${Math.round(elevationGrid.minimum)}–${Math.round(elevationGrid.maximum)} m · ${elevationGrid.interval} m levels · ${elevationGrid.resolutionMeters.toFixed(1)} m source`}
            </strong>
          </div>

          <div className="controls-grid">
            <fieldset>
              <legend>Interpretation layers</legend>
              <div className="layer-list">
                {(Object.keys(LAYER_LABELS) as Layer[]).map((layer) => (
                  <button
                    key={layer}
                    type="button"
                    className={layers[layer] ? "layer-toggle is-on" : "layer-toggle"}
                    onClick={() => toggleLayer(layer)}
                    aria-pressed={layers[layer]}
                  >
                    <span>{LAYER_LABELS[layer]}</span>
                    <i aria-hidden="true" />
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend>Board geometry</legend>
              <div className="fixed-scale" aria-label="Ground scale locked to the Lock 'n Load Tactical standard">
                <span>Ground scale</span>
                <strong>50 m / hex</strong>
                <small>Locked system scale</small>
              </div>
              <div className="board-layout-control" aria-label="Board mosaic layout">
                <span>Board layout</span>
                <div>
                  <label>
                    <small>Wide</small>
                    <select aria-label="Boards wide" value={boardCols} onChange={(event) => updateBoardLayout("cols", Number(event.target.value))}>
                      {[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                  </label>
                  <b aria-hidden="true">×</b>
                  <label>
                    <small>High</small>
                    <select aria-label="Boards high" value={boardRows} onChange={(event) => updateBoardLayout("rows", Number(event.target.value))}>
                      {[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                  </label>
                </div>
                <strong>{dimensions.boardCount} {dimensions.boardCount === 1 ? "board" : "boards"} · {dimensions.columns} × {dimensions.rows} hexes</strong>
                <small>{Math.round(dimensions.widthMeters)} × {Math.round(dimensions.heightMeters)} m footprint</small>
              </div>
              <label className="range-label" htmlFor="density">
                <span>Canopy simplification <b>0{density}</b></span>
                <input
                  id="density"
                  type="range"
                  min="1"
                  max="4"
                  value={density}
                  onChange={(event) => setDensity(Number(event.target.value))}
                />
              </label>
              <div className="bearing-control">
                <label htmlFor="bearing">
                  <span>Mapboard bearing</span>
                  <b>{formatBearing(bearing)}°</b>
                </label>
                <div className="bearing-row">
                  <button type="button" onClick={() => rotateBoard(bearing - 15)} aria-label="Rotate mapboard 15 degrees counterclockwise">−15°</button>
                  <input
                    id="bearing"
                    type="range"
                    min="0"
                    max="359"
                    step="1"
                    value={bearing}
                    onChange={(event) => rotateBoard(Number(event.target.value))}
                    aria-valuetext={`${formatBearing(bearing)} degrees`}
                  />
                  <button type="button" onClick={() => rotateBoard(bearing + 15)} aria-label="Rotate mapboard 15 degrees clockwise">+15°</button>
                </div>
                <div className="bearing-presets" aria-label="Cardinal bearing presets">
                  {([0, 90, 180, 270] as const).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={bearing === preset ? "is-active" : ""}
                      onClick={() => rotateBoard(preset)}
                    >
                      {preset === 0 ? "N" : preset === 90 ? "E" : preset === 180 ? "S" : "W"} {formatBearing(preset)}°
                    </button>
                  ))}
                </div>
              </div>
            </fieldset>
          </div>

          <button className="primary-button" type="button" onClick={reinterpret}>
            <span>Refresh mapped features</span>
            <span aria-hidden="true">→</span>
          </button>
        </aside>

        <section className="board-panel">
          <div className="panel-heading board-heading">
            <div>
              <p className="panel-kicker">02 / TACTICAL RESOLUTION</p>
              <h2>{place.label} / {dimensions.boardCols} × {dimensions.boardRows} mosaic</h2>
            </div>
            <div className="board-actions">
              <button type="button" onClick={() => rotateBoard(bearing + 15)}>Rotate +15°</button>
              <button type="button" onClick={reinterpret}>Re-interpret</button>
              <button type="button" onClick={downloadSpec}>Export JSON</button>
              <button type="button" className="accent-action" onClick={downloadPng}>Export PNG</button>
            </div>
          </div>

          <div className="board-wrap">
            <TacticalBoard
              bearing={bearing}
              boardCols={boardCols}
              boardRows={boardRows}
              boardName={place.label}
              features={projectedFeatures}
              layers={layers}
              elevationGrid={elevationGrid}
              selectedHex={selectedHex}
              onSelectHex={setSelectedHex}
            />
          </div>

          <div className="board-footer">
            <div className="legend" aria-label="Terrain legend">
              {(["lawn", "woods", "building", "road", "path", "hill", "garden"] as Terrain[]).map((terrain) => (
                <span key={terrain}><i data-swatch={terrain} />{TERRAIN_LABELS[terrain]} <b>{terrainCounts[terrain]}</b></span>
              ))}
            </div>
            <div className="hex-inspector" aria-live="polite">
              <p>SELECTED HEX</p>
              <strong>{selected.coordinate}</strong>
              <span>{TERRAIN_LABELS[selected.terrain]}</span>
              <div className="game-elevation-readout">
                <small>GAMEBOARD ELEVATION</small>
                <b>
                  {selected.elevation === null
                    ? elevationState === "loading" ? "LOADING…" : "UNAVAILABLE"
                    : `LEVEL ${selected.level}`}
                </b>
                <em>
                  {selected.elevation === null
                    ? "No elevation has been assigned"
                    : `${selected.level * (elevationGrid?.interval ?? 4)} m above board datum`}
                </em>
              </div>
              <small className="real-elevation">
                {selected.elevation === null ? "Real-world elevation pending" : `${selected.elevation.toFixed(1)} m real-world elevation`}
              </small>
            </div>
          </div>
        </section>
      </section>

      <section className="method">
        <div>
          <p className="panel-kicker">METHOD / 03</p>
          <h2>Recognition first.<br />Simulation second.</h2>
        </div>
        <p>
          The source geometry remains continuous beneath the game grid: roads cross shared edges, buildings retain
          their footprints, and vegetation follows mapped boundaries. The hex lattice measures play without breaking
          the terrain into disconnected tiles.
        </p>
        <dl>
          <div><dt>{dimensions.columns * dimensions.rows}</dt><dd>Playable hexes across {dimensions.boardCount} {dimensions.boardCount === 1 ? "board" : "boards"}</dd></div>
          <div><dt>{scale} M</dt><dd>Nominal hex width</dd></div>
          <div><dt>{centerElevation === null ? "—" : `${Math.round(centerElevation)} M`}</dt><dd>Board-center elevation</dd></div>
        </dl>
      </section>

      <footer>
        <span>HEXGROUND / CARTOGRAPHIC PROTOTYPE</span>
        <span>{status}</span>
        <span>OSM © CONTRIBUTORS · USGS 3DEP/NED · MAPZEN/AWS TERRAIN TILES · COPERNICUS DEM
          <span className="creatorCredit">Created by <strong>Stephen G. Rider</strong> · <a href="mailto:rider.sg@gmail.com">rider.sg@gmail.com</a> · <a href="https://github.com/CaliTarheel/hexground-tactical-map" target="_blank" rel="noreferrer">source on GitHub</a> · MIT licensed—retain attribution.</span>
        </span>
      </footer>
    </main>
  );
}
