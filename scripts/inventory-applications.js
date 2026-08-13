"use strict";

const { existsSync, readFileSync, readdirSync, statSync, writeFileSync } = require("node:fs");
const { relative, resolve, sep } = require("node:path");
const { lintPorting } = require("../packages/solid-layouts-oxc/porting.js");

const args = process.argv.slice(2);
const valueAfter = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const valuesAfter = (name) => args.flatMap((arg, index) =>
  arg === name && args[index + 1] ? [args[index + 1]] : [],
);

const codeRoot = resolve(valueAfter("--code-root") || resolve(__dirname, "../.."));
const uiRoot = resolve(valueAfter("--ui-root") || "");
const output = valueAfter("--output");
const compact = args.includes("--compact");
const priorities = new Set(valuesAfter("--priority"));
const ignored = new Set([
  ".git",
  ".output",
  "artifacts",
  "build",
  "bundle",
  "dist",
  "node_modules",
  "target",
]);

if (!uiRoot || !existsSync(resolve(uiRoot, "package.json"))) {
  throw new Error("--ui-root must point to a compiled @pathscale/ui package");
}

const manifests = [];
const visit = (directory) => {
  for (const entry of readdirSync(directory)) {
    if (ignored.has(entry)) continue;
    const path = resolve(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) visit(path);
    else if (entry === "package.json") manifests.push(path);
  }
};
visit(codeRoot);

const applications = [];
for (const manifestPath of manifests.sort()) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const dependencies = {
    ...(manifest.dependencies || {}),
    ...(manifest.devDependencies || {}),
    ...(manifest.peerDependencies || {}),
  };
  if (!dependencies["solid-js"] || !dependencies["@pathscale/ui"]) continue;
  const root = resolve(manifestPath, "..");
  const include = existsSync(resolve(root, "src")) ? "src" : ".";
  const result = lintPorting({
    root,
    include,
    layouts: [{ module: "@pathscale/ui", root: uiRoot }],
  });
  result.diagnostics.sort((left, right) =>
    left.filename.localeCompare(right.filename) ||
    left.line - right.line ||
    left.column - right.column ||
    left.rule.localeCompare(right.rule) ||
    left.message.localeCompare(right.message),
  );
  const rules = {};
  for (const diagnostic of result.diagnostics) {
    rules[diagnostic.rule] = (rules[diagnostic.rule] || 0) + 1;
  }
  applications.push({
    application: relative(codeRoot, root).split(sep).join("/"),
    total: result.diagnostics.length,
    rules: Object.fromEntries(Object.entries(rules).sort()),
    diagnostics: result.diagnostics.map((diagnostic) => ({
      file: relative(root, diagnostic.filename).split(sep).join("/"),
      line: diagnostic.line,
      column: diagnostic.column,
      rule: diagnostic.rule,
      message: diagnostic.message,
      suggestion: diagnostic.suggestion,
    })),
  });
}

const totals = {};
const patterns = new Map();
for (const application of applications) {
  for (const [rule, count] of Object.entries(application.rules)) {
    totals[rule] = (totals[rule] || 0) + count;
  }
  for (const diagnostic of application.diagnostics) {
    const match = /occurs (\d+) times.*`([^`]*)`/.exec(diagnostic.message);
    if (!match) continue;
    const signature = match[2].trim().split(/\s+/).sort().join(" ");
    const pattern = patterns.get(signature) || {
      signature,
      occurrences: 0,
      applications: [],
    };
    pattern.occurrences += Number(match[1]);
    pattern.applications.push({
      application: application.application,
      count: Number(match[1]),
      file: diagnostic.file,
      line: diagnostic.line,
      rule: diagnostic.rule,
    });
    patterns.set(signature, pattern);
  }
}

const sortedPatterns = [...patterns.values()].sort((left, right) =>
  right.applications.length - left.applications.length ||
  right.occurrences - left.occurrences ||
  left.signature.localeCompare(right.signature),
);
const priorityPatterns = sortedPatterns.flatMap((pattern) => {
  const counts = new Map();
  for (const application of pattern.applications) {
    if (!priorities.has(application.application)) continue;
    counts.set(
      application.application,
      (counts.get(application.application) || 0) + application.count,
    );
  }
  if (counts.size < 2) return [];
  return [{
    signature: pattern.signature,
    occurrences: [...counts.values()].reduce((sum, count) => sum + count, 0),
    applications: [...counts].map(([application, count]) => ({ application, count })),
  }];
});
const inventory = {
  format: "solid-layouts-application-inventory-v1",
  codeRoot: codeRoot.endsWith(`${sep}code`) ? "~/code" : codeRoot,
  uiPackage: JSON.parse(readFileSync(resolve(uiRoot, "package.json"), "utf8")).version,
  applicationCount: applications.length,
  diagnosticCount: applications.reduce((sum, application) => sum + application.total, 0),
  totals: Object.fromEntries(Object.entries(totals).sort()),
  priorities: applications
    .filter((application) => priorities.has(application.application))
    .map(({ diagnostics, ...application }) => application),
  priorityPatterns,
  patterns: sortedPatterns,
  applications: compact
    ? applications.map(({ diagnostics, ...application }) => application)
    : applications,
};
const json = `${JSON.stringify(inventory, null, 2)}\n`;
if (output) writeFileSync(resolve(output), json);
else process.stdout.write(json);
