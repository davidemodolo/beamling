import { centroid, eyeOutline, type BeamShape, type EyeShape, type Vec } from "./geometry.js";

/**
 * Beamling floats inside an imaginary room (a box) seen through a perspective
 * camera. No light is simulated: each eye's outline is pushed through 3D space
 * and projected, and the light is the flat shape it sweeps.
 *
 * World units are eye radii: X right, Y up, Z towards the viewer; the face is
 * at the origin. Both eyes look at one point (at rest, the camera). Each eye
 * faces its line of sight and light leaves it perpendicularly, as one ray per
 * outline point, widening with distance, until it meets the floor, a wall or
 * the ceiling, or leaves through the open front of the box, towards the viewer.
 */

const PX = 20; // pixels per world unit at Z = 0
const CX = 160;
const CY = 72; // screen y of the eyes
const CAMERA_Z = 16;
const CAMERA_Y = 1.2; // the camera looks slightly down on Beamling
const EYE_X = 1.8; // half distance between the eyes
const PIVOT_Z = -2.2; // centre of the (invisible) head
const YAW = Math.PI / 2; // full gaze turns the head 90°: facing a side wall
const PITCH = 1.4; // and nearly straight down at the floor
const ROOM = { x: 7, floor: -4.5, ceiling: 4.5, back: -9, front: 9 };

const VIEWBOX_FULL = "0 0 320 230";
/** Crop around the eyes for the small "mark" variant (no beams). */
const VIEWBOX_MARK = "66 32 188 88";

export interface Frame {
  left: EyeShape;
  right: EyeShape;
  beam: BeamShape;
  /** Horizontal and vertical gaze, roughly -1..1. Positive is right and down. */
  gazeX: number;
  gazeY: number;
  /** 0 = closed, 1 = open. */
  openness: number;
  /** Multiplier for the light intensity. */
  brightness: number;
}

type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

function headTransform(gazeX: number, gazeY: number) {
  const cy = Math.cos(gazeX * YAW);
  const sy = Math.sin(gazeX * YAW);
  const cp = Math.cos(gazeY * PITCH);
  const sp = Math.sin(gazeY * PITCH);
  return ([x, y, z]: V3): V3 => {
    z -= PIVOT_Z;
    // Pitch around X (positive looks down), then yaw around Y (positive looks right).
    const y1 = y * cp - z * sp;
    const z1 = y * sp + z * cp;
    return [x * cy + z1 * sy, y1, -x * sy + z1 * cy + PIVOT_Z];
  };
}

function project([x, y, z]: V3): Vec {
  const s = (CAMERA_Z / Math.max(CAMERA_Z - z, 0.5)) * PX;
  return [CX + x * s, CY - CAMERA_Y * PX - (y - CAMERA_Y) * s];
}

/**
 * Fraction of `ray` (from `p`) travelled before meeting a side of the box. The
 * open front counts as a side too: every ray then ends on the box, so the patch
 * where the light lands never folds over itself as seen from the camera.
 */
function reach(p: V3, ray: V3): number {
  let t = Infinity;
  for (const axis of [0, 1, 2] as const) {
    const v = ray[axis];
    if (Math.abs(v) < 1e-9) continue;
    const plane = axis === 0 ? (v > 0 ? ROOM.x : -ROOM.x) : axis === 1 ? (v > 0 ? ROOM.ceiling : ROOM.floor) : v > 0 ? ROOM.front : ROOM.back;
    t = Math.min(t, (plane - p[axis]) / v);
  }
  return Math.max(t, 0);
}

/** Shoelace area; its sign tells the winding. */
function area(poly: Vec[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] - poly[i][0]) * (poly[j][1] + poly[i][1]);
  return a;
}

const turn = (o: Vec, a: Vec, b: Vec) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/**
 * The strip one outline edge sweeps. Seen in perspective it can twist into a
 * bow-tie, whose two halves would cancel out under nonzero filling; its convex
 * outline covers the sweep instead.
 */
