# @beamling/mascot

Beamling's mascot: two eyes made of light in a dark room. There is no body. Each eye and its beam are one flat shape of light, so you can't tell the source from its light.

Beamling floats inside an imaginary room (a box) seen through a perspective camera. Both eyes look at one point, and light leaves each eye perpendicular to it, like a flashlight. Looking straight at you, the beams point at the viewer and only the eyes show. Turned 90° toward a wall, the beams run parallel to the floor. Each beam stops where it meets the floor, a wall or the ceiling. Each mood sets where Beamling looks, mostly down at the floor in front, so the beams show at rest. The `room` option draws the room's faint edges.

- **No light simulation.** Each eye's outline is pushed through the room in 3D and projected, and the light is drawn as one SVG path per eye. A frame costs about 0.15 ms.
- **Light runtime.** No dependencies, about 6 kB gzipped. Renders on the server and animates on the client.
- **Sleeps when idle.** The animation runs only while something moves. Between blinks and glances it sleeps until the next event, and it skips DOM writes when nothing changed. The slow `sleepy` drift redraws at about 20 fps instead of every frame. It pauses off screen and in hidden tabs.
- **Mark.** With `beams={false}`, it's a flat eyes-only mark facing the viewer.
- **Motion.** 12 expressions × 6 activities, spring-morphed: blinks, glances, searchlight sweeps, reading saccades, typing flicker, looking around the room.
- **Reduced motion.** Respects `prefers-reduced-motion` (or the `reducedMotion` option): static poses, no blinking, drifting or pointer following. An explicit `lookAt()` still turns the eyes, without animation, and they return to centre when it ends.

## Usage

### React / Next.js

```tsx
import { BeamlingMascot } from "@beamling/mascot/react";

<BeamlingMascot state="searching" style={{ width: 240 }} />            // spec §16.4 answer states
<BeamlingMascot expression="happy" activity="idle" followPointer />
<BeamlingMascot beams={false} label="" style={{ width: 28 }} />          // small mark next to the wordmark
```

Props: `state`, `expression`, `activity`, `beams` (default `true`), `followPointer`, `blink` (spontaneous blinking, default `true`), `label` (`""` for decorative), `reducedMotion` (`"auto"` follows the media query, or `true`/`false`), `room`, `className`, `style`. Changing `beams`, `label`, `room` or `reducedMotion` rebuilds the scene from the current expression; the other props are applied in place.

Imperative extras through `ref`: `blink()`, `pulse(strength)` (e.g. when a citation arrives), `lookAt(x, y)`.

### Any page (custom element)

```html
<script type="module">import "@beamling/mascot/define";</script>
<beamling-mascot expression="curious" activity="thinking" follow-pointer style="width: 320px"></beamling-mascot>
```

A bare specifier like `@beamling/mascot/define` needs a bundler or an [import map](https://developer.mozilla.org/docs/Web/HTML/Element/script/type/importmap); without one, import the file by URL.

Attributes: `expression`, `activity`, `beams="false"`, `follow-pointer`, `no-blink`, `label`, `room`. Use `el.mascot` for the engine.

The element is browser-only. `@beamling/mascot/element` can be imported on the server (nothing runs there), and `defineBeamlingElement(tag)` is a no-op there. In the browser it can register more than one tag name; each extra tag gets its own subclass.

### Vanilla

```ts
import { Beamling } from "@beamling/mascot";
const b = new Beamling(container, { expression: "neutral" });
b.setActivity("searching");
```

`Beamling` needs the DOM; on the server use `markup(options)` for a static SVG string, which the engine reuses when mounted on the same container with the same `beams` and `room`. `DEFAULTS`, `isExpression()` and `isActivity()` are exported for validating input.

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
pnpm install                           # also builds dist/ (prepare script)
pnpm --filter @beamling/mascot dev     # demo at http://localhost:5173
pnpm --filter @beamling/mascot build   # dist/ (ESM + .d.ts)
pnpm --filter @beamling/mascot watch   # rebuild dist/ on change, for packages/web
```

Tuning a shape or a mood's gaze (`look`) means editing `src/expressions.ts`. Camera, room size and head constants (perspective, turn range) live at the top of `src/scene.ts`. Eyes are written for the left eye, with x pointing toward the nose, and are mirrored for the right eye. Lids are parabolas: `y = h + tilt·x + curve·x²`.
