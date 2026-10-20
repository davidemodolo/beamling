"use client";

import { BeamlingMascot, type BeamlingHandle } from "@beamling/mascot/react";
import type { Activity, Expression } from "@beamling/mascot";
import type { CSSProperties, Ref } from "react";
import type { ChatStage } from "@/lib/types";

export interface MascotProps {
  state?: ChatStage;
  expression?: Expression;
  activity?: Activity;
  beams?: boolean;
  followPointer?: boolean;
  room?: boolean;
  className?: string;
  style?: CSSProperties;
  label?: string;
  ref?: Ref<BeamlingHandle>;
}

const BEAM_STATES: ReadonlySet<ChatStage> = new Set(["queued", "searching", "reading"]);

/**
 * Beamling on the web. Beams appear while it searches and disappear while the
 * user or the model writes, matching the two mascot marks.
 */
export function Mascot({ state = "empty", expression, activity, beams, followPointer = false, room = false, className, style, label, ref }: MascotProps) {
  const visible = beams ?? BEAM_STATES.has(state);
  return (
    <BeamlingMascot
      ref={ref}
      state={state}
      expression={expression}
      activity={activity}
      beams={visible}
      followPointer={followPointer}
      room={room}
      className={className}
      style={style}
      label={label ?? "Beamling"}
    />
  );
}