function strip(a: Vec, b: Vec, c: Vec, d: Vec): Vec[] {
  const q = [a, b, c, d];
  const signs = q.map((p, i) => Math.sign(turn(p, q[(i + 1) % 4], q[(i + 2) % 4])));
  if (signs.every((x) => x >= 0) || signs.every((x) => x <= 0)) return q;
  const pts = q.slice().sort((u, v) => u[0] - v[0] || u[1] - v[1]);
  const half = (list: Vec[]) => {
    const h: Vec[] = [];
    for (const p of list) {
      while (h.length >= 2 && turn(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
      h.push(p);
    }
    h.pop();
    return h;
  };
  return half(pts).concat(half(pts.slice().reverse()));
}

/**
 * One eye's light as screen polygons: the eye, where its light lands, and one
 * strip per outline edge joining the two. Their union is the exact silhouette
 * of the swept shape, notches included (a crescent stays a crescent).
 */
function eyeLight(shape: EyeShape, beam: BeamShape, mirror: 1 | -1, f: Frame, beams: boolean): Vec[][] {
  const outline = eyeOutline(shape);
  if (outline.length === 0) return [];
  const head = headTransform(f.gazeX, f.gazeY);
  const [c0, c1] = centroid(outline);
  const open = Math.max(f.openness, 0.001);

  // The eye faces the shared gaze target; U = local +x (inward), V = local +y (down).
  const C = head([-mirror * EYE_X + mirror * c0, -c1, 0]);
  const D = unit(sub(head([0, CAMERA_Y, CAMERA_Z]), C));
  const down = sub(head([0, -1, 0]), head([0, 0, 0]));
  const V = unit(sub(down, D.map((d) => d * dot(down, D)) as V3));
  const U = cross(V, D).map((u) => -mirror * u) as V3;
  const grow = (beam.spread - 1) / Math.max(beam.length, 0.01);

  // A point of the beam's cross-section at distance s along it.
  const at = (x: number, y: number, s: number): V3 => {
    const k = 1 + grow * s;
    return [0, 1, 2].map((i) => C[i] + (U[i] * x + V[i] * y) * k + D[i] * s) as V3;
  };
  const local = outline.map(([x, y]) => [x - c0, (y - c1) * open] as const);
  const near3 = local.map(([x, y]) => at(x, y, 0));
  const near = near3.map(project);
  if (!beams) return [near];

  const far = local.map(([x, y], i) => {
    const p = near3[i];
    const ray = sub(at(x, y, beam.length), p);
    const t = reach(p, ray);
    return project([p[0] + ray[0] * t, p[1] + ray[1] * t, p[2] + ray[2] * t]);
  });
  const polys = [near, far];
  for (let i = 0, j = near.length - 1; i < near.length; j = i++) polys.push(strip(near[j], near[i], far[i], far[j]));
  return polys;
}

/** All polygons as one path. Each is wound the same way, so nonzero filling draws their union. */
function toPath(polys: Vec[][]): string {
  let d = "";
  for (const poly of polys) {
    if (poly.length < 3) continue;
    const pts = area(poly) < 0 ? poly.slice().reverse() : poly;
    for (let i = 0; i < pts.length; i++) d += `${i ? "L" : "M"}${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)}`;
    d += "Z";
  }
  return d;
}

export interface ScenePaths {
  left: string;
  right: string;
  /** Opacity of all the light: eyes and beams are the same light. Dim moods stay visible. */
  opacity: number;
}

export function scenePaths(f: Frame, beams: boolean): ScenePaths {
  const open = Math.max(0, Math.min(1, f.openness));
  const light = Math.max(0, f.beam.intensity * f.brightness);
  return {
    left: toPath(eyeLight(f.left, f.beam, 1, f, beams)),
    right: toPath(eyeLight(f.right, f.beam, -1, f, beams)),
    opacity: Math.min(1, 0.4 + 0.6 * light) * Math.min(1, open * 1.4),
  };
}

function roomEdges(): string {
  const { x, floor, ceiling, back, front } = ROOM;
  const corners: [number, number][] = [
    [-x, floor],
    [x, floor],
    [x, ceiling],
    [-x, ceiling],
  ];
  const pt = (p: Vec) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
  let d = "";
  corners.forEach(([cx, cy], i) => {
    const [nx, ny] = corners[(i + 1) % 4];
    const a = pt(project([cx, cy, back]));
    d += `M${a}L${pt(project([nx, ny, back]))}M${a}L${pt(project([cx, cy, front]))}`;
  });
  return d;
}

export interface SceneOptions {
  beams: boolean;
  room: boolean;
  label: string;
}

/**
 * Static SVG markup; the animation engine updates the same nodes in place.
 * With beams, eye and light are one flat shape; the small mark keeps the same
 * flat fill, with no blur or glow.
 */
export function sceneMarkup(id: string, f: Frame, o: SceneOptions): string {
  const g = scenePaths(f, o.beams);
  const paths = (part: string) => `<path data-part="${part}-l" d="${g.left}"/><path data-part="${part}-r" d="${g.right}"/>`;
  const title = o.label ? `<title>${o.label.replace(/[<&]/g, "")}</title>` : "";
  const room =
    o.beams && o.room
      ? `<path d="${roomEdges()}" style="stroke:var(--beamling-room,rgba(244,241,234,.08));stroke-width:.6;fill:none"/>`
      : "";
  return (
    `<svg data-beamling data-beams="${o.beams}" data-room="${o.beams && o.room}" xmlns="http://www.w3.org/2000/svg" viewBox="${o.beams ? VIEWBOX_FULL : VIEWBOX_MARK}" ` +
    `role="img"${o.label ? "" : ' aria-hidden="true"'} style="display:block;width:100%;height:auto;overflow:hidden">` +
    title +
    room +
    `<g data-part="light" opacity="${g.opacity.toFixed(2)}" style="fill:var(--beamling-light,#FFD98A)">${paths("light")}</g>` +
    `</svg>`
  );
}
