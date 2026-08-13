#!/usr/bin/env bun
"use strict";

const { resolve } = require("node:path");

const args = process.argv.slice(2);
const valueAfter = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

if (!args.includes("--porting")) {
  process.argv.splice(2, 0, "--lint");
  require("./solid-layouts-library.js");
} else {
  const { lintPorting } = require("../porting.js");
  const root = resolve(valueAfter("--root") || process.cwd());
  const layouts = args
    .flatMap((argument, index) => argument === "--layouts" ? [args[index + 1]] : [])
    .filter(Boolean);
  const result = lintPorting({
    root,
    include: valueAfter("--include"),
    layouts: layouts.length ? layouts : undefined,
  });
  for (const item of result.diagnostics) {
    console.warn(`${item.filename}:${item.line}:${item.column}: warning[${item.rule}]: ${item.message}`);
  }
  console.log(`solid-layouts porting report: ${result.diagnostics.length} warning(s)`);
}
