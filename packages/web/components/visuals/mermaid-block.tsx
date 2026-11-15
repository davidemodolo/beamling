"use client";

import { useEffect, useId, useState } from "react";
import { VISUAL_LIMITS } from "@/lib/visuals";
import { CodeBlock } from "./code-block";

type Renderer = (id: string, source: string) => Promise<string>;

let loading: Promise<Renderer> | null = null;

/**
 * Mermaid and DOMPurify load only when an answer has a diagram. Strict security level, no HTML
 * labels and no click handlers; the SVG is sanitized again before it is inserted. The CSP blocks
 * any remote URL a diagram might reference.
 */
function loadRenderer(): Promise<Renderer> {
  loading ??= Promise.all([import("mermaid"), import("dompurify")]).then(([{ default: mermaid }, { default: DOMPurify }]) => {
    const css = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      htmlLabels: false,
      suppressErrorRendering: true,
      maxTextSize: VISUAL_LIMITS.blockChars,
      maxEdges: 200,
      // Natural size, scrolled sideways when wider than the answer, so labels stay readable on a phone.
      ...Object.fromEntries(
        ["flowchart", "sequence", "timeline", "mindmap", "gantt", "er", "state", "class", "journey", "pie", "quadrantChart", "xyChart", "sankey"].map((name) => [name, { useMaxWidth: false }]),
      ),
      theme: "base",
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      themeVariables: {
        darkMode: true,
        background: token("--surface", "#151516"),
        primaryColor: token("--raised", "#1f1f21"),
        primaryTextColor: token("--text", "#f4f1ea"),
        primaryBorderColor: token("--beam", "#ffc86b"),
        secondaryColor: token("--surface-2", "#1a1a1c"),
        tertiaryColor: token("--surface", "#151516"),
        lineColor: token("--muted", "#a3a3a7"),
        textColor: token("--text", "#f4f1ea"),
        mainBkg: token("--raised", "#1f1f21"),
        nodeBorder: token("--beam", "#ffc86b"),
        clusterBkg: token("--surface-2", "#1a1a1c"),
        clusterBorder: token("--line-strong", "#3c3c40"),
        noteBkgColor: token("--surface-2", "#1a1a1c"),
        noteTextColor: token("--text", "#f4f1ea"),
        noteBorderColor: token("--line-strong", "#3c3c40"),
        edgeLabelBackground: token("--surface", "#151516"),
        fontSize: "14px",
      },
    });
    return async (id: string, source: string) => {
      const { svg } = await mermaid.render(id, source);
      return DOMPurify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        ADD_TAGS: ["style"],
        FORBID_TAGS: ["foreignObject", "a", "script", "image", "use"],
        FORBID_ATTR: ["href", "xlink:href"],
      });
    };
  });
  return loading;
}

type State = { status: "drawing" } | { status: "done"; svg: string } | { status: "failed" };

/** A ```mermaid block drawn as a diagram; on any error the source is shown as code. */
export function MermaidBlock({ source }: { source: string }) {
  const id = `mmd-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  const [state, setState] = useState<{ source: string; value: State } | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadRenderer()
      .then((render) => render(id, source))
      .then(
        (svg) => !cancelled && setState({ source, value: svg ? { status: "done", svg } : { status: "failed" } }),
        () => !cancelled && setState({ source, value: { status: "failed" } }),
      );
    return () => {
      cancelled = true;
      // Mermaid leaves a measuring node behind when a render fails.
      document.getElementById(`d${id}`)?.remove();
    };
  }, [id, source]);

  const value: State = state?.source === source ? state.value : { status: "drawing" };
  if (value.status === "failed") return <CodeBlock code={source} language="mermaid" note="Could not draw this diagram" />;
  if (value.status === "drawing") return <div className="visual visual-pending">Drawing…</div>;
  return (
    <figure className="visual diagram">
      {/* Sanitized SVG from Mermaid in strict mode, see loadRenderer. */}
      <div className="diagram-svg" role="img" aria-label="Diagram" tabIndex={0} dangerouslySetInnerHTML={{ __html: value.svg }} />
      <details className="visual-data">
        <summary>Source</summary>
        <CodeBlock code={source} language="mermaid" />
      </details>
    </figure>
  );
}
