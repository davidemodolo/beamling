"use client";

import { useEffect, useState, type ReactNode } from "react";
import { copyText } from "@/lib/clipboard";
import { Icon } from "../ui/icon";

type HastNode = { type: string; value?: string; tagName?: string; properties?: { className?: string[] }; children?: HastNode[] };
type Lowlight = typeof import("@/lib/highlight").lowlight;

let loading: Promise<Lowlight> | null = null;
function loadHighlighter(): Promise<Lowlight> {
  loading ??= import("@/lib/highlight").then((module) => module.lowlight);
  return loading;
}

/** Highlighted tokens as React nodes: only text and span class names come from the tree, never HTML. */
function toReact(nodes: HastNode[], key: string): ReactNode[] {
  return nodes.map((node, index) => {
    const k = `${key}-${index}`;
    if (node.type === "text") return node.value ?? "";
    if (node.type === "element") {
      const className = (node.properties?.className ?? []).filter((name) => /^hljs-[\w-]+$/.test(name)).join(" ");
      return (
        <span key={k} className={className || undefined}>
          {toReact(node.children ?? [], k)}
        </span>
      );
    }
    return null;
  });
}

function useHighlighted(code: string, language: string, enabled: boolean): ReactNode[] | null {
  const [state, setState] = useState<{ key: string; nodes: ReactNode[] } | null>(null);
  const key = `${language}\n${code}`;
  useEffect(() => {
    if (!enabled || !language) return;
    let cancelled = false;
    loadHighlighter()
      .then((lowlight) => {
        if (cancelled || !lowlight.registered(language)) return;
        const tree = lowlight.highlight(language, code) as unknown as { children: HastNode[] };
        setState({ key, nodes: toReact(tree.children, "h") });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [code, language, enabled, key]);
  return state?.key === key ? state.nodes : null;
}

export function CopyButton({ text, label = "Copy code" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm code-copy"
      onClick={async () => setCopied(await copyText(text))}
      aria-label={copied ? "Copied" : label}
    >
      <Icon name={copied ? "check" : "copy"} size={12} />
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

/** A fenced code block: language label, copy button and highlighting once the block is complete. */
export function CodeBlock({ code, language, closed = true, note }: { code: string; language: string; closed?: boolean; note?: string }) {
  const highlighted = useHighlighted(code, language, closed);
  return (
    <div className="code-block">
      <div className="code-head">
        <span className="code-lang">{language || "text"}</span>
        {note ? <span className="code-note">{note}</span> : null}
        <span className="spacer" />
        <CopyButton text={code} />
      </div>
      <pre>
        <code>{highlighted ?? code}</code>
      </pre>
    </div>
  );
}
