"use client";

import { useEffect, useRef, useState } from "react";
import type { ChartSpec } from "@/lib/visuals";

const M = { top: 14, right: 10, bottom: 30, left: 46 };
const PIE_SIZE = 220;

function niceStep(span: number, count: number): number {
  const raw = span / Math.max(count, 1);
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
}

function scale(values: number[], includeZero = true): { min: number; max: number; ticks: number[] } {
  let min = Math.min(...values, ...(includeZero ? [0] : []));
  let max = Math.max(...values, ...(includeZero ? [0] : []));
  if (min === max) max = min + 1;
  const step = niceStep(max - min, 5);
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = min; value <= max + step / 2; value += step) ticks.push(Number(value.toPrecision(12)));
  return { min, max, ticks };
}

const color = (index: number) => `var(--viz-${(index % 6) + 1})`;

/** Per row, where each series starts and ends: side by side from 0, or stacked. */
function extents(spec: ChartSpec): { from: number; to: number }[][] {
  return spec.data.map((row) => {
    let base = 0;
    return spec.series.map((series) => {
      const value = row[series.key] as number;
      if (!spec.stacked) return { from: 0, to: value };
      const span = { from: base, to: base + value };
      base += value;
      return span;
    });
  });
}

function format(value: number, unit = ""): string {
  const abs = Math.abs(value);
  const text =
    abs >= 1e9 ? `${+(value / 1e9).toFixed(1)}B` : abs >= 1e6 ? `${+(value / 1e6).toFixed(1)}M` : abs >= 1e4 ? `${+(value / 1e3).toFixed(1)}k` : `${+value.toFixed(2)}`;
  return unit ? `${text}${unit === "%" ? "" : " "}${unit}` : text;
}

function short(label: string, max = 14): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

