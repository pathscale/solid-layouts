#!/usr/bin/env bun
"use strict";

const { mkdirSync } = require("node:fs");
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const { compileLibrary, lintLibrary } = require("../library.js");

const args = process.argv.slice(2);
const valueAfter = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const root = resolve(valueAfter("--root") || process.cwd());
const options = {
  root,
  config: valueAfter("--config"),
  source: valueAfter("--source"),
  output: valueAfter("--output"),
  check: args.includes("--check"),
  updateBaseline: args.includes("--update-baseline"),
};
if (args.includes("--lint")) {
  const lint = lintLibrary(options);
  for (const item of lint.diagnostics) {
    if (item.baseline) continue;
    console.error(`${item.filename}:${item.line}:${item.column}: ${item.severity}: ${item.message}`);
  }
  if (lint.failed) process.exit(1);
  process.exit(0);
}

const result = compileLibrary(options);

console.log(
  result.outputRoot
    ? `solid-layouts library bundle: ${result.outputRoot}`
    : `solid-layouts generated ${result.changed} Layout file(s)`,
);

if (args.includes("--pack")) {
  const destination = resolve(root, valueAfter("--pack-destination") || "artifacts");
  mkdirSync(destination, { recursive: true });
  const packed = spawnSync("bun", ["pm", "pack", "--destination", destination], {
    cwd: result.outputRoot,
    stdio: "inherit",
  });
  if (packed.status !== 0) process.exit(packed.status || 1);
}
