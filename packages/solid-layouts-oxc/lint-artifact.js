"use strict";

const { createHash } = require("node:crypto");
const { readFileSync, readdirSync } = require("node:fs");
const { relative, resolve, sep } = require("node:path");

const FORMAT = "solid-layouts-lint-artifact-v1";
const LAYOUT_FILE = /\.layout\.(?:tsx|jsx)$/;

function slash(path) {
  return path.split(sep).join("/");
}

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function filesBelow(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) {
        if (LAYOUT_FILE.test(entry.name)) throw new Error(`lint artifact refuses symlink: ${path}`);
        continue;
      }
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && LAYOUT_FILE.test(path)) files.push(path);
    }
  };
  visit(root);
  return files.sort((a, b) => compare(slash(a), slash(b)));
}

function commonPrefix(left, right) {
  const limit = Math.min(left.length, right.length);
  let length = 0;
  while (length < limit && left.charCodeAt(length) === right.charCodeAt(length)) length += 1;
  return length;
}

function frontCode(strings) {
  let previous = "";
  return strings.map((value) => {
    const prefix = commonPrefix(previous, value);
    previous = value;
    return [prefix, value.slice(prefix)];
  });
}

function expandFrontCode(rows) {
  if (!Array.isArray(rows)) throw new Error("invalid lint artifact path table");
  let previous = "";
  return rows.map((row) => {
    if (!Array.isArray(row) || row.length !== 2) throw new Error("invalid lint artifact path row");
    const [prefix, suffix] = row;
    if (!Number.isSafeInteger(prefix) || prefix < 0 || prefix > previous.length
      || typeof suffix !== "string") {
      throw new Error("invalid lint artifact path prefix");
    }
    const value = previous.slice(0, prefix) + suffix;
    previous = value;
    return value;
  });
}

function updateField(hash, value) {
  const bytes = Buffer.from(value);
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(length);
  hash.update(bytes);
}

function readSource(root, sourceRoot) {
  const files = filesBelow(sourceRoot);
  const paths = files.map((filename) => slash(relative(root, filename)));
  const hash = createHash("sha256").update(`${FORMAT}\0source\0`);
  let bytes = 0;
  for (let index = 0; index < files.length; index += 1) {
    const content = readFileSync(files[index]);
    bytes += content.length;
    updateField(hash, paths[index]);
    updateField(hash, content);
  }
  return { files, paths, bytes, sha256: hash.digest("hex") };
}

function compareNodes(a, b, order) {
  return order.get(a.path) - order.get(b.path)
    || a.line - b.line || a.column - b.column
    || compare(`${a.severity}\0${a.rule}\0${a.message}`, `${b.severity}\0${b.rule}\0${b.message}`)
    || Number(a.baseline) - Number(b.baseline);
}

