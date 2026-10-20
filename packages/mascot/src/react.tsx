"use client";

import { useEffect, useId, useImperativeHandle, useMemo, useRef, type CSSProperties, type Ref } from "react";
import { Beamling, DEFAULTS, markup, type Activity } from "./engine.js";
import type { Expression } from "./expressions.js";
import { ANSWER_STATE_MOOD, type AnswerState } from "./states.js";

export interface BeamlingHandle {
  blink(): void;
  pulse(strength?: number): void;
  lookAt(x: number, y: number, holdSeconds?: number): void;
}

export interface BeamlingMascotProps {
  expression?: Expression;
  activity?: Activity;
  /** Shortcut that sets expression and activity from an answer state. Explicit props win. */
  state?: AnswerState;
  beams?: boolean;
  followPointer?: boolean;
  blink?: boolean;
  /** Accessible name; pass "" when the mascot is decorative. */
  label?: string;
  reducedMotion?: boolean | "auto";
  /** Draw the faint edges of the room the light lands in. */
  room?: boolean;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<BeamlingHandle>;
}

/**
 * Server-renders a static pose, then animates it on the client.
 * Width is set by the container or `style`; height follows the aspect ratio.
 */
export function BeamlingMascot({
  expression,
  activity,
  state,
  beams = DEFAULTS.beams,
  followPointer = DEFAULTS.followPointer,
  blink = DEFAULTS.blink,
  label = DEFAULTS.label,
  reducedMotion = DEFAULTS.reducedMotion,
  room = DEFAULTS.room,
  className,
  style,
  ref,
}: BeamlingMascotProps) {
  const mood = state ? ANSWER_STATE_MOOD[state] : undefined;
  const exp = expression ?? mood?.expression ?? DEFAULTS.expression;
  const act = activity ?? mood?.activity ?? DEFAULTS.activity;

  const id = "beamling-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<Beamling | null>(null);

  // Markup only depends on structural props, so React never resets the
  // nodes the engine animates. When it is rebuilt, it starts from the
  // expression of that render, so the new scene does not morph from a stale pose.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const html = useMemo(() => ({ __html: markup({ id, expression: exp, beams, label, room }) }), [id, beams, label, room]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const b = new Beamling(el, { expression: exp, activity: act, beams, followPointer, blink, label, reducedMotion, room });
    engine.current = b;
    return () => {
      b.destroy();
      engine.current = null;
    };
    // Structural options recreate the engine; the rest are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, reducedMotion]);

  useEffect(() => engine.current?.setExpression(exp), [exp, html, reducedMotion]);
  useEffect(() => engine.current?.setActivity(act), [act, html, reducedMotion]);
  useEffect(() => engine.current?.setFollowPointer(followPointer), [followPointer, html, reducedMotion]);
  useEffect(() => engine.current?.setBlinking(blink), [blink, html, reducedMotion]);

  useImperativeHandle(
    ref,
    () => ({
      blink: () => engine.current?.blink(),
      pulse: (s) => engine.current?.pulse(s),
      lookAt: (x, y, h) => engine.current?.lookAt(x, y, h),
    }),
    [],
  );

  return <div ref={host} className={className} style={{ lineHeight: 0, ...style }} dangerouslySetInnerHTML={html} />;
}
