#!/usr/bin/env bun
"use strict";

const { resolve } = require("node:path");
const { compileApplication } = require("../application.js");

const args = process.argv.slice(2);
let root = process.cwd();
const layouts = [];
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--root") root = resolve(args[++index]);
  else if (argument === "--layout") layouts.push(args[++index]);
  else throw new Error(`unknown argument: ${argument}`);
}

const result = compileApplication({
  root,
  ...(layouts.length ? { layouts } : {}),
});
for (const source of result.sources) {
  process.stdout.write(`${source.module}: ${source.exports.join(", ")}\n`);
}
