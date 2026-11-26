"use client";

import type { BeamlingHandle } from "@beamling/mascot/react";
import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";
import { createPortal } from "react-dom";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Characters at the end of the text that count as "the words being written". */
const TAIL_CHARS = 14;

/** The newest words in `root`: the part of its last text that sits on the last line. */
function newestWords(root: HTMLElement): Box | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent?.trim()) last = node as Text;
  }
  if (!last) return null;
  const range = document.createRange();
  const end = (last.textContent ?? "").trimEnd().length;
  range.setStart(last, Math.max(0, end - TAIL_CHARS));
  range.setEnd(last, end);
  const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);
  const line = rects.at(-1);
  if (!line) return null;
  const onLine = rects.filter((rect) => Math.abs(rect.top - line.top) < 2);
  const left = Math.min(...onLine.map((rect) => rect.left));
  const right = Math.max(...onLine.map((rect) => rect.right));
  return { x: (left + right) / 2, y: line.top + line.height / 2, w: right - left, h: line.height };
}

/** Centre and width of each eye, read from the mascot's light shapes as they move. */
function eyePositions(host: HTMLElement): { x: number; y: number; w: number }[] | null {
  const eyes = [...host.querySelectorAll('[data-part="light-l"], [data-part="light-r"]')].map((eye) => eye.getBoundingClientRect());
  if (eyes.length !== 2 || eyes.some((eye) => !eye.width)) return null;
  return eyes.map((eye) => ({ x: eye.left + eye.width / 2, y: eye.top + eye.height / 2, w: eye.width }));
}

const noSubscription = () => () => {};
const round = (value: number) => Math.round(value * 2) / 2;

/**
 * The working mascot's light on the answer: a narrow beam from its eyes to the words being
 * written, gliding as they move. Off with reduced motion. Decorative only.
 */
export function BeamLamp({
  eyes,
  target,
  mascot,
  flash,
}: {
  eyes: RefObject<HTMLElement | null>;
  target: RefObject<HTMLElement | null>;
  mascot: RefObject<BeamlingHandle | null>;
  /** Changes when a citation arrives: the light brightens once. */
  flash: number;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const cone = useRef<SVGPathElement>(null);
  const axis = useRef<SVGLinearGradientElement>(null);
  const spot = useRef<SVGEllipseElement>(null);
  const light = useRef<SVGGElement>(null);
  // Portalled to body: an ancestor with a transform or filter would anchor `fixed` to itself.
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);

  useEffect(() => {
    const g = light.current;
    if (!flash || !g) return;
    g.classList.remove("is-flashing");
    // Reading layout restarts the CSS animation.
    void g.getBoundingClientRect();
    g.classList.add("is-flashing");
  }, [flash]);

  useEffect(() => {
    if (!mounted || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    let shape = "";
    let lookedAt = 0;
    let at: Box | null = null;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const host = eyes.current;
      const from = host?.getBoundingClientRect();
      const lights = host ? eyePositions(host) : null;
      const root = target.current;
      const words = root ? newestWords(root) : null;
      if (!from || !lights || !words || words.y - words.h / 2 < from.bottom || words.y > window.innerHeight) {
        at = null;
        if (shape) svg.current?.classList.remove("is-on");
        shape = "";
        return;
      }
      // Glide to the new words; a jump of more than half a screen snaps.
      at =
        !at || Math.abs(words.y - at.y) > window.innerHeight / 2
          ? words
          : { x: at.x + (words.x - at.x) * 0.35, y: at.y + (words.y - at.y) * 0.35, w: at.w + (words.w - at.w) * 0.35, h: words.h };
      const ex = (lights[0].x + lights[1].x) / 2;
      const ey = (lights[0].y + lights[1].y) / 2;
      const dx = at.x - ex;
      const dy = at.y - ey;
      const length = Math.hypot(dx, dy) || 1;
      // One beam per eye, as wide as the eye where it leaves, landing flat on the words.
      const spread = at.w / 2 + 8;
      const beams = lights.map((eye) => {
        const half = Math.max(1, eye.w * 0.35);
        return `M${round(eye.x - half)},${round(eye.y)}L${round(at!.x - spread)},${round(at!.y)}L${round(at!.x + spread)},${round(at!.y)}L${round(eye.x + half)},${round(eye.y)}Z`;
      });
      const next = `${beams.join("")}|${round(at.x)},${round(at.y)},${round(spread + 4)},${round(at.h / 2 + 5)}`;
      if (next === shape) return;
      if (!shape) svg.current?.classList.add("is-on");
      shape = next;
      const [path, ellipse] = next.split("|");
      const [cx, cy, rx, ry] = ellipse.split(",");
      cone.current?.setAttribute("d", path);
      axis.current?.setAttribute("x1", String(round(ex)));
      axis.current?.setAttribute("y1", String(round(ey)));
      axis.current?.setAttribute("x2", cx);
      axis.current?.setAttribute("y2", cy);
      spot.current?.setAttribute("cx", cx);
      spot.current?.setAttribute("cy", cy);
      spot.current?.setAttribute("rx", rx);
      spot.current?.setAttribute("ry", ry);
      // Turning the eyes restarts their spring: at most a few times a second.
      const now = performance.now();
      if (now - lookedAt > 150) {
        lookedAt = now;
        // Pitch is capped: looking straight down would flatten the eyes into slits.
        const reach = Math.max(240, length);
        mascot.current?.lookAt((dx / reach) * 1.4, Math.min(0.45, dy / reach), 1);
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [eyes, target, mascot, mounted]);

  if (!mounted) return null;
  return createPortal(
    <svg ref={svg} className="beam-lamp" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient ref={axis} id="beam-lamp-axis" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--beam)" stopOpacity="0.04" />
          <stop offset="0.7" stopColor="var(--beam)" stopOpacity="0.1" />
          <stop offset="1" stopColor="var(--beam)" stopOpacity="0.2" />
        </linearGradient>
        <radialGradient id="beam-lamp-spot">
          <stop offset="0" stopColor="var(--beam)" stopOpacity="0.5" />
          <stop offset="0.6" stopColor="var(--beam)" stopOpacity="0.16" />
          <stop offset="1" stopColor="var(--beam)" stopOpacity="0" />
        </radialGradient>
        <filter id="beam-lamp-soft" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="2" />
        </filter>
      </defs>
      <g ref={light} className="beam-lamp-light">
        <path ref={cone} fill="url(#beam-lamp-axis)" filter="url(#beam-lamp-soft)" />
        <ellipse ref={spot} fill="url(#beam-lamp-spot)" />
      </g>
    </svg>,
    document.body,
  );
}
