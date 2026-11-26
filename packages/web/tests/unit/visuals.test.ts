import assert from "node:assert/strict";
import { test } from "node:test";
import { DOCUMENT_CLOSE, DOCUMENT_OPEN, documentFileName, documentTitle, fenceLanguage, parseChart, VISUAL_LIMITS } from "../../lib/visuals";

test("the fence language is the first word of the info string", () => {
  assert.equal(fenceLanguage("```ts"), "ts");
  assert.equal(fenceLanguage("``` Python title=x"), "python");
  assert.equal(fenceLanguage("```"), "");
  assert.equal(fenceLanguage("```c++"), "c++");
  assert.equal(fenceLanguage("```<script>"), "script");
});

test("charts must match the schema and use numbers for every series", () => {
  const valid = { type: "bar", x: "year", series: [{ key: "v" }], data: [{ year: "2024", v: 1 }, { year: "2025", v: 2.5 }] };
  assert.ok(parseChart(JSON.stringify(valid)));
  assert.equal(parseChart("not json"), null);
  assert.equal(parseChart(JSON.stringify({ ...valid, type: "radar" })), null);
  assert.equal(parseChart(JSON.stringify({ ...valid, extra: true })), null);
  assert.equal(parseChart(JSON.stringify({ ...valid, data: [{ year: "2024", v: "1" }] })), null);
  assert.equal(parseChart(JSON.stringify({ ...valid, data: [{ v: 1 }] })), null);
  assert.equal(parseChart(JSON.stringify({ ...valid, data: [] })), null);
  const rows = Array.from({ length: VISUAL_LIMITS.chartRows + 1 }, (_, i) => ({ year: String(i), v: i }));
  assert.equal(parseChart(JSON.stringify({ ...valid, data: rows })), null);
  const series = Array.from({ length: VISUAL_LIMITS.chartSeries + 1 }, (_, i) => ({ key: `s${i}` }));
  assert.equal(parseChart(JSON.stringify({ ...valid, series })), null);
  assert.equal(parseChart(" ".repeat(VISUAL_LIMITS.blockChars + 1)), null);
});

test("pie charts take one series of non-negative values", () => {
  const pie = { type: "pie", x: "name", series: [{ key: "v" }], data: [{ name: "a", v: 1 }, { name: "b", v: 0 }] };
  assert.ok(parseChart(JSON.stringify(pie)));
  assert.equal(parseChart(JSON.stringify({ ...pie, data: [{ name: "a", v: -1 }] })), null);
  assert.equal(parseChart(JSON.stringify({ ...pie, series: [{ key: "v" }, { key: "w" }] })), null);
});

test("stacks, horizontal bars and scatter plots follow their own rules", () => {
  const bar = { type: "bar", x: "name", series: [{ key: "a" }, { key: "b" }], data: [{ name: "x", a: 1, b: 2 }] };
  assert.ok(parseChart(JSON.stringify({ ...bar, stacked: true, horizontal: true })));
  assert.ok(parseChart(JSON.stringify({ ...bar, type: "area", stacked: true })));
  assert.equal(parseChart(JSON.stringify({ ...bar, type: "line", stacked: true })), null);
  assert.equal(parseChart(JSON.stringify({ ...bar, type: "area", horizontal: true })), null);
  assert.equal(parseChart(JSON.stringify({ ...bar, stacked: true, data: [{ name: "x", a: -1, b: 2 }] })), null);
  const scatter = { type: "scatter", x: "price", series: [{ key: "sales" }], data: [{ price: 2, sales: 10 }, { price: 3.5, sales: 7 }] };
  assert.ok(parseChart(JSON.stringify(scatter)));
  assert.equal(parseChart(JSON.stringify({ ...scatter, data: [{ price: "cheap", sales: 10 }] })), null);
});

test("document markers, titles and file names", () => {
  assert.equal(DOCUMENT_OPEN.exec('<document title="Trip plan">')?.[1], "Trip plan");
  assert.ok(DOCUMENT_OPEN.test("<document>"));
  assert.equal(DOCUMENT_OPEN.test('text <document title="x">'), false);
  assert.ok(DOCUMENT_CLOSE.test("</document>"));
  assert.equal(documentTitle("  "), "Document");
  assert.equal(documentTitle(" A\n  plan "), "A plan");
  assert.equal(documentFileName("Piano: viaggio a Roma!"), "piano-viaggio-a-roma.md");
  assert.equal(documentFileName("???"), "document.md");
});
