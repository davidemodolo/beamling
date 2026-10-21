#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "packages/web/lib/generated/licenses.json");
const allowed = [
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MIT",
  "MIT-0",
  "OFL-1.1",
];
const exceptions = {
  "CC-BY-4.0": {
    packages: ["caniuse-lite"],
    reason:
      "Browser support data used at build time. Attribution is included on this page; the data is not part of Beamling's application source.",
    notice: "caniuse-lite data is maintained by the Can I Use project and licensed under CC BY 4.0 (https://caniuse.com).",
  },
};
const licenseFileNames = new Set([
  "license",
  "license.md",
  "license.txt",
  "licence",
  "licence.md",
  "copying",
  "copying.md",
  "notice",
]);
const maxText = 20000;
const maxNotice = 1500;

function normaliseVersion(version) {
  return typeof version === "string" ? version : "";
}

function normaliseHomepage(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function normaliseAuthor(value) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && typeof value.name === "string") return value.name.trim();
  return "";
}

function readLicenseFiles(paths) {
  const files = [];
  for (const packagePath of paths) {
    if (typeof packagePath !== "string" || !existsSync(packagePath)) continue;
    let names;
    try {
      names = readdirSync(packagePath);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!licenseFileNames.has(name.toLowerCase())) continue;
      try {
        const text = readFileSync(join(packagePath, name), "utf8").trim().slice(0, maxText);
        if (text) files.push({ name: name.toLowerCase(), text });
      } catch {}
    }
  }
  return files;
}

function noticeFor(files, author, exception) {
  const notices = [];
  for (const file of files) {
    if (file.name === "notice") {
      const body = file.text.split(/\r?\n/).slice(0, 25).join("\n").trim();
      if (body) notices.push(body);
      continue;
    }
    const lines = file.text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line.length < 240)
      .filter((line) => !/<year>|\[yyyy\]|<copyright holders>/i.test(line))
      .filter((line) => /\bCopyright\b|©/i.test(line))
      .filter((line) => !/copyright\s+(owner|notice|holder|law|interest|license)|subject to copyright|limitation to copyright|original works/i.test(line))
      .filter((line) => /\b(19|20)\d{2}\b|copyright\s*\(c\)/i.test(line));
    notices.push(...lines.slice(0, 4));
  }
  if (exception?.notice) notices.unshift(exception.notice);
  if (notices.length === 0 && author) notices.push(author);
  return [...new Set(notices)].join("\n").slice(0, maxNotice).trim();
}

function tokenise(expression) {
  const tokens = [];
  const pattern = /\s*(\(|\)|\bAND\b|\bOR\b|\bWITH\b|[A-Za-z0-9.+-]+)/gy;
  let match;
  while ((match = pattern.exec(expression)) !== null) {
    tokens.push(match[1].toUpperCase().startsWith("AND") ||
      match[1].toUpperCase().startsWith("OR") ||
      match[1].toUpperCase().startsWith("WITH")
      ? match[1].toUpperCase()
      : match[1]);
    if (pattern.lastIndex === expression.length) break;
  }
  if (tokens.join(" ").replace(/\s+/g, " ") !== expression.replace(/[()]/g, (c) => ` ${c} `).replace(/\s+/g, " ").trim()) {
    throw new Error(`Unsupported license expression: ${expression}`);
  }
  return tokens;
}

function evaluate(expression, extraAllowed) {
  const tokens = tokenise(expression);
  let index = 0;
  const atoms = new Set();
  const peek = () => tokens[index];
  const take = () => tokens[index++];
  function factor() {
    const token = take();
    if (token === "(") {
      const value = or();
      if (take() !== ")") throw new Error(`Unbalanced license expression: ${expression}`);
      return value;
    }
    if (!token || token === ")" || token === "AND" || token === "OR" || token === "WITH") {
      throw new Error(`Unsupported license expression: ${expression}`);
    }
    let atom = token;
    if (peek() === "WITH") {
      take();
      const exception = take();
      if (!exception) throw new Error(`Unsupported license expression: ${expression}`);
      atom = `${atom} WITH ${exception}`;
    }
    atoms.add(atom);
    return extraAllowed.has(atom) || allowed.includes(atom);
  }
  function and() {
    let value = factor();
    while (peek() === "AND") {
      take();
      value = factor() && value;
    }
    return value;
  }
  function or() {
    let value = and();
    while (peek() === "OR") {
      take();
      value = and() || value;
    }
    return value;
  }
  const value = or();
  if (index !== tokens.length) throw new Error(`Unsupported license expression: ${expression}`);
  return { value, atoms };
}

function extraAllowedFor(name, license) {
  const extra = new Set();
  for (const [spdx, exception] of Object.entries(exceptions)) {
    if (license.includes(spdx) && exception.packages.includes(name)) extra.add(spdx);
  }
  return extra;
}

function readLicenseData() {
  const json = execFileSync(
    "pnpm",
    ["--filter", "@beamling/web", "licenses", "list", "--prod", "--json"],
    { cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );
  const groups = JSON.parse(json);
  const packages = [];
  const licenseTexts = new Map();
  const failures = [];

  for (const [license, entries] of Object.entries(groups)) {
    for (const entry of entries) {
      if (typeof entry?.name !== "string") continue;
      const extra = extraAllowedFor(entry.name, license);
      const exception = Object.entries(exceptions).find(
        ([spdx, value]) => license.includes(spdx) && value.packages.includes(entry.name),
      )?.[1];
      const result = evaluate(license, extra);
      if (!result.value) {
        failures.push(`${entry.name}@${entry.versions?.join(",") ?? "?"} uses ${license}`);
      }
      const files = readLicenseFiles(Array.isArray(entry.paths) ? entry.paths : []);
      const licenseFile = files.find((item) => item.name !== "notice");
      const currentText = licenseFile?.text ?? "";
      if (currentText.length > (licenseTexts.get(license)?.length ?? 0)) {
        licenseTexts.set(license, currentText);
      }
      packages.push({
        name: entry.name,
        versions: [...new Set((entry.versions ?? []).map(normaliseVersion).filter(Boolean))].sort(),
        license,
        homepage: normaliseHomepage(entry.homepage),
        notice: noticeFor(files, normaliseAuthor(entry.author), exception),
      });
    }
  }

  if (failures.length > 0) {
    throw new Error(`Disallowed or unknown licenses:\n${failures.sort().join("\n")}`);
  }

  packages.sort((a, b) => a.name.localeCompare(b.name) || a.license.localeCompare(b.license));
  const texts = [...licenseTexts.entries()]
    .map(([license, text]) => ({ license, text }))
    .sort((a, b) => a.license.localeCompare(b.license));

  return {
    policy: {
      allowed,
      exceptions: Object.entries(exceptions).map(([license, exception]) => ({
        license,
        packages: exception.packages,
        reason: exception.reason,
      })),
    },
    packages,
    licenseTexts: texts,
  };
}

const command = process.argv[2] ?? "generate";
const rendered = `${JSON.stringify(readLicenseData(), null, 2)}\n`;
if (command === "check") {
  const existing = existsSync(output) ? readFileSync(output, "utf8") : "";
  if (existing !== rendered) {
    console.error("licenses.json is stale. Run pnpm licenses:generate and commit the result.");
    process.exitCode = 1;
  } else {
    console.log("License data is current and every license is allowed.");
  }
} else if (command === "generate") {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, rendered);
  console.log(`Wrote ${output}`);
} else {
  throw new Error("Usage: scripts/licenses.mjs [generate|check]");
}
