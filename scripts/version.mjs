#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = ["package.json", "packages/web/package.json", "packages/mascot/package.json"];
const Semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function readVersion(file) {
  const value = JSON.parse(readFileSync(resolve(root, file), "utf8")).version;
  if (typeof value !== "string" || !Semver.test(value)) {
    throw new Error(`${file} has an invalid version: ${String(value)}`);
  }
  return value;
}

function writeVersion(file, version) {
  const path = resolve(root, file);
  const source = readFileSync(path, "utf8");
  const next = source.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`);
  if (next === source) throw new Error(`Could not update ${file}.`);
  writeFileSync(path, next);
}

const [command = "print", value] = process.argv.slice(2);
if (command === "print") {
  process.stdout.write(`${readVersion("package.json")}\n`);
} else if (command === "check") {
  const version = readVersion("package.json");
  const tag = value ?? process.env.GITHUB_REF_NAME;
  if (!tag) throw new Error("Pass a tag, or set GITHUB_REF_NAME.");
  if (tag !== `v${version}`) throw new Error(`Tag ${tag} does not match package version v${version}.`);
  console.log(`Version ${version} matches ${tag}.`);
} else if (command === "set") {
  if (!value || !Semver.test(value)) throw new Error("Pass a semver version, e.g. 0.2.0.");
  for (const file of files) writeVersion(file, value);
  console.log(`Set Beamling version to ${value}.`);
} else {
  throw new Error("Usage: scripts/version.mjs [print|check <tag>|set <semver>]");
}