function compileLintArtifact(lint) {
  const root = resolve(lint.root);
  const sourceRoot = resolve(lint.sourceRoot);
  const source = readSource(root, sourceRoot);
  const { paths } = source;
  const pathIds = new Map(paths.map((path, index) => [path, index]));

  let skipped = 0;
  const normalized = [];
  for (const item of lint.diagnostics) {
    const path = slash(relative(root, item.filename));
    const file = pathIds.get(path);
    if (file === undefined) {
      skipped += 1;
      continue;
    }
    if (!Number.isSafeInteger(item.line) || item.line < 1
      || !Number.isSafeInteger(item.column) || item.column < 1) {
      throw new Error(`diagnostic has invalid source position: ${path}`);
    }
    normalized.push({
      file,
      path,
      line: item.line,
      column: item.column,
      severity: item.severity,
      rule: item.rule,
      message: item.message,
      kind: [item.severity, item.rule, item.message],
      baseline: item.baseline === true,
    });
  }
  normalized.sort((a, b) => compareNodes(a, b, pathIds));

  const kinds = [...new Set(normalized.map((item) => JSON.stringify(item.kind)))]
    .sort(compare)
    .map((item) => JSON.parse(item));
  const kindIds = new Map(kinds.map((kind, index) => [JSON.stringify(kind), index]));
  const group = (baseline) => {
    const groups = [];
    for (const item of normalized.filter((node) => node.baseline === baseline)) {
      let current = groups.at(-1);
      if (!current || current[0] !== item.file) {
        current = [item.file, []];
        groups.push(current);
      }
      current[1].push([item.line, item.column, kindIds.get(JSON.stringify(item.kind))]);
    }
    return groups;
  };
  const artifact = {
    format: FORMAT,
    source: {
      files: source.files.length,
      exactBytes: source.bytes,
      sha256: source.sha256,
    },
    paths: frontCode(paths),
    kinds,
    baseline: group(true),
    current: group(false),
  };
  const bytes = Buffer.from(`${JSON.stringify(artifact)}\n`);
  const expanded = expandLintArtifact(artifact);
  if (JSON.stringify(expanded) !== JSON.stringify(normalized.map((item) => ({
    path: item.path,
    line: item.line,
    column: item.column,
    severity: item.severity,
    rule: item.rule,
    message: item.message,
    baseline: item.baseline,
  })))) {
    throw new Error("lint artifact failed exact expansion");
  }
  return {
    artifact,
    bytes,
    report: {
      sourceFiles: source.files.length,
      sourceBytes: source.bytes,
      diagnostics: normalized.length,
      baselineDiagnostics: normalized.filter((item) => item.baseline).length,
      currentDiagnostics: normalized.filter((item) => !item.baseline).length,
      skippedDiagnostics: skipped,
      kinds: kinds.length,
      artifactBytes: bytes.length,
      density: source.bytes / bytes.length,
      admitted: bytes.length < source.bytes,
      artifactSha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
}

function expandLintArtifact(artifact) {
  if (!artifact || typeof artifact !== "object") throw new Error("invalid lint artifact");
  if (artifact.format !== FORMAT) throw new Error(`unknown lint artifact format: ${artifact.format}`);
  const { source } = artifact;
  if (!source || typeof source !== "object"
    || !Number.isSafeInteger(source.files) || source.files < 0
    || !Number.isSafeInteger(source.exactBytes) || source.exactBytes < 0
    || typeof source.sha256 !== "string") {
    throw new Error("invalid lint artifact source identity");
  }
  const paths = expandFrontCode(artifact.paths);
  if (paths.length !== source.files) throw new Error("lint artifact file count mismatch");
  if (!Array.isArray(artifact.kinds)
    || !artifact.kinds.every((kind) => Array.isArray(kind) && kind.length === 3
      && kind.every((field) => typeof field === "string"))) {
    throw new Error("invalid lint artifact kind table");
  }
  const pathOrder = new Map(paths.map((path, index) => [path, index]));
  const expandGroups = (groups, baseline) => {
    if (!Array.isArray(groups)) throw new Error("invalid lint artifact node groups");
    return groups.flatMap((entry) => {
      if (!Array.isArray(entry) || entry.length !== 2 || !Array.isArray(entry[1])) {
        throw new Error("invalid lint artifact node group");
      }
      const [file, nodes] = entry;
      if (!Number.isSafeInteger(file) || file < 0 || file >= paths.length) {
        throw new Error("lint artifact file index is out of range");
      }
      return nodes.map((node) => {
        if (!Array.isArray(node) || node.length !== 3) throw new Error("invalid lint artifact node");
        const [line, column, kind] = node;
        if (!Number.isSafeInteger(line) || line < 1
          || !Number.isSafeInteger(column) || column < 1) {
          throw new Error("invalid lint artifact source position");
        }
        const fields = Number.isSafeInteger(kind) ? artifact.kinds[kind] : undefined;
        if (!fields) throw new Error("lint artifact kind index is out of range");
        return {
          path: paths[file],
          line,
          column,
          severity: fields[0],
          rule: fields[1],
          message: fields[2],
          baseline,
        };
      });
    });
  };
  return [...expandGroups(artifact.baseline, true), ...expandGroups(artifact.current, false)]
    .sort((a, b) => compareNodes(a, b, pathOrder));
}

/**
 * Expands the artifact, then recomputes the source identity from the Layout
 * files currently under `lint.sourceRoot`. Throws when the artifact no longer
 * describes those bytes; returns the expanded nodes otherwise.
 */
function verifyLintArtifact(artifact, lint) {
  const nodes = expandLintArtifact(artifact);
  const root = resolve(lint.root);
  const source = readSource(root, resolve(lint.sourceRoot));
  const recorded = expandFrontCode(artifact.paths);
  if (source.files.length !== artifact.source.files
    || source.paths.length !== recorded.length
    || source.paths.some((path, index) => path !== recorded[index])) {
    throw new Error("lint artifact path table does not match the source tree");
  }
  if (source.bytes !== artifact.source.exactBytes) {
    throw new Error("lint artifact byte count does not match the source tree");
  }
  if (source.sha256 !== artifact.source.sha256) {
    throw new Error("lint artifact source digest does not match the source tree");
  }
  return nodes;
}

module.exports = { FORMAT, compileLintArtifact, expandLintArtifact, verifyLintArtifact };
