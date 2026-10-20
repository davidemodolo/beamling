import { Beamling, DEFAULTS, isActivity } from "./engine.js";
import { isExpression } from "./expressions.js";

const ATTRS = ["expression", "activity", "beams", "follow-pointer", "no-blink", "label", "room"] as const;

/**
 * `HTMLElement` does not exist on the server. Importing this module there is
 * harmless: the class is only usable (and only defined) in a browser.
 */
const Base = (typeof HTMLElement === "undefined" ? class {} : HTMLElement) as typeof HTMLElement;

/**
 * `<beamling-mascot expression="happy" activity="searching" follow-pointer>`
 *
 * Framework-agnostic custom element. Size it with CSS `width`; the height
 * follows the aspect ratio. The colour comes from `--beamling-light`.
 */
export class BeamlingElement extends Base {
  static observedAttributes = [...ATTRS];
  private engine: Beamling | null = null;
  private root: ShadowRoot;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
    this.root.innerHTML = `<style>:host{display:inline-block;width:240px;line-height:0;contain:layout paint}div{width:100%}</style><div></div>`;
  }

  get mascot(): Beamling | null {
    return this.engine;
  }

  connectedCallback() {
    this.build();
  }

  disconnectedCallback() {
    this.engine?.destroy();
    this.engine = null;
  }

  attributeChangedCallback(name: string, prev: string | null, next: string | null) {
    if (!this.engine || prev === next) return;
    switch (name) {
      case "expression":
        if (isExpression(next)) this.engine.setExpression(next);
        break;
      case "activity":
        if (isActivity(next)) this.engine.setActivity(next);
        break;
      case "follow-pointer":
        this.engine.setFollowPointer(next !== null);
        break;
      case "no-blink":
        this.engine.setBlinking(next === null);
        break;
      default:
        // beams, label and room change the markup: rebuild.
        this.build();
    }
  }

  private build() {
    this.engine?.destroy();
    const host = this.root.querySelector("div")!;
    host.innerHTML = "";
    const expression = this.getAttribute("expression");
    const activity = this.getAttribute("activity");
    this.engine = new Beamling(host, {
      expression: isExpression(expression) ? expression : DEFAULTS.expression,
      activity: isActivity(activity) ? activity : DEFAULTS.activity,
      beams: this.getAttribute("beams") !== "false",
      followPointer: this.hasAttribute("follow-pointer"),
      blink: !this.hasAttribute("no-blink"),
      label: this.getAttribute("label") ?? DEFAULTS.label,
      room: this.hasAttribute("room"),
    });
  }
}

let baseDefined = false;

/**
 * Registers the element under `tag` (browser only; a no-op on the server).
 * The first registration uses `BeamlingElement` itself; other tags get their
 * own subclass, since one constructor can be registered only once.
 */
export function defineBeamlingElement(tag = "beamling-mascot") {
  if (typeof customElements === "undefined" || customElements.get(tag)) return;
  const taken = baseDefined || customElements.getName?.(BeamlingElement) != null;
  customElements.define(tag, taken ? class extends BeamlingElement {} : BeamlingElement);
  baseDefined = true;
}

declare global {
  interface HTMLElementTagNameMap {
    "beamling-mascot": BeamlingElement;
  }
}
