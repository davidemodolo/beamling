/**
 * Pure geometry for Beamling's eyes and beams. No DOM access here, so this
 * module can run on the server (SSR) and in tests.
 *
 * Every eye is described in a normalised local frame:
 *   - unit radius, y pointing down,
 *   - x pointing *inward* (towards the nose), so presets are written once and
 *     mirrored for the right eye automatically.
 *
 * The visible eye is the region of an ellipse that lies below the top lid and
 * above the bottom lid. Lids are parabolas: y = h + tilt * x + curve * x².
 * The beam is the eye's outline extruded through 3D space (see scene.ts), so
 * the cast light always has the silhouette of the eye that emits it.
 */

export type Vec = readonly [number, number];

export interface EyeShape {
  /** Horizontal radius (1 = base size). */
  rx: number;
  /** Vertical radius (1 = base size). */
  ry: number;
  /** Top lid: keeps the region where y >= top + topTilt·x + topCurve·x². */
  top: number;
  topTilt: number;
  topCurve: number;
  /** Bottom lid: keeps the region where y <= bottom + bottomTilt·x + bottomCurve·x². */
  bottom: number;
  bottomTilt: number;
  bottomCurve: number;
  /** Rotation in radians; positive turns the inner side down. */
  rot: number;
  /** Offset from the resting position, in eye radii. dx is positive inward. */
  dx: number;
  dy: number;
}

export interface BeamShape {
  /** Distance over which the beam widens to `spread`, in eye radii. */
  length: number;
  /** Size of the far cross-section relative to the eye. */
  spread: number;
  /** 0..1 brightness of the beam. */
  intensity: number;
}

export const OPEN_EYE: EyeShape = {
  rx: 1,
  ry: 1,
  top: -1.6,
  topTilt: 0,
  topCurve: 0,
  bottom: 1.6,
  bottomTilt: 0,
  bottomCurve: 0,
  rot: 0,
  dx: 0,
  dy: 0,
};

const SAMPLES = 28;

/**
 * Outline of the eye in local coordinates (unit radius), as a closed polygon.
 * Returns an empty array when the lids close the eye completely.
 */
export function eyeOutline(s: EyeShape): Vec[] {
  const rx = Math.max(s.rx, 0.01);
  const ry = Math.max(s.ry, 0.01);
  const topLid = (x: number) => s.top + s.topTilt * x + s.topCurve * x * x;
  const bottomLid = (x: number) => s.bottom + s.bottomTilt * x + s.bottomCurve * x * x;
  const span = (x: number): [number, number] => {
    const u = Math.min(1, Math.abs(x / rx));
    const h = ry * Math.sqrt(1 - u * u);
    return [Math.max(-h, topLid(x)), Math.min(h, bottomLid(x))];
  };
  const open = (x: number) => {
    const [t, b] = span(x);
    return b - t;
  };

  // Cosine spacing packs samples near the ends, where the outline curves most.
  const xs: number[] = [];
  for (let i = 0; i <= SAMPLES; i++) xs.push(-rx * Math.cos((Math.PI * i) / SAMPLES));

  // Longest run of consecutive samples where the eye is open.
  let best: [number, number] | null = null;
  let start = -1;
  for (let i = 0; i <= SAMPLES + 1; i++) {
    const isOpen = i <= SAMPLES && open(xs[i]) > 1e-4;
    if (isOpen && start < 0) start = i;
    if (!isOpen && start >= 0) {
      if (!best || i - 1 - start > best[1] - best[0]) best = [start, i - 1];
      start = -1;
    }
  }
  if (!best) return [];

  // Refine both ends with bisection so pointed tips (crescents, slits) stay sharp.
  const refine = (inside: number, outside: number) => {
    let a = inside;
    let b = outside;
    for (let k = 0; k < 18; k++) {
      const m = (a + b) / 2;
      if (open(m) > 0) a = m;
      else b = m;
    }
    return a;
  };
  const x0 = best[0] > 0 ? refine(xs[best[0]], xs[best[0] - 1]) : xs[0];
  const x1 = best[1] < SAMPLES ? refine(xs[best[1]], xs[best[1] + 1]) : xs[SAMPLES];

  const run = [x0, ...xs.slice(best[0] + 1, best[1]), x1];
  const upper: Vec[] = [];
  const lower: Vec[] = [];
  for (const x of run) {
    const [t, b] = span(x);
    upper.push([x, t]);
    lower.push([x, Math.max(t, b)]);
  }
  lower.reverse();

  const cos = Math.cos(s.rot);
  const sin = Math.sin(s.rot);
  return [...upper, ...lower].map(([x, y]) => [x * cos - y * sin + s.dx, x * sin + y * cos + s.dy] as Vec);
}

export function centroid(points: Vec[]): Vec {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
  }
  const n = Math.max(points.length, 1);
  return [x / n, y / n];
}
