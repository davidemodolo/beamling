import { PRESETS, isExpression, type Expression } from "./expressions.js";
import type { BeamShape, EyeShape } from "./geometry.js";
import { sceneMarkup, scenePaths, type Frame } from "./scene.js";

/** What Beamling is doing, independent of how it feels. */
export const ACTIVITIES = ["idle", "thinking", "searching", "reading", "writing", "exploring"] as const;
export type Activity = (typeof ACTIVITIES)[number];

export const isActivity = (value: unknown): value is Activity => ACTIVITIES.includes(value as Activity);

export interface BeamlingOptions {
  expression?: Expression;
  activity?: Activity;
  /** Draw the light beams. Turn off for small sizes (avatar, favicon-like mark). */
  beams?: boolean;
  /** Eyes follow the pointer while it moves; activity motion resumes after a pause. */
  followPointer?: boolean;
  /** Blink spontaneously. */
  blink?: boolean;
  /** Accessible name. An empty string marks the mascot as decorative. */
  label?: string;
  /** "auto" follows the prefers-reduced-motion media query. */
  reducedMotion?: boolean | "auto";
  /** Draw the faint edges of the room the light lands in. */
  room?: boolean;
}

/** Option defaults shared by the engine, the custom element and the React wrapper. */
export const DEFAULTS = {
  expression: "neutral",
  activity: "idle",
  beams: true,
  followPointer: false,
  blink: true,
  label: "Beamling",
  reducedMotion: "auto",
  room: false,
} as const satisfies Required<BeamlingOptions>;

const SHAPE_KEYS = ["rx", "ry", "top", "topTilt", "topCurve", "bottom", "bottomTilt", "bottomCurve", "rot", "dx", "dy"] as const;
const BEAM_KEYS = ["length", "spread", "intensity"] as const;

/** Flattened animatable state: left shape, right shape, beam, gaze. */
const SIZE = SHAPE_KEYS.length * 2 + BEAM_KEYS.length + 2;
const GAZE_X = SIZE - 2;
const GAZE_Y = SIZE - 1;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Activities whose motion never rests; the others let the loop sleep between events. */
const CONTINUOUS: readonly Activity[] = ["searching", "reading", "writing", "exploring"];

/** The sleepy drift is slow, so it redraws at a low rate instead of every frame. */
const SLEEPY_FRAME_MS = 1000 / 20;

/** Exploring: a slow tour of the room as [gazeX, gazeY, hold seconds]. */
const TOUR: readonly (readonly [number, number, number])[] = [
  [-1, 0.1, 1.5],
  [-1, -0.45, 1.3],
  [-0.7, 0.75, 1.3],
  [0, 0.9, 1.2],
  [0.7, 0.75, 1.3],
  [1, 0.1, 1.5],
  [1, -0.45, 1.3],
  [0, -0.3, 1.3],
  [0, 0, 1.4],
];
const TOUR_TOTAL = TOUR.reduce((a, w) => a + w[2], 0);

/** Where the mood makes Beamling look. The mark has no beams to show, so it faces the viewer. */
const lookOf = (expression: Expression, beams: boolean) => (beams ? PRESETS[expression].look : ([0, 0] as const));

function pack(expression: Expression, beams: boolean, gazeX: number, gazeY: number): Float64Array {
  const p = PRESETS[expression];
  const out = new Float64Array(SIZE);
  let i = 0;
  for (const k of SHAPE_KEYS) out[i++] = p.left[k];
  for (const k of SHAPE_KEYS) out[i++] = p.right[k];
  for (const k of BEAM_KEYS) out[i++] = p.beam[k];
  // The mood's gaze is part of the pose from the first frame.
  const look = lookOf(expression, beams);
  out[GAZE_X] = clamp(gazeX + look[0], -1, 1);
  out[GAZE_Y] = clamp(gazeY + look[1], -1, 1);
  return out;
}

