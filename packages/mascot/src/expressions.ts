import { OPEN_EYE, type BeamShape, type EyeShape } from "./geometry.js";

export const EXPRESSIONS = [
  "neutral",
  "happy",
  "curious",
  "suspicious",
  "angry",
  "sad",
  "surprised",
  "sleepy",
  "playful",
  "confused",
  "focused",
  "shy",
] as const;

export type Expression = (typeof EXPRESSIONS)[number];

export interface ExpressionPreset {
  left: EyeShape;
  right: EyeShape;
  beam: BeamShape;
  /**
   * Where the mood makes Beamling look, added to the activity's gaze
   * (-1..1, positive is right and down). Light leaves straight out of the
   * eyes, so this is also where the beams go: at 0 they point at the viewer
   * and only glare shows, so moods look down towards the floor in front.
   */
  look: [number, number];
}

const BEAM: BeamShape = { length: 9, spread: 2.2, intensity: 0.85 };

function preset(
  left: Partial<EyeShape>,
  look: [number, number],
  beam: Partial<BeamShape> = {},
  right: Partial<EyeShape> = left,
): ExpressionPreset {
  return {
    left: { ...OPEN_EYE, ...left },
    right: { ...OPEN_EYE, ...right },
    beam: { ...BEAM, ...beam },
    look,
  };
}

/**
 * Eye shapes are written for the left eye with x pointing inward; the right eye
 * is mirrored unless it has its own shape.
 */
export const PRESETS: Record<Expression, ExpressionPreset> = {
  neutral: preset({ top: -0.12, topTilt: 0.14 }, [0, 0.55]),
  happy: preset({ bottom: -0.38, bottomCurve: 0.55, dy: -0.12 }, [0, 0.45], { intensity: 1 }),
  curious: preset({ rx: 0.9, ry: 0.9, dy: -0.15 }, [0.1, 0.3], { spread: 1.9, intensity: 0.95 }, { rx: 0.98, ry: 0.98, dy: -0.18 }),
  suspicious: preset({ top: 0.12, topTilt: 0.32 }, [0.3, 0.5], { spread: 2, intensity: 0.7 }, { top: 0.3, topTilt: 0.32 }),
  angry: preset({ top: -0.18, topTilt: 0.62, dy: 0.05 }, [0, 0.55], { intensity: 1 }),
  sad: preset({ top: 0.02, topTilt: -0.3, dy: 0.15 }, [0, 0.85], { intensity: 0.5 }),
  surprised: preset({ rx: 0.7, ry: 1.25, dy: -0.25 }, [0, 0.3], { spread: 1.9, intensity: 1 }),
  sleepy: preset({ top: 0.08, dy: 0.1 }, [0, 0.75], { intensity: 0.42 }),
  playful: preset(
    { bottom: -0.38, bottomCurve: 0.55, rot: -0.28, dy: -0.15 },
    [0.25, 0.45],
    { intensity: 1 },
    { bottom: -0.38, bottomCurve: 0.55, rot: 0.28, dy: -0.05 },
  ),
  confused: preset(
    { rx: 1.05, ry: 1.05, top: -0.32, topTilt: -0.4, dy: -0.12 },
    [-0.25, 0.45],
    { intensity: 0.8 },
    { rx: 0.88, ry: 0.88, top: 0.05, topTilt: 0.45, dy: 0.06 },
  ),
  focused: preset({ top: 0.3, topTilt: 0.14 }, [0, 0.65], { length: 10, spread: 1.6, intensity: 1 }),
  shy: preset({ rx: 0.85, ry: 0.85, top: 0.42, topTilt: -0.22, dy: 0.22 }, [-0.4, 0.8], { spread: 1.8, intensity: 0.5 }),
};
