import { ACTIVITIES, ANSWER_STATE_MOOD, EXPRESSIONS, type AnswerState } from "../src/index.js";
import type { BeamlingElement } from "../src/element.js";
import "../src/define.js";

const hero = document.getElementById("hero") as BeamlingElement;
const caption = document.getElementById("caption")!;
const flow = document.getElementById("flow")!;

function chips(containerId: string, values: readonly string[], attr: "expression" | "activity") {
  const box = document.getElementById(containerId)!;
  for (const v of values) {
    const b = document.createElement("button");
    b.textContent = v;
    b.dataset.value = v;
    b.addEventListener("click", () => {
      stopSimulation();
      hero.setAttribute(attr, v);
      sync();
    });
    box.append(b);
  }
}

function sync() {
  const e = hero.getAttribute("expression") ?? "neutral";
  const a = hero.getAttribute("activity") ?? "idle";
  caption.textContent = `${e} · ${a}`;
  for (const b of document.querySelectorAll<HTMLButtonElement>("#expressions button")) b.ariaPressed = String(b.dataset.value === e);
  for (const b of document.querySelectorAll<HTMLButtonElement>("#activities button")) b.ariaPressed = String(b.dataset.value === a);
}

chips("expressions", EXPRESSIONS, "expression");
chips("activities", ACTIVITIES, "activity");
sync();

const grid = document.getElementById("grid")!;
for (const e of EXPRESSIONS) {
  const fig = document.createElement("figure");
  const m = document.createElement("beamling-mascot");
  m.setAttribute("expression", e);
  m.setAttribute("label", "");
  const cap = document.createElement("figcaption");
  cap.textContent = e;
  fig.append(m, cap);
  grid.append(fig);
}

// Walk through the answer states from the spec.
let timers: number[] = [];
function stopSimulation() {
  timers.forEach(clearTimeout);
  timers = [];
}
function run(steps: [AnswerState, number, string][]) {
  stopSimulation();
  let at = 0;
  for (const [state, duration, text] of steps) {
    timers.push(
      window.setTimeout(() => {
        const mood = ANSWER_STATE_MOOD[state];
        hero.setAttribute("expression", mood.expression);
        hero.setAttribute("activity", mood.activity);
        flow.textContent = text;
        sync();
      }, at),
    );
    at += duration;
  }
}
document.getElementById("simulate")!.addEventListener("click", () => {
  run([
    ["queued", 1200, "Queued: thinking about the question."],
    ["searching", 3200, "Searching the web: the beams sweep like a searchlight."],
    ["reading", 3600, "Reading sources: short saccades along each line."],
    ["writing", 3500, "Writing: the light flickers with each token."],
    ["done", 3000, "Done: a little light on every answer."],
    ["empty", 0, "Back to idle."],
  ]);
  for (let i = 0; i < 4; i++) timers.push(window.setTimeout(() => hero.mascot?.pulse(), 4600 + i * 700));
});
document.getElementById("simulate-error")!.addEventListener("click", () => {
  run([
    ["queued", 1000, "Queued."],
    ["searching", 2400, "Searching the web..."],
    ["no-sources", 3000, "No sources: not enough reliable sources to support an answer."],
    ["error", 3500, "Error: that key was rejected by the provider."],
    ["empty", 0, "Back to idle."],
  ]);
});
for (const [id, attr] of [
  ["toggle-room", "room"],
  ["toggle-pointer", "follow-pointer"],
] as const) {
  const b = document.getElementById(id) as HTMLButtonElement;
  b.addEventListener("click", () => {
    hero.toggleAttribute(attr);
    b.ariaPressed = String(hero.hasAttribute(attr));
  });
}
document.getElementById("blink")!.addEventListener("click", () => hero.mascot?.blink());
document.getElementById("pulse")!.addEventListener("click", () => hero.mascot?.pulse(0.5));
