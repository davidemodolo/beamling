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

function scale(values: number[]): { min: number; max: number; ticks: number[] } {
  let min = Math.min(0, ...values);
  let max = Math.max(0, ...values);
  if (min === max) max = min + 1;
  const step = niceStep(max - min, 5);
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = min; value <= max + step / 2; value += step) ticks.push(Number(value.toPrecision(12)));
  return { min, max, ticks };
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

function BarOrLine({ spec, W }: { spec: ChartSpec; W: number }) {
  const H = Math.round(Math.min(300, Math.max(190, W * 0.48)));
  const labels = spec.data.map((row) => String(row[spec.x]));
  const values = spec.data.flatMap((row) => spec.series.map((series) => row[series.key] as number));
  const { min, max, ticks } = scale(values);
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const y = (value: number) => M.top + plotH - ((value - min) / (max - min)) * plotH;
  const band = plotW / labels.length;
  const x = (index: number) => M.left + band * index + band / 2;
  const name = (index: number) => spec.series[index].label || spec.series[index].key;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={spec.title || "Chart"}>
      <Axes ticks={ticks} y={y} unit={spec.unit} W={W} />
      <XLabels labels={labels} x={x} W={W} H={H} />
      {spec.type === "bar"
        ? spec.data.map((row, rowIndex) => {
            const groupW = Math.min(band * 0.7, 44 * spec.series.length);
            const barW = groupW / spec.series.length;
            return spec.series.map((series, seriesIndex) => {
              const value = row[series.key] as number;
              const top = y(Math.max(value, 0));
              const height = Math.max(Math.abs(y(value) - y(0)), 0.5);
              return (
                <rect
                  key={`${rowIndex}-${seriesIndex}`}
                  x={x(rowIndex) - groupW / 2 + barW * seriesIndex + 1}
                  y={top}
                  width={Math.max(barW - 2, 1)}
                  height={height}
                  rx={2}
                  fill={`var(--viz-${(seriesIndex % 6) + 1})`}
                >
                  <title>{`${labels[rowIndex]} · ${name(seriesIndex)}: ${format(value, spec.unit)}`}</title>
                </rect>
              );
            });
          })
        : spec.series.map((series, seriesIndex) => {
            const points = spec.data.map((row, rowIndex) => [x(rowIndex), y(row[series.key] as number)] as const);
            const color = `var(--viz-${(seriesIndex % 6) + 1})`;
            return (
              <g key={series.key}>
                <polyline points={points.map((point) => point.join(",")).join(" ")} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
                {points.length <= 40
                  ? points.map(([px, py], rowIndex) => (
                      <circle key={rowIndex} cx={px} cy={py} r={3.2} fill={color}>
                        <title>{`${labels[rowIndex]} · ${name(seriesIndex)}: ${format(spec.data[rowIndex][series.key] as number, spec.unit)}`}</title>
                      </circle>
                    ))
                  : null}
              </g>
            );
          })}
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
            <path key={index} d={arc(a0, a1)} fill={`var(--viz-${(index % 6) + 1})`}>
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
            <BarOrLine spec={spec} W={width} />
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
