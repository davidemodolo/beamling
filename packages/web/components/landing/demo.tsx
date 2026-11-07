"use client";

import { useEffect, useRef, useState } from "react";
import { Mascot } from "@/components/mascot";
import { Icon } from "@/components/ui/icon";
import type { ChatStage } from "@/lib/types";

const ANSWER =
  "The Act is being phased in, not switched on at once. The high-risk obligations in Annex III apply from 2 August 2026 [1][2], while general-purpose model duties started earlier, in August 2025 [3].";

const SOURCES = [
  { n: 1, domain: "artificialintelligenceact.eu", title: "Implementation timeline" },
  { n: 2, domain: "eur-lex.europa.eu", title: "Regulation (EU) 2024/1689" },
  { n: 3, domain: "digital-strategy.ec.europa.eu", title: "Regulatory framework for AI" },
];

const LABELS: Record<string, string> = {
  queued: "Understanding the question",
  searching: "Searching with Brave",
  reading: "Reading 3 sources",
  writing: "Writing with Gemma 4 31B",
  done: "Done · 2.4 s · free tier",
};

export function LandingDemo({ host }: { host: string }) {
  const [stage, setStage] = useState<ChatStage>("done");
  const [written, setWritten] = useState(ANSWER);
  const [visibleSources, setVisibleSources] = useState(SOURCES.length);
  const timers = useRef<number[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const played = useRef(false);

  const clear = () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  };

  const play = () => {
    clear();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStage("done");
      setWritten(ANSWER);
      setVisibleSources(SOURCES.length);
      return;
    }
    setStage("queued");
    setWritten("");
    setVisibleSources(0);
    // Every step is scheduled up front, each `ms` after the previous one.
    let at = 0;
    const step = (fn: () => void, ms: number) => {
      at += ms;
      timers.current.push(window.setTimeout(fn, at));
    };
    step(() => setStage("searching"), 350);
    step(() => setVisibleSources(1), 500);
    step(() => setVisibleSources(3), 700);
    step(() => setStage("reading"), 950);
    step(() => setStage("writing"), 800);
    const words = ANSWER.split(" ");
    words.forEach((_, index) => {
      step(() => setWritten(words.slice(0, index + 1).join(" ")), 24 + (index % 4) * 9);
    });
    step(() => setStage("done"), 260);
  };

  useEffect(() => clear, []);

  useEffect(() => {
    const node = rootRef.current;
    if (!node || played.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || played.current) return;
        played.current = true;
        timers.current.push(window.setTimeout(play, 450));
        observer.disconnect();
      },
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => observer.disconnect();
    // Play once, when the preview first becomes visible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={rootRef} className="ld">
      <div className="ld-window">
        <div className="ld-chrome">
          <span className="ld-dot" />
          <span className="ld-dot" />
          <span className="ld-dot" />
          <span className="ld-host">{host} / new question</span>
          <span className="ld-mode">Quick · Brave</span>
        </div>
        <div className="ld-body">
          <p className="ld-question">What changes in the EU AI Act in 2026?</p>
          <div className="ld-status">
            <span className="ld-mascot" aria-hidden="true">
              <Mascot state={stage} label="" style={{ width: 58 }} />
            </span>
            <span className="ld-stage">
              <span className="ld-live" aria-hidden="true">
                {stage !== "done" ? <span className="ld-pulse" /> : null}
              </span>
              {LABELS[stage]}
            </span>
            <button type="button" className="ld-replay" onClick={play}>
              <Icon name="refresh" size={12} />
              {stage === "done" ? "Replay" : "Run"}
            </button>
          </div>
          <p className={`ld-answer ${stage === "writing" ? "is-writing" : ""}`}>
            {written ? (
              <>
                {written.split(/(\[\d+\])/).map((part, index) =>
                  /^\[\d+\]$/.test(part) ? (
                    <span className="ld-cite" key={index}>
                      {part.slice(1, -1)}
                    </span>
                  ) : (
                    <span key={index}>{part}</span>
                  ),
                )}
                {stage === "writing" ? <span className="cursor" aria-hidden="true" /> : null}
              </>
            ) : (
              <span className="ld-skeleton">
                <span />
                <span />
                <span />
              </span>
            )}
          </p>
          <div className="ld-sources" aria-hidden="true">
            {SOURCES.slice(0, visibleSources).map((source) => (
              <span className="ld-source" key={source.n}>
                <span className="ld-source-n">{source.n}</span>
                <span>
                  <strong>{source.title}</strong>
                  <em>{source.domain}</em>
                </span>
              </span>
            ))}
            {visibleSources < SOURCES.length ? <span className="ld-loading">Reading sources…</span> : null}
          </div>
        </div>
      </div>
      <p className="ld-caption">
        A scripted preview. In the product, this streams from your provider with live retrieval.
      </p>
    </div>
  );
}
