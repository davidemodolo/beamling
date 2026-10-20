// Runs against the compiled package (dist/), which `pnpm install` builds through the prepare script.
import assert from "node:assert/strict";
import { test } from "node:test";
import { centroid, eyeOutline, OPEN_EYE } from "../dist/geometry.js";
import { EXPRESSIONS, PRESETS } from "../dist/expressions.js";
import { ANSWER_STATE_MOOD } from "../dist/states.js";
import { ACTIVITIES } from "../dist/engine.js";

const close = (a, b, epsilon = 1e-6) => Math.abs(a - b) < epsilon;

test("an open eye is a closed outline on the unit ellipse", () => {
  const outline = eyeOutline(OPEN_EYE);
  assert.ok(outline.length > 20);
  for (const [x, y] of outline) assert.ok(x * x + y * y <= 1 + 1e-6, `(${x}, ${y}) is outside the eye`);
  const [cx, cy] = centroid(outline);
  assert.ok(close(cx, 0, 1e-3) && close(cy, 0, 1e-3), "a round eye is centred");
});

test("lids that meet close the eye completely", () => {
  assert.deepEqual(eyeOutline({ ...OPEN_EYE, top: 0.2, bottom: 0.1 }), []);
});

test("a half-closed lid keeps only the region below it", () => {
  const outline = eyeOutline({ ...OPEN_EYE, top: 0.3 });
  assert.ok(outline.length > 0);
  for (const [, y] of outline) assert.ok(y >= 0.3 - 1e-6);
});

test("offset and rotation move the outline without changing its size", () => {
  const base = eyeOutline(OPEN_EYE);
  const moved = eyeOutline({ ...OPEN_EYE, dx: 0.5, dy: -0.25 });
  const [bx, by] = centroid(base);
  const [mx, my] = centroid(moved);
  assert.ok(close(mx - bx, 0.5, 1e-9) && close(my - by, -0.25, 1e-9));
  const rotated = eyeOutline({ ...OPEN_EYE, rot: Math.PI / 2 });
  for (const [x, y] of rotated) assert.ok(x * x + y * y <= 1 + 1e-6);
});

test("every expression draws both eyes and a usable beam", () => {
  for (const expression of EXPRESSIONS) {
    const preset = PRESETS[expression];
    assert.ok(preset, `${expression} has a preset`);
    assert.ok(eyeOutline(preset.left).length > 0, `${expression} left eye is visible`);
    assert.ok(eyeOutline(preset.right).length > 0, `${expression} right eye is visible`);
    assert.ok(preset.beam.intensity >= 0 && preset.beam.intensity <= 1);
    for (const point of [...eyeOutline(preset.left), ...eyeOutline(preset.right)]) {
      assert.ok(Number.isFinite(point[0]) && Number.isFinite(point[1]));
    }
  }
});

test("every answer state maps to a known expression and activity", () => {
  const states = ["empty", "queued", "searching", "reading", "writing", "done", "stopped", "no-sources", "error"];
  assert.deepEqual(Object.keys(ANSWER_STATE_MOOD).sort(), [...states].sort());
  for (const { expression, activity } of Object.values(ANSWER_STATE_MOOD)) {
    assert.ok(EXPRESSIONS.includes(expression));
    assert.ok(ACTIVITIES.includes(activity));
  }
});
