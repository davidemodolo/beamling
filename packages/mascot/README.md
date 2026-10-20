# @beamling/mascot

Beamling's mascot: two eyes made of light in a dark room. There is no body. Each eye and its beam are one flat shape of light, so you can't tell the source from its light.

Beamling floats inside an imaginary room (a box) seen through a perspective camera. Both eyes look at one point, and light leaves each eye perpendicular to it, like a flashlight. Looking straight at you, the beams point at the viewer and only the eyes show. Turned 90° toward a wall, the beams run parallel to the floor. Each beam stops where it meets the floor, a wall or the ceiling. Each mood sets where Beamling looks, mostly down at the floor in front, so the beams show at rest. The `room` option draws the room's faint edges.

- **No light simulation.** Each eye's outline is pushed through the room in 3D and projected, and the light is drawn as one SVG path per eye. A frame costs about 0.15 ms.
- **Light runtime.** No dependencies, about 6 kB gzipped. Renders on the server and animates on the client.
- **Sleeps when idle.** The animation runs only while something moves. Between blinks and glances it sleeps until the next event, and it skips DOM writes when nothing changed. It pauses off screen and in hidden tabs.
- **Mark.** With `beams={false}`, it's an eyes-only mark with a soft glow, facing the viewer.
- **Motion.** 12 expressions × 6 activities, spring-morphed: blinks, glances, searchlight sweeps, reading saccades, typing flicker, looking around the room.
- **Reduced motion.** Respects `prefers-reduced-motion`: static poses, no blinking or drifting.

## Usage

### React / Next.js

```tsx
import { BeamlingMascot } from "@beamling/mascot/react";

<BeamlingMascot state="searching" style={{ width: 240 }} />            // spec §16.4 answer states
<BeamlingMascot expression="happy" activity="idle" followPointer />
<BeamlingMascot beams={false} label="" style={{ width: 28 }} />          // small mark next to the wordmark
```

Imperative extras through `ref`: `blink()`, `pulse(strength)` (e.g. when a citation arrives), `lookAt(x, y)`.

### Any page (custom element)

```html
<script type="module">import "@beamling/mascot/define";</script>
<beamling-mascot expression="curious" activity="thinking" follow-pointer style="width: 320px"></beamling-mascot>
```

Attributes: `expression`, `activity`, `beams="false"`, `follow-pointer`, `no-blink`, `label`, `room`. Use `el.mascot` for the engine.

### Vanilla

```ts
import { Beamling } from "@beamling/mascot";
const b = new Beamling(container, { expression: "neutral" });
b.setActivity("searching");
```

## Vocabulary

| Expressions | neutral, happy, curious, suspicious, angry, sad, surprised, sleepy, playful, confused, focused, shy |
|---|---|
| Activities | idle, thinking, searching (searchlight sweep), reading (saccades), writing (keystroke flicker), exploring (looks around the room) |

| Answer state | Expression · activity |
|---|---|
| empty | neutral · idle |
| queued | curious · thinking |
| searching | focused · searching |
| reading | focused · reading |
| writing | neutral · writing |
| done | happy · idle |
| stopped | sleepy · idle |
| no-sources | confused · idle |
| error | sad · idle |

## Theming

The background is transparent. The mascot is designed for dark surfaces (brand Ink `#0A0C10`). The colour comes from one CSS custom property, because eye and beam are the same light:

```css
--beamling-light: #FFD98A;
```

`--beamling-room` sets the colour of the room edges.

## Development

```sh
pnpm install
pnpm --filter @beamling/mascot dev     # demo at http://localhost:5173
pnpm --filter @beamling/mascot build   # dist/ (ESM + .d.ts)
```

Tuning a shape or a mood's gaze (`look`) means editing `src/expressions.ts`. Camera, room size and head constants (perspective, turn range) live at the top of `src/scene.ts`. Eyes are written for the left eye, with x pointing toward the nose, and are mirrored for the right eye. Lids are parabolas: `y = h + tilt·x + curve·x²`.
