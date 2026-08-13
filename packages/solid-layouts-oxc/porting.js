"use strict";

const { readFileSync, readdirSync, statSync } = require("node:fs");
const { resolve } = require("node:path");
const { lintApplication } = require("./index.js");
const { compileApplication } = require("./application.js");

function filesBelow(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) files.push(...filesBelow(path));
    else if (/\.(?:ts|tsx|js|jsx)$/.test(path)) files.push(path);
  }
  return files.sort();
}

function lintPorting(options = {}) {
  const root = resolve(options.root || process.cwd());
  const include = resolve(root, options.include || "src");
  const application = compileApplication({
    root,
    layouts: options.layouts,
  });
  const files = filesBelow(include).map((filename) => ({
    filename,
    source: readFileSync(filename, "utf8"),
  }));
  const diagnostics = lintApplication(
    files,
    application.sources.map((source) => ({
      module: source.module,
      exports: source.exports,
    })),
  );
  return { root, include, application, diagnostics, failed: false };
}

module.exports = { lintPorting };
