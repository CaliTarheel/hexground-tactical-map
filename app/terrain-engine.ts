import { geoToBoard, type BoardPoint, type GeoPoint } from "./map-geometry.ts";

export type Terrain = "lawn" | "woods" | "building" | "road" | "path" | "hill" | "garden";
export type Layer = "buildings" | "roads" | "trees" | "elevation";
export type OsmPoint = { lat: number; lon: number };
export type OsmElement = {
  id: number;
  type: "node" | "way";
  lat?: number;
  lon?: number;
  geometry?: OsmPoint[];
  tags?: Record<string, string>;
};

type FeatureKind = "building" | "road" | "path" | "woods" | "garden" | "tree";
export type ProjectedFeature = {
  id: number;
  kind: FeatureKind;
  points: BoardPoint[];
  tags: Record<string, string>;
};

function featureKind(tags: Record<string, string>): FeatureKind | null {
  if (tags.building) return "building";
  if (tags.highway) {
    if (["footway", "path", "steps", "bridleway", "cycleway", "pedestrian"].includes(tags.highway)) {
      if (tags.indoor === "yes" || tags.footway === "crossing" || tags.footway === "sidewalk") return null;
      return "path";
    }
    if (["motorway", "trunk", "primary", "secondary", "tertiary", "residential", "living_street", "unclassified", "service", "track"].includes(tags.highway)) {
      if (tags.service === "parking_aisle" || tags.service === "driveway") return null;
      return "road";
    }
    return null;
  }
  if (tags.natural === "wood" || tags.landuse === "forest") return "woods";
  if (tags.leisure === "garden") return "garden";
  if (tags.natural === "tree") return "tree";
  return null;
}

export function projectOsmFeatures(elements: OsmElement[], center: GeoPoint, bearing: number) {
  return elements.flatMap<ProjectedFeature>((element) => {
    const tags = element.tags ?? {};
    const kind = featureKind(tags);
    if (!kind) return [];
    const geometry = element.geometry ?? (
      typeof element.lat === "number" && typeof element.lon === "number"
        ? [{ lat: element.lat, lon: element.lon }]
        : []
    );
    if (geometry.length === 0 || (kind !== "tree" && geometry.length < 2)) return [];
    return [{
      id: element.id,
      kind,
      points: geometry.map((point) => geoToBoard(point, center, bearing)),
      tags,
    }];
  });
}

function pointInPolygon(point: BoardPoint, polygon: BoardPoint[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses = a.y > point.y !== b.y > point.y;
    if (crosses && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function polygonCenter(polygon: BoardPoint[]) {
  const points = polygon.length > 1 && polygon[0].x === polygon[polygon.length - 1].x && polygon[0].y === polygon[polygon.length - 1].y
    ? polygon.slice(0, -1)
    : polygon;
  return points.reduce(
    (center, point) => ({ x: center.x + point.x / points.length, y: center.y + point.y / points.length }),
    { x: 0, y: 0 },
  );
}

function polygonArea(polygon: BoardPoint[]) {
  return Math.abs(polygon.reduce((area, point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0) / 2);
}

function closestSegment(point: BoardPoint, line: BoardPoint[]) {
  let distance = Number.POSITIVE_INFINITY;
  let angle = 0;
  for (let index = 1; index < line.length; index += 1) {
    const a = line[index - 1];
    const b = line[index];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
    const x = a.x + t * dx;
    const y = a.y + t * dy;
    const nextDistance = Math.hypot(point.x - x, point.y - y);
    if (nextDistance < distance) {
      distance = nextDistance;
      angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    }
  }
  return { distance, angle };
}

function polylineLength(line: BoardPoint[]) {
  return line.slice(1).reduce(
    (length, point, index) => length + Math.hypot(point.x - line[index].x, point.y - line[index].y),
    0,
  );
}

export function terrainFromFeatures(
  center: BoardPoint,
  polygon: BoardPoint[],
  features: ProjectedFeature[],
  density: number,
  layers: Record<Layer, boolean>,
) {
  if (layers.buildings && features.some((feature) =>
    feature.kind === "building" &&
    polygonArea(feature.points) >= 700 &&
    (pointInPolygon(center, feature.points) || pointInPolygon(polygonCenter(feature.points), polygon))
  )) return { terrain: "building" as Terrain, routeAngle: 0 };

  if (layers.roads) {
    const route = features
      .filter((feature) => feature.kind === "road" || feature.kind === "path")
      .filter((feature) => feature.kind === "road" || polylineLength(feature.points) >= 100)
      .map((feature) => ({ feature, ...closestSegment(center, feature.points) }))
      .filter(({ feature, distance }) => distance <= (feature.kind === "road" ? 14 : 9))
      .sort((a, b) => a.distance - b.distance || (a.feature.kind === "road" ? -1 : 1))[0];
    if (route) return { terrain: route.feature.kind as Terrain, routeAngle: route.angle };
  }

  if (layers.trees) {
    if (features.some((feature) => feature.kind === "woods" && pointInPolygon(center, feature.points))) {
      return { terrain: "woods" as Terrain, routeAngle: 0 };
    }
    const treeCount = features.filter((feature) => feature.kind === "tree" && pointInPolygon(feature.points[0], polygon)).length;
    if (treeCount >= Math.max(1, 5 - density)) return { terrain: "woods" as Terrain, routeAngle: 0 };
  }

  if (features.some((feature) => feature.kind === "garden" && pointInPolygon(center, feature.points))) {
    return { terrain: "garden" as Terrain, routeAngle: 0 };
  }

  return { terrain: "lawn" as Terrain, routeAngle: 0 };
}
