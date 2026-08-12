#!/usr/bin/env bun
"use strict";

const { mkdirSync } = require("node:fs");
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const { compileLibrary } = require("../library.js");

const args = process.argv.slice(2);
const valueAfter = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const root = resolve(valueAfter("--root") || process.cwd());
const result = compileLibrary({
  root,
  config: valueAfter("--config"),
});

console.log(`solid-layouts library bundle: ${result.outputRoot}`);

if (args.includes("--pack")) {
  const destination = resolve(root, valueAfter("--pack-destination") || "artifacts");
  mkdirSync(destination, { recursive: true });
  const packed = spawnSync("bun", ["pm", "pack", "--destination", destination], {
    cwd: result.outputRoot,
    stdio: "inherit",
  });
  if (packed.status !== 0) process.exit(packed.status || 1);
}