function Legend({ spec, labels }: { spec: ChartSpec; labels?: { name: string; detail: string }[] }) {
  const items = labels ?? spec.series.map((series) => ({ name: series.label || series.key, detail: "" }));
  if (items.length < 2 && !labels) return null;
  return (
    <ul className="chart-legend">
      {items.map((item, index) => (
        <li key={index}>
          <i style={{ background: `var(--viz-${(index % 6) + 1})` }} />
          {item.name}
          {item.detail ? <span>{item.detail}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** Draws at the real width so text keeps its size on a phone. */
function useWidth(): [React.RefObject<HTMLElement | null>, number] {
  const ref = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(560);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function Axes({ ticks, y, unit, W }: { ticks: number[]; y: (value: number) => number; unit?: string; W: number }) {
  return (
    <g className="chart-axis">
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={M.left} x2={W - M.right} y1={y(tick)} y2={y(tick)} className={tick === 0 ? "zero" : undefined} />
          <text x={M.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">
            {format(tick, unit)}
          </text>
        </g>
      ))}
    </g>
  );
}

function XLabels({ labels, x, W, H }: { labels: string[]; x: (index: number) => number; W: number; H: number }) {
  const every = Math.ceil(labels.length / Math.max(2, Math.floor(W / 70)));
  return (
    <g className="chart-axis">
      {labels.map((label, index) =>
        index % every === 0 ? (
          <text key={index} x={x(index)} y={H - M.bottom + 18} textAnchor="middle">
            {short(label, W < 420 ? 9 : 14)}
          </text>
        ) : null,
      )}
    </g>
  );
}

function Cartesian({ spec, W }: { spec: ChartSpec; W: number }) {
  const H = Math.round(Math.min(300, Math.max(190, W * 0.48)));
  const scatter = spec.type === "scatter";
  const labels = spec.data.map((row) => String(row[spec.x]));
  const spans = extents(spec);
  const { min, max, ticks } = scale(spans.flatMap((row) => row.flatMap((span) => [span.from, span.to])), !scatter);
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const y = (value: number) => M.top + plotH - ((value - min) / (max - min)) * plotH;
  const band = plotW / labels.length;
  // Scatter plots place x by value; the others give each row a band.
  const xs = scatter ? scale(spec.data.map((row) => row[spec.x] as number), false) : null;
  const x = (index: number) =>
    xs ? M.left + (((spec.data[index][spec.x] as number) - xs.min) / (xs.max - xs.min)) * plotW : M.left + band * index + band / 2;
  const name = (index: number) => spec.series[index].label || spec.series[index].key;
  const tip = (row: number, series: number) =>
    `${labels[row]} · ${name(series)}: ${format(spec.data[row][spec.series[series].key] as number, spec.unit)}`;

  let marks: React.ReactNode;
  if (spec.type === "bar") {
    const groupW = Math.min(band * 0.7, spec.stacked ? 44 : 44 * spec.series.length);
    const barW = spec.stacked ? groupW : groupW / spec.series.length;
    marks = spans.map((row, rowIndex) =>
      row.map((span, seriesIndex) => (
        <rect
          key={`${rowIndex}-${seriesIndex}`}
          x={x(rowIndex) - groupW / 2 + (spec.stacked ? 0 : barW * seriesIndex) + 1}
          y={y(Math.max(span.from, span.to))}
          width={Math.max(barW - 2, 1)}
          height={Math.max(Math.abs(y(span.to) - y(span.from)), 0.5)}
          rx={2}
          fill={color(seriesIndex)}
        >
          <title>{tip(rowIndex, seriesIndex)}</title>
        </rect>
      )),
    );
  } else {
    marks = spec.series.map((series, seriesIndex) => {
      const top = spans.map((row, rowIndex) => [x(rowIndex), y(row[seriesIndex].to)] as const);
      const line = top.map((point) => point.join(",")).join(" ");
      const bottom = spans.map((row, rowIndex) => `${x(rowIndex)},${y(row[seriesIndex].from)}`).reverse().join(" ");
      return (
        <g key={series.key}>
          {spec.type === "area" ? <polygon points={`${line} ${bottom}`} fill={color(seriesIndex)} opacity={spec.stacked ? 0.55 : 0.22} /> : null}
          {scatter ? null : <polyline points={line} fill="none" stroke={color(seriesIndex)} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />}
          {scatter || top.length <= 40
            ? top.map(([px, py], rowIndex) => (
                <circle key={rowIndex} cx={px} cy={py} r={scatter ? 4 : 3.2} fill={color(seriesIndex)} opacity={scatter ? 0.85 : 1}>
                  <title>{tip(rowIndex, seriesIndex)}</title>
                </circle>
              ))
            : null}
        </g>
      );
    });
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={spec.title || "Chart"}>
      <Axes ticks={ticks} y={y} unit={spec.unit} W={W} />
      {xs ? (
        <g className="chart-axis">
          {xs.ticks.map((tick) => (
            <text key={tick} x={M.left + ((tick - xs.min) / (xs.max - xs.min)) * plotW} y={H - M.bottom + 18} textAnchor="middle">
              {format(tick)}
            </text>
          ))}
        </g>
      ) : (
        <XLabels labels={labels} x={x} W={W} H={H} />
      )}
      {marks}
    </svg>
  );
}

/** Bars growing to the right, one row per category: long labels stay readable. */
function HorizontalBars({ spec, W }: { spec: ChartSpec; W: number }) {
  const labels = spec.data.map((row) => String(row[spec.x]));
  const spans = extents(spec);
  const { min, max, ticks } = scale(spans.flatMap((row) => row.flatMap((span) => [span.from, span.to])));
  const labelW = Math.min(150, Math.round(W * 0.3));
  const barH = spec.stacked ? 16 : Math.max(6, 16 / Math.sqrt(spec.series.length));
  const rowH = (spec.stacked ? barH : barH * spec.series.length) + 12;
  const top = 6;
  const H = top + rowH * labels.length + 24;
  const left = labelW + 8;
  const plotW = W - left - M.right;
  const x = (value: number) => left + ((value - min) / (max - min)) * plotW;
  const name = (index: number) => spec.series[index].label || spec.series[index].key;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={spec.title || "Chart"}>
      <g className="chart-axis">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={x(tick)} x2={x(tick)} y1={top} y2={H - 24} className={tick === 0 ? "zero" : undefined} />
            <text x={x(tick)} y={H - 8} textAnchor="middle">
              {format(tick, spec.unit)}
            </text>
          </g>
        ))}
        {labels.map((label, index) => (
          <text key={index} x={labelW} y={top + rowH * index + rowH / 2} dy="0.32em" textAnchor="end">
            {short(label, Math.max(8, Math.floor(labelW / 7)))}
          </text>
        ))}
      </g>
      {spans.map((row, rowIndex) =>
        row.map((span, seriesIndex) => (
          <rect
            key={`${rowIndex}-${seriesIndex}`}
            x={x(Math.min(span.from, span.to))}
            y={top + rowH * rowIndex + 6 + (spec.stacked ? 0 : barH * seriesIndex)}
            width={Math.max(Math.abs(x(span.to) - x(span.from)), 0.5)}
            height={Math.max(barH - 2, 2)}
            rx={2}
            fill={color(seriesIndex)}
          >
            <title>{`${labels[rowIndex]} · ${name(seriesIndex)}: ${format(spec.data[rowIndex][spec.series[seriesIndex].key] as number, spec.unit)}`}</title>
          </rect>
        )),
      )}
    </svg>
  );
}

function Pie({ spec }: { spec: ChartSpec }) {
  const key = spec.series[0].key;
  const rows = spec.data.map((row) => ({ label: String(row[spec.x]), value: row[key] as number }));
  const total = rows.reduce((sum, row) => sum + row.value, 0) || 1;
  const r = PIE_SIZE / 2;
  const inner = r * 0.58;
  const arc = (a0: number, a1: number) => {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (radius: number, a: number) => `${r + radius * Math.cos(a)},${r + radius * Math.sin(a)}`;
    return `M${p(r, a0)} A${r},${r} 0 ${large} 1 ${p(r, a1)} L${p(inner, a1)} A${inner},${inner} 0 ${large} 0 ${p(inner, a0)} Z`;
  };
  return (
    <div className="chart-pie">
      <svg viewBox={`0 0 ${PIE_SIZE} ${PIE_SIZE}`} role="img" aria-label={spec.title || "Chart"}>
        {rows.map((row, index) => {
          const share = row.value / total;
          const before = rows.slice(0, index).reduce((sum, item) => sum + item.value, 0) / total;
          const a0 = -Math.PI / 2 + before * Math.PI * 2;
          // A full circle cannot be one arc; stop just short of it.
          const a1 = a0 + Math.min(share, 0.9999) * Math.PI * 2;
          return share > 0 ? (
            <path key={index} d={arc(a0, a1)} fill={color(index)}>
              <title>{`${row.label}: ${format(row.value, spec.unit)} (${Math.round(share * 100)}%)`}</title>
            </path>
          ) : null;
        })}
      </svg>
      <Legend spec={spec} labels={rows.map((row) => ({ name: row.label, detail: `${Math.round((row.value / total) * 100)}%` }))} />
    </div>
  );
}

/** A small chart drawn from a validated ```chart block, with the numbers in a table for screen readers and checking. */
export function ChartBlock({ spec }: { spec: ChartSpec }) {
  const [ref, width] = useWidth();
  return (
    <figure className="visual chart">
      {spec.title ? <figcaption>{spec.title}</figcaption> : null}
      {spec.type === "pie" ? (
        <Pie spec={spec} />
      ) : (
        <>
          <div ref={ref as React.RefObject<HTMLDivElement>} className="chart-frame">
            {spec.horizontal ? <HorizontalBars spec={spec} W={width} /> : <Cartesian spec={spec} W={width} />}
          </div>
          <Legend spec={spec} />
        </>
      )}
      <details className="visual-data">
        <summary>Data</summary>
        <div className="answer-table-wrap">
          <table>
            <thead>
              <tr>
                <th>{spec.x}</th>
                {spec.series.map((series) => (
                  <th key={series.key} style={{ textAlign: "right" }}>
                    {series.label || series.key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {spec.data.map((row, index) => (
                <tr key={index}>
                  <td>{String(row[spec.x])}</td>
                  {spec.series.map((series) => (
                    <td key={series.key} style={{ textAlign: "right" }}>
                      {format(row[series.key] as number, spec.unit)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