function unpack(v: Float64Array, openness: number, brightness: number): Frame {
  let i = 0;
  const left = {} as EyeShape;
  const right = {} as EyeShape;
  const beam = {} as BeamShape;
  for (const k of SHAPE_KEYS) left[k] = v[i++];
  for (const k of SHAPE_KEYS) right[k] = v[i++];
  for (const k of BEAM_KEYS) beam[k] = v[i++];
  return { left, right, beam, gazeX: v[GAZE_X], gazeY: v[GAZE_Y], openness, brightness };
}

/** Frame for a resting pose; used for server rendering and first paint. */
export function staticFrame(expression: Expression = DEFAULTS.expression, beams: boolean = DEFAULTS.beams): Frame {
  return unpack(pack(expression, beams, 0, 0), 1, 1);
}

let counter = 0;
const uid = () => `beamling-${(++counter).toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function markup(options: BeamlingOptions & { id?: string } = {}): string {
  const beams = options.beams ?? DEFAULTS.beams;
  return sceneMarkup(options.id ?? uid(), staticFrame(options.expression, beams), {
    beams,
    room: options.room ?? DEFAULTS.room,
    label: options.label ?? DEFAULTS.label,
  });
}

/**
 * Animated Beamling mounted inside `host`. If `host` already contains markup
 * produced by `markup()` (for example from server rendering), it is reused.
 */
export class Beamling {
  readonly host: Element;
  private svg!: SVGSVGElement;
  private nodes!: Record<string, Element | null>;
  private opts: Required<BeamlingOptions>;

  private current: Float64Array;
  private velocity = new Float64Array(SIZE);
  private target: Float64Array;

  private raf = 0;
  private pointerRaf = 0;
  private destroyed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private last = 0;
  /** Seconds since creation, on the wall clock so the loop can sleep between events. */
  private time = 0;
  private readonly epoch = performance.now();
  private drawn = { left: "", right: "", opacity: "" };
  private visible = true;
  private reduce = false;
  private mql: MediaQueryList | null = null;
  private observer: IntersectionObserver | null = null;

  private nextBlink = rand(1.5, 4);
  private blinkStart = -1;
  private doubleBlink = false;
  private flash = 0;
  private gazeX = 0;
  private gazeY = 0;
  private nextGlance = 0;
  private pointerUntil = -Infinity;
  private pointerX = 0;
  private pointerY = 0;
  /** Latest pointer position, read once per frame. */
  private pointerEvent = { x: 0, y: 0 };
  private typing = 0;

  constructor(host: Element, options: BeamlingOptions = {}) {
    this.host = host;
    this.opts = { ...DEFAULTS, ...options, followPointer: false };
    if (!isExpression(this.opts.expression)) this.opts.expression = DEFAULTS.expression;
    if (!isActivity(this.opts.activity)) this.opts.activity = DEFAULTS.activity;
    this.target = pack(this.opts.expression, this.opts.beams, 0, 0);
    this.current = this.target.slice();
    this.mount();
    this.setupMotionPreference();
    this.setupVisibility();
    this.setFollowPointer(options.followPointer ?? DEFAULTS.followPointer);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.draw();
    this.start();
  }

  get expression(): Expression {
    return this.opts.expression;
  }

  get activity(): Activity {
    return this.opts.activity;
  }

  setExpression(expression: Expression): void {
    if (!isExpression(expression) || expression === this.opts.expression) return;
    this.opts.expression = expression;
    this.retarget();
  }

  setActivity(activity: Activity): void {
    if (!isActivity(activity) || activity === this.opts.activity) return;
    this.opts.activity = activity;
    this.nextGlance = 0;
    this.retarget();
  }

  /** Point the eyes (and the beams) towards a direction, each axis in -1..1. */
  lookAt(x: number, y: number, holdSeconds = 2.5): void {
    this.pointerX = clamp(x, -1, 1);
    this.pointerY = clamp(y, -1, 1);
    this.pointerUntil = this.clock() + holdSeconds;
    this.retarget();
  }

  blink(): void {
    if (this.reduce) return;
    this.blinkStart = this.clock();
    this.start();
  }

  /** Brief brightening, e.g. when a source or citation arrives. */
  pulse(strength = 0.35): void {
    if (this.reduce) return;
    this.flash = Math.max(this.flash, strength);
    this.start();
  }

  setFollowPointer(on: boolean): void {
    if (this.destroyed || on === this.opts.followPointer) return;
    this.opts.followPointer = on;
    if (on) window.addEventListener("pointermove", this.onPointer, { passive: true });
    else window.removeEventListener("pointermove", this.onPointer);
  }

  setBlinking(on: boolean): void {
    this.opts.blink = on;
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.pointerRaf);
    clearTimeout(this.timer);
    this.raf = 0;
    this.pointerRaf = 0;
    window.removeEventListener("pointermove", this.onPointer);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.mql?.removeEventListener("change", this.onMotionChange);
    this.observer?.disconnect();
  }

  // ---------------------------------------------------------------------------

  private mount() {
    let svg = this.host.querySelector<SVGSVGElement>("svg[data-beamling]");
    // Reuse server-rendered markup only if it was made for the same variant.
    const { beams, room } = this.opts;
    if (!svg || svg.dataset.beams !== String(beams) || svg.dataset.room !== String(beams && room)) {
      this.host.innerHTML = sceneMarkup(uid(), unpack(this.current, 1, 1), this.opts);
      svg = this.host.querySelector<SVGSVGElement>("svg[data-beamling]")!;
    }
    this.svg = svg;
    const q = (part: string) => svg.querySelector(`[data-part="${part}"]`);
    this.nodes = {
      light: q("light"),
      lightL: q("light-l"),
      lightR: q("light-r"),
      glowL: q("glow-l"),
      glowR: q("glow-r"),
    };
  }

  private setupMotionPreference() {
    if (this.opts.reducedMotion === "auto") {
      this.mql = window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
      this.reduce = !!this.mql?.matches;
      this.mql?.addEventListener("change", this.onMotionChange);
    } else {
      this.reduce = this.opts.reducedMotion;
    }
  }

  private setupVisibility() {
    if (typeof IntersectionObserver === "undefined") return;
    this.observer = new IntersectionObserver((entries) => {
      this.visible = entries.some((e) => e.isIntersecting);
      if (this.visible) this.start();
    });
    this.observer.observe(this.host);
  }

  private onMotionChange = () => {
    this.reduce = !!this.mql?.matches;
    this.stopTransients();
    this.retarget();
  };

  /** Drops in-flight blinks and flashes; reduced motion never advances them. */
  private stopTransients() {
    this.blinkStart = -1;
    this.doubleBlink = false;
    this.flash = 0;
  }

  private onVisibility = () => {
    if (!document.hidden) this.start();
  };

  private onPointer = (e: PointerEvent) => {
    // Following the pointer is motion triggered by the user: off with reduced motion.
    if (this.reduce) return;
    this.pointerEvent.x = e.clientX;
    this.pointerEvent.y = e.clientY;
    // Layout is read at most once per frame, however often the pointer moves.
    if (!this.pointerRaf) this.pointerRaf = requestAnimationFrame(this.followPointer);
  };

  private followPointer = () => {
    this.pointerRaf = 0;
    const r = this.svg.getBoundingClientRect();
    // Eyes sit in the upper third of the full scene.
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height * (this.opts.beams ? 0.26 : 0.5);
    const reach = Math.max(r.width, 240);
    this.lookAt((this.pointerEvent.x - cx) / reach, (this.pointerEvent.y - cy) / reach, 2);
  };

  /** Current time in seconds, also valid while the loop sleeps. */
  private clock(): number {
    this.time = Math.max(this.time, (performance.now() - this.epoch) / 1000);
    return this.time;
  }

  private retarget() {
    this.target = pack(this.opts.expression, this.opts.beams, this.gazeX, this.gazeY);
    this.start();
  }

  private start() {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.destroyed || this.raf || !this.visible) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    this.raf = 0;
    // rAF timestamps can precede the performance.now() taken in start().
    const dt = clamp((now - this.last) / 1000, 0, 1 / 30);
    this.last = now;
    this.time = Math.max(this.time, (now - this.epoch) / 1000);

    const { openness, brightness } = this.behave(dt);
    const settled = this.integrate(dt);
    this.draw(openness, brightness);
    if (!this.visible || document.hidden) return;

    // Keep animating only while something moves. At rest, sleep until the next
    // scheduled event (blink, glance, end of a lookAt); setters wake it earlier.
    const t = this.time;
    const moving =
      !settled ||
      this.blinkStart >= 0 ||
      this.flash > 0.002 ||
      (!this.reduce && t >= this.pointerUntil && CONTINUOUS.includes(this.opts.activity));
    if (moving) {
      this.raf = requestAnimationFrame(this.tick);
      return;
    }
    let next = Infinity;
    // With reduced motion only the end of a lookAt changes the pose (back to centre).
    if (t < this.pointerUntil) next = this.pointerUntil;
    else if (!this.reduce) next = this.nextGlance;
    if (!this.reduce && this.opts.blink) next = Math.min(next, this.nextBlink);
    let delay = (next - t) * 1000;
    if (!this.reduce && this.opts.expression === "sleepy") delay = Math.min(delay, SLEEPY_FRAME_MS);
    if (delay < Infinity) this.timer = setTimeout(() => this.start(), Math.max(0, delay));
  };

  /** Activity-driven gaze, blinking, and brightness for this frame. */
  private behave(dt: number): { openness: number; brightness: number } {
    const t = this.time;
    let brightness = 1;
    let openness = 1;

    if (this.reduce) this.stopTransients();

    if (t < this.pointerUntil) {
      this.gazeX = this.pointerX;
      this.gazeY = this.pointerY;
    } else if (this.reduce) {
      this.gazeX = 0;
      this.gazeY = 0;
    } else {
      switch (this.opts.activity) {
        case "idle":
          if (t >= this.nextGlance) {
            const centre = Math.random() < 0.35;
            this.gazeX = centre ? 0 : rand(-0.35, 0.35);
            this.gazeY = centre ? 0 : rand(-0.2, 0.15);
            this.nextGlance = t + rand(1.6, 4.5);
          }
          break;
        case "thinking":
          if (t >= this.nextGlance) {
            this.gazeX = this.gazeX > 0 ? rand(-0.5, -0.25) : rand(0.25, 0.5);
            this.gazeY = rand(-0.6, -0.35);
            this.nextGlance = t + rand(1.2, 2.2);
          }
          break;
        case "searching":
          // A searchlight sweep across the page.
          this.gazeX = 0.85 * Math.sin(t * 1.6);
          this.gazeY = 0.1 + 0.12 * Math.sin(t * 3.2);
          brightness = 1.1;
          break;
        case "reading": {
          // Saccades along a line, then a quick return sweep.
          const cycle = 2.2;
          const p = (t % cycle) / cycle;
          const steps = 5;
          const step = Math.min(steps - 1, Math.floor(p * (steps + 1)));
          this.gazeX = p < steps / (steps + 1) ? -0.55 + (1.1 * step) / (steps - 1) : -0.55;
          this.gazeY = 0.25 + 0.06 * (Math.floor(t / cycle) % 3);
          break;
        }
        case "exploring": {
          // A slow tour of the room: left wall, floor, right wall, then back to the viewer.
          let at = t % TOUR_TOTAL;
          for (const [x, y, hold] of TOUR) {
            if (at < hold) {
              this.gazeX = x;
              this.gazeY = y;
              break;
            }
            at -= hold;
          }
          break;
        }
        case "writing":
          if (t >= this.nextGlance) {
            this.gazeX = rand(-0.25, 0.25);
            this.gazeY = rand(0.2, 0.35);
            this.nextGlance = t + rand(0.8, 1.8);
          }
          // Small flickers, like keystrokes.
          this.typing -= dt;
          if (this.typing <= 0) {
            this.flash = Math.max(this.flash, rand(0.04, 0.12));
            this.typing = rand(0.08, 0.22);
          }
          break;
      }
    }

    // The mood biases where Beamling looks, except when told where to look.
    const look = t < this.pointerUntil ? [0, 0] : lookOf(this.opts.expression, this.opts.beams);
    this.target[GAZE_X] = clamp(this.gazeX + look[0], -1, 1);
    this.target[GAZE_Y] = clamp(this.gazeY + look[1], -1, 1);
    if (this.reduce) return { openness, brightness };

    if (this.opts.expression === "sleepy") {
      // Slowly drifting off, then catching itself.
      const cycle = (t % 5.5) / 5.5;
      openness *= cycle < 0.8 ? 1 - 0.55 * (cycle / 0.8) : 0.45 + 0.55 * ((cycle - 0.8) / 0.2);
    }

    if (this.opts.blink && t >= this.nextBlink && this.blinkStart < 0) {
      this.blinkStart = t;
      this.doubleBlink = Math.random() < 0.18;
      this.nextBlink = t + rand(2.8, 6.5) * (this.opts.expression === "sleepy" ? 1.6 : 1);
    }
    if (this.blinkStart >= 0) {
      const dur = 0.16;
      const p = (t - this.blinkStart) / dur;
      if (p >= 1) {
        this.blinkStart = this.doubleBlink ? t + 0.06 : -1;
        this.doubleBlink = false;
      } else if (p >= 0) {
        // Fast close, slightly slower open.
        const shut = p < 0.4 ? p / 0.4 : 1 - (p - 0.4) / 0.6;
        openness *= 1 - 0.94 * Math.sin((shut * Math.PI) / 2);
      }
    }

    brightness += this.flash;
    this.flash *= Math.exp(-dt * 6);
    return { openness, brightness };
  }

  /** Damped springs towards the target pose. Returns true when at rest. */
  private integrate(dt: number): boolean {
    if (this.reduce) {
      this.current.set(this.target);
      this.velocity.fill(0);
      return true;
    }
    const k = 190;
    const c = 2 * Math.sqrt(k) * 0.78;
    const kGaze = 120;
    const cGaze = 2 * Math.sqrt(kGaze) * 0.9;
    let rest = true;
    for (let i = 0; i < SIZE; i++) {
      const gaze = i >= GAZE_X;
      const x = this.current[i] - this.target[i];
      const a = -(gaze ? kGaze : k) * x - (gaze ? cGaze : c) * this.velocity[i];
      this.velocity[i] += a * dt;
      this.current[i] += this.velocity[i] * dt;
      if (Math.abs(x) > 1e-3 || Math.abs(this.velocity[i]) > 1e-3) rest = false;
    }
    return rest;
  }

  /** Writes the frame to the DOM, skipping attributes that did not change. */
  private draw(openness = 1, brightness = 1) {
    const g = scenePaths(unpack(this.current, openness, brightness), this.opts.beams);
    const nd = this.nodes;
    const opacity = g.opacity.toFixed(2);
    if (g.left !== this.drawn.left) {
      nd.lightL?.setAttribute("d", g.left);
      nd.glowL?.setAttribute("d", g.left);
    }
    if (g.right !== this.drawn.right) {
      nd.lightR?.setAttribute("d", g.right);
      nd.glowR?.setAttribute("d", g.right);
    }
    if (opacity !== this.drawn.opacity) nd.light?.setAttribute("opacity", opacity);
    this.drawn = { left: g.left, right: g.right, opacity };
  }
}
