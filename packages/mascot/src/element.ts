import { ACTIVITIES, Beamling, type Activity } from "./engine.js";
import { EXPRESSIONS, type Expression } from "./expressions.js";

const ATTRS = ["expression", "activity", "beams", "follow-pointer", "no-blink", "label", "room"] as const;

/**
 * `<beamling-mascot expression="happy" activity="searching" follow-pointer>`
 *
 * Framework-agnostic custom element. Size it with CSS `width`; the height
 * follows the aspect ratio. The colour comes from `--beamling-light`.
 */
export class BeamlingElement extends HTMLElement {
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
        if (EXPRESSIONS.includes(next as Expression)) this.engine.setExpression(next as Expression);
        break;
      case "activity":
        if (ACTIVITIES.includes(next as Activity)) this.engine.setActivity(next as Activity);
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
    const expression = this.getAttribute("expression") as Expression | null;
    const activity = this.getAttribute("activity") as Activity | null;
    this.engine = new Beamling(host, {
      expression: expression && EXPRESSIONS.includes(expression) ? expression : "neutral",
      activity: activity && ACTIVITIES.includes(activity) ? activity : "idle",
      beams: this.getAttribute("beams") !== "false",
      followPointer: this.hasAttribute("follow-pointer"),
      blink: !this.hasAttribute("no-blink"),
      label: this.getAttribute("label") ?? "Beamling",
      room: this.hasAttribute("room"),
    });
  }
}

export function defineBeamlingElement(tag = "beamling-mascot") {
  if (typeof customElements !== "undefined" && !customElements.get(tag)) customElements.define(tag, BeamlingElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "beamling-mascot": BeamlingElement;
  }
}
