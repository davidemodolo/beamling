import { Component, type ReactNode } from "react";
import { Icon } from "../ui/icon";
import { CodeBlock } from "./code-block";

/** A chart or diagram the model wrote wrong: collapsed, with its source one click away. */
export function VisualError({ code, language, detail }: { code: string; language: string; detail: string }) {
  return (
    <details className="visual visual-error">
      <summary>
        <Icon name="alert" size={13} /> Rendering error <span>{detail}</span>
      </summary>
      <CodeBlock code={code} language={language} />
    </details>
  );
}

/** Shows a VisualError if drawing a block throws, instead of breaking the whole answer. */
export class VisualBoundary extends Component<{ code: string; language: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) return <VisualError code={this.props.code} language={this.props.language} detail="The chart could not be drawn." />;
    return this.props.children;
  }
}
