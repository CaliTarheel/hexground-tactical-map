"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  BOARD_ASPECT_RATIO,
  boardDimensions,
  boardHexAddress,
  boardSeamSegments,
  hexCenterMeters,
  hexPolygonMeters,
  type BoardPoint,
} from "./map-geometry";
import {
  elevationAtPoint,
  elevationGridPoint,
  elevationLevel,
  elevationThresholds,
  levelAtPoint,
  type ElevationGrid,
} from "./elevation-engine";
import type { Layer, ProjectedFeature } from "./terrain-engine";

type Props = {
  bearing: number;
  boardCols: number;
  boardRows: number;
  boardName: string;
  features: ProjectedFeature[];
  layers: Record<Layer, boolean>;
  elevationGrid: ElevationGrid | null;
  selectedHex: string;
  onSelectHex: (coordinate: string) => void;
};

const WIDTH_PER_BOARD = 1400;
const HEIGHT_PER_BOARD = Math.round(WIDTH_PER_BOARD / BOARD_ASPECT_RATIO);

function hash(value: number) {
  const result = Math.sin(value * 12.9898) * 43758.5453;
  return result - Math.floor(result);
}

function pointInPolygon(point: BoardPoint, polygon: BoardPoint[]) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index];
    const b = polygon[previous];
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export default function TacticalBoard({ bearing, boardCols, boardRows, boardName, features, layers, elevationGrid, selectedHex, onSelectHex }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dimensions = useMemo(() => boardDimensions(boardCols, boardRows), [boardCols, boardRows]);
  const width = WIDTH_PER_BOARD * dimensions.boardCols;
  const height = HEIGHT_PER_BOARD * dimensions.boardRows;

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const scaleX = canvas.width / dimensions.widthMeters;
    const scaleY = canvas.height / dimensions.heightMeters;
    const mapPoint = ({ x, y }: BoardPoint) => ({
      x: (x + dimensions.widthMeters / 2) * scaleX,
      y: (y + dimensions.heightMeters / 2) * scaleY,
    });
    const trace = (points: BoardPoint[], close = false) => {
      if (!points.length) return;
      const first = mapPoint(points[0]);
      context.beginPath();
      context.moveTo(first.x, first.y);
      points.slice(1).forEach((next) => {
        const mapped = mapPoint(next);
        context.lineTo(mapped.x, mapped.y);
      });
      if (close) context.closePath();
    };

    const ground = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    ground.addColorStop(0, "#7c8054");
    ground.addColorStop(0.48, "#6f7648");
    ground.addColorStop(1, "#59643e");
    context.fillStyle = ground;
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < 520; index += 1) {
      context.fillStyle = index % 3 === 0 ? "rgba(229,214,145,.08)" : "rgba(25,43,24,.07)";
      context.beginPath();
      context.arc(hash(index + 11) * canvas.width, hash(index + 37) * canvas.height, 1 + hash(index + 71) * 5, 0, Math.PI * 2);
      context.fill();
    }

    if (layers.elevation && elevationGrid) {
      const reliefWidth = 350 * dimensions.boardCols;
      const reliefHeight = Math.round((350 / BOARD_ASPECT_RATIO) * dimensions.boardRows);
      const relief = document.createElement("canvas");
      relief.width = reliefWidth;
      relief.height = reliefHeight;
      const reliefContext = relief.getContext("2d");
      if (reliefContext) {
        const image = reliefContext.createImageData(reliefWidth, reliefHeight);
        const colors = [
          [0, 0, 0, 0],
          [151, 111, 59, 48],
          [119, 77, 39, 78],
          [83, 52, 30, 105],
        ];
        for (let y = 0; y < reliefHeight; y += 1) {
          for (let x = 0; x < reliefWidth; x += 1) {
            const boardPoint = {
              x: (x / (reliefWidth - 1) - 0.5) * dimensions.widthMeters,
              y: (y / (reliefHeight - 1) - 0.5) * dimensions.heightMeters,
            };
            const level = elevationLevel(elevationGrid, elevationAtPoint(elevationGrid, boardPoint));
            const offset = (y * reliefWidth + x) * 4;
            image.data[offset] = colors[level][0];
            image.data[offset + 1] = colors[level][1];
            image.data[offset + 2] = colors[level][2];
            image.data[offset + 3] = colors[level][3];
          }
        }
        reliefContext.putImageData(image, 0, 0);
        context.imageSmoothingEnabled = true;
        context.drawImage(relief, 0, 0, canvas.width, canvas.height);
      }

      const interpolate = (a: BoardPoint, valueA: number, b: BoardPoint, valueB: number, threshold: number) => {
        const blend = valueA === valueB ? 0.5 : (threshold - valueA) / (valueB - valueA);
        return { x: a.x + (b.x - a.x) * blend, y: a.y + (b.y - a.y) * blend };
      };
      elevationThresholds(elevationGrid).forEach(({ level, elevation }) => {
        context.beginPath();
        for (let row = 0; row < elevationGrid.rows - 1; row += 1) {
          for (let column = 0; column < elevationGrid.columns - 1; column += 1) {
            const points = [
              elevationGridPoint(elevationGrid, row, column),
              elevationGridPoint(elevationGrid, row, column + 1),
              elevationGridPoint(elevationGrid, row + 1, column + 1),
              elevationGridPoint(elevationGrid, row + 1, column),
            ];
            const values = [
              elevationGrid.values[row * elevationGrid.columns + column],
              elevationGrid.values[row * elevationGrid.columns + column + 1],
              elevationGrid.values[(row + 1) * elevationGrid.columns + column + 1],
              elevationGrid.values[(row + 1) * elevationGrid.columns + column],
            ];
            const intersections: BoardPoint[] = [];
            for (let edge = 0; edge < 4; edge += 1) {
              const next = (edge + 1) % 4;
              if ((values[edge] < elevation && values[next] >= elevation) || (values[next] < elevation && values[edge] >= elevation)) {
                intersections.push(interpolate(points[edge], values[edge], points[next], values[next], elevation));
              }
            }
            for (let index = 0; index + 1 < intersections.length; index += 2) {
              const start = mapPoint(intersections[index]);
              const end = mapPoint(intersections[index + 1]);
              context.moveTo(start.x, start.y);
              context.lineTo(end.x, end.y);
            }
          }
        }
        context.strokeStyle = level === 1 ? "rgba(65,43,27,.72)" : "rgba(48,31,20,.88)";
        context.lineWidth = Math.max(2, (0.7 + level * 0.2) * scaleX);
        context.setLineDash(level === 3 ? [8, 5] : []);
        context.stroke();
        context.setLineDash([]);
      });
    }

    const polygons = features.filter((feature) => feature.points.length > 2);
    polygons
      .filter((feature) => (feature.kind === "woods" && layers.trees) || feature.kind === "garden")
      .forEach((feature) => {
        trace(feature.points, true);
        context.fillStyle = feature.kind === "woods" ? "#31482c" : "#596b3c";
        context.fill();
        context.lineWidth = 1.2 * scaleX;
        context.strokeStyle = "rgba(20,31,18,.7)";
        context.stroke();
      });

    if (layers.roads) {
      features.filter((feature) => feature.kind === "road" || feature.kind === "path").forEach((feature) => {
        const highway = feature.tags.highway ?? "";
        const routeWidth = feature.kind === "path" ? 2.2
          : ["primary", "secondary", "tertiary"].includes(highway) ? 12
            : ["residential", "living_street"].includes(highway) ? 9 : 6.5;
        context.lineCap = "round";
        context.lineJoin = "round";
        trace(feature.points);
        context.strokeStyle = feature.kind === "path" ? "rgba(49,42,29,.75)" : "rgba(43,42,35,.88)";
        context.lineWidth = (routeWidth + (feature.kind === "path" ? 1.6 : 3)) * scaleX;
        context.stroke();
        trace(feature.points);
        context.strokeStyle = feature.kind === "path" ? "#b49a6d" : "#a79c7f";
        context.lineWidth = routeWidth * scaleX;
        context.stroke();
      });
    }

    if (layers.buildings) {
      polygons.filter((feature) => feature.kind === "building").forEach((feature) => {
        context.save();
        context.translate(4, 5);
        trace(feature.points, true);
        context.fillStyle = "rgba(25,24,21,.35)";
        context.fill();
        context.restore();
        trace(feature.points, true);
        const tone = 82 + Math.round(hash(feature.id) * 35);
        context.fillStyle = `rgb(${tone + 12}, ${tone + 10}, ${tone + 4})`;
        context.fill();
        context.lineWidth = 2.2 * scaleX;
        context.strokeStyle = "#262721";
        context.stroke();
        trace(feature.points, true);
        context.lineWidth = 0.7 * scaleX;
        context.strokeStyle = "rgba(231,222,194,.42)";
        context.stroke();
      });
    }

    if (layers.trees) {
      features.filter((feature) => feature.kind === "tree").forEach((feature) => {
        const center = mapPoint(feature.points[0]);
        const radius = (4.2 + hash(feature.id) * 2.8) * scaleX;
        context.fillStyle = "rgba(13,24,13,.25)";
        context.beginPath();
        context.arc(center.x + 3, center.y + 5, radius, 0, Math.PI * 2);
        context.fill();
        const canopy = context.createRadialGradient(center.x - radius * .25, center.y - radius * .25, 1, center.x, center.y, radius);
        canopy.addColorStop(0, "#60733d");
        canopy.addColorStop(.55, "#36512d");
        canopy.addColorStop(1, "#1d3320");
        context.fillStyle = canopy;
        context.beginPath();
        context.arc(center.x, center.y, radius, 0, Math.PI * 2);
        context.fill();
      });
    }

    const edges = new Map<string, [BoardPoint, BoardPoint]>();
    const edgeKey = (a: BoardPoint, b: BoardPoint) => {
      const first = `${a.x.toFixed(4)},${a.y.toFixed(4)}`;
      const second = `${b.x.toFixed(4)},${b.y.toFixed(4)}`;
      return first < second ? `${first}|${second}` : `${second}|${first}`;
    };
    for (let row = 0; row < dimensions.rows; row += 1) {
      for (let col = 0; col < dimensions.columns; col += 1) {
        const polygon = hexPolygonMeters(row, col, dimensions.boardCols, dimensions.boardRows);
        polygon.forEach((a, index) => {
          const b = polygon[(index + 1) % polygon.length];
          edges.set(edgeKey(a, b), [a, b]);
        });
      }
    }
    context.beginPath();
    edges.forEach(([a, b]) => {
      const start = mapPoint(a);
      const end = mapPoint(b);
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
    });
    context.lineWidth = Math.max(1.5, .75 * scaleX);
    context.strokeStyle = "rgba(13,15,11,.82)";
    context.lineCap = "butt";
    context.lineJoin = "miter";
    context.stroke();

    context.textAlign = "center";
    context.textBaseline = "middle";
    for (let row = 0; row < dimensions.rows; row += 1) {
      for (let col = 0; col < dimensions.columns; col += 1) {
        const center = mapPoint(hexCenterMeters(row, col, dimensions.boardCols, dimensions.boardRows));
        context.fillStyle = "rgba(8,10,7,.9)";
        context.beginPath();
        context.arc(center.x, center.y, Math.max(3.2, 1.35 * scaleX), 0, Math.PI * 2);
        context.fill();
        context.font = `700 ${Math.max(9, 3.6 * scaleX)}px ui-monospace, monospace`;
        context.fillStyle = "rgba(16,18,13,.72)";
        context.fillText(boardHexAddress(row, col, dimensions.boardCols, dimensions.boardRows), center.x, center.y - 13 * scaleY);
        if (layers.elevation && elevationGrid) {
          const level = levelAtPoint(elevationGrid, hexCenterMeters(row, col, dimensions.boardCols, dimensions.boardRows));
          if (level > 0) {
            context.font = `900 ${Math.max(8, 3.2 * scaleX)}px ui-monospace, monospace`;
            context.fillStyle = "rgba(241,226,191,.82)";
            context.fillText(`L${level}`, center.x, center.y + 13 * scaleY);
          }
        }
      }
    }

    if (layers.elevation && elevationGrid) {
      const label = `TOPO ${Math.round(elevationGrid.minimum)}–${Math.round(elevationGrid.maximum)} M / ${elevationGrid.interval} M LEVELS / ${elevationGrid.resolutionMeters.toFixed(0)} M DEM`;
      context.font = `800 ${Math.max(10, 4.2 * scaleX)}px ui-monospace, monospace`;
      context.textAlign = "left";
      const width = context.measureText(label).width;
      context.fillStyle = "rgba(12,14,10,.72)";
      context.fillRect(16, 15, width + 20, 28);
      context.fillStyle = "rgba(240,233,211,.9)";
      context.fillText(label, 26, 30);
    }

    if (dimensions.boardCount > 1) {
      context.save();
      context.strokeStyle = "rgba(244,235,211,.78)";
      context.lineWidth = Math.max(3, 1.35 * scaleX);
      context.setLineDash([20 * scaleX, 13 * scaleX]);
      context.beginPath();
      for (const [a, b] of boardSeamSegments(dimensions.boardCols, dimensions.boardRows)) {
        const start = mapPoint(a);
        const end = mapPoint(b);
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
      }
      context.stroke();
      context.setLineDash([]);
      context.textAlign = "left";
      context.textBaseline = "bottom";
      context.font = `900 ${Math.max(13, 5.1 * scaleX)}px ui-monospace, monospace`;
      for (let boardRow = 0; boardRow < dimensions.boardRows; boardRow += 1) {
        for (let boardCol = 0; boardCol < dimensions.boardCols; boardCol += 1) {
          const label = `${boardName.toUpperCase().slice(0, 18)} ${boardRow + 1}-${boardCol + 1}`;
          const x = boardCol * WIDTH_PER_BOARD + 24;
          const y = (boardRow + 1) * HEIGHT_PER_BOARD - 22;
          const labelWidth = context.measureText(label).width;
          context.fillStyle = "rgba(12,14,10,.72)";
          context.fillRect(x - 8, y - 31, labelWidth + 16, 35);
          context.fillStyle = "rgba(240,233,211,.92)";
          context.fillText(label, x, y);
        }
      }
      context.restore();
    }

    for (let row = 0; row < dimensions.rows; row += 1) {
      for (let col = 0; col < dimensions.columns; col += 1) {
        if (boardHexAddress(row, col, dimensions.boardCols, dimensions.boardRows) !== selectedHex) continue;
        trace(hexPolygonMeters(row, col, dimensions.boardCols, dimensions.boardRows), true);
        context.lineWidth = Math.max(3, 1.4 * scaleX);
        context.strokeStyle = "#e46f2d";
        context.stroke();
      }
    }
  }, [boardName, dimensions, elevationGrid, features, layers, selectedHex]);

  function selectFromPointer(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const candidate = {
      x: ((event.clientX - rect.left) / rect.width) * dimensions.widthMeters - dimensions.widthMeters / 2,
      y: ((event.clientY - rect.top) / rect.height) * dimensions.heightMeters - dimensions.heightMeters / 2,
    };
    for (let row = 0; row < dimensions.rows; row += 1) {
      for (let col = 0; col < dimensions.columns; col += 1) {
        if (pointInPolygon(candidate, hexPolygonMeters(row, col, dimensions.boardCols, dimensions.boardRows))) {
          onSelectHex(boardHexAddress(row, col, dimensions.boardCols, dimensions.boardRows));
          return;
        }
      }
    }
  }

  return (
    <div className="continuous-board" style={{ "--board-aspect": dimensions.aspectRatio } as React.CSSProperties}>
      <canvas id="tactical-board-canvas" ref={canvasRef} width={width} height={height} onPointerDown={selectFromPointer} role="grid" aria-label={`${dimensions.boardCols} by ${dimensions.boardRows} continuous tactical board mosaic with a tessellated hex grid`} />
      <span className="north-mark">
        <i style={{ "--north-rotation": `${-bearing}deg` } as React.CSSProperties} aria-hidden="true">↑</i>
        <span>N / {String(bearing).padStart(3, "0")}° BRG</span>
      </span>
    </div>
  );
}
