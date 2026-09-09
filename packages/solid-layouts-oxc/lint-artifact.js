"use strict";

const { createHash } = require("node:crypto");
const { lstatSync, readFileSync, readdirSync } = require("node:fs");
const { relative, resolve, sep } = require("node:path");

const FORMAT = "solid-layouts-lint-artifact-v1";

function slash(path) {
  return path.split(sep).join("/");
}

function filesBelow(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name))) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`lint artifact refuses symlink: ${path}`);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && /\.layout\.(?:tsx|jsx)$/.test(path)) files.push(path);
    }
  };
  visit(root);
  return files;
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
  let previous = "";
  return rows.map(([prefix, suffix]) => {
    if (!Number.isSafeInteger(prefix) || prefix < 0 || prefix > previous.length) {
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

function compileLintArtifact(lint) {
  const root = resolve(lint.root);
  const sourceRoot = resolve(lint.sourceRoot);
  const sourceFiles = filesBelow(sourceRoot);
  const paths = sourceFiles.map((filename) => slash(relative(root, filename)));
  const pathIds = new Map(paths.map((path, index) => [path, index]));
  const sourceHash = createHash("sha256").update(`${FORMAT}\0source\0`);
  let sourceBytes = 0;
  for (let index = 0; index < sourceFiles.length; index += 1) {
    const bytes = readFileSync(sourceFiles[index]);
    if (lstatSync(sourceFiles[index]).isSymbolicLink()) {
      throw new Error(`lint artifact refuses symlink: ${sourceFiles[index]}`);
    }
    sourceBytes += bytes.length;
    updateField(sourceHash, paths[index]);
    updateField(sourceHash, bytes);
  }

  const normalized = lint.diagnostics.map((item) => {
    const path = slash(relative(root, item.filename));
    const file = pathIds.get(path);
    if (file === undefined) throw new Error(`diagnostic is outside Layout corpus: ${path}`);
    if (!Number.isSafeInteger(item.line) || item.line < 1
      || !Number.isSafeInteger(item.column) || item.column < 1) {
      throw new Error(`diagnostic has invalid source position: ${path}`);
    }
    return {
      file,
      line: item.line,
      column: item.column,
      kind: [item.severity, item.rule, item.message],
      baseline: item.baseline === true,
    };
  }).sort((a, b) =>
    a.file - b.file || a.line - b.line || a.column - b.column
    || a.kind.join("\0").localeCompare(b.kind.join("\0"))
    || Number(a.baseline) - Number(b.baseline));

  const kinds = [...new Set(normalized.map((item) => JSON.stringify(item.kind)))]
    .sort()
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
      files: sourceFiles.length,
      exactBytes: sourceBytes,
      sha256: sourceHash.digest("hex"),
    },
    paths: frontCode(paths),
    kinds,
    baseline: group(true),
    current: group(false),
  };
  const bytes = Buffer.from(`${JSON.stringify(artifact)}\n`);
  const expanded = expandLintArtifact(artifact);
  if (JSON.stringify(expanded) !== JSON.stringify(normalized.map((item) => ({
    path: paths[item.file],
    line: item.line,
    column: item.column,
    severity: item.kind[0],
    rule: item.kind[1],
    message: item.kind[2],
    baseline: item.baseline,
  })))) {
    throw new Error("lint artifact failed exact expansion");
  }
  return {
    artifact,
    bytes,
    report: {
      sourceFiles: sourceFiles.length,
      sourceBytes,
      diagnostics: normalized.length,
      baselineDiagnostics: normalized.filter((item) => item.baseline).length,
      currentDiagnostics: normalized.filter((item) => !item.baseline).length,
      kinds: kinds.length,
      artifactBytes: bytes.length,
      density: sourceBytes / bytes.length,
      admitted: bytes.length < sourceBytes,
      artifactSha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
}

function expandLintArtifact(artifact) {
  if (artifact.format !== FORMAT) throw new Error(`unknown lint artifact format: ${artifact.format}`);
  const paths = expandFrontCode(artifact.paths);
  if (paths.length !== artifact.source.files) throw new Error("lint artifact file count mismatch");
  const pathOrder = new Map(paths.map((path, index) => [path, index]));
  const expandGroups = (groups, baseline) => groups.flatMap(([file, nodes]) => {
    if (!Number.isSafeInteger(file) || file < 0 || file >= paths.length) {
      throw new Error("lint artifact file index is out of range");
    }
    return nodes.map(([line, column, kind]) => {
      const fields = artifact.kinds[kind];
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
  return [...expandGroups(artifact.baseline, true), ...expandGroups(artifact.current, false)]
    .sort((a, b) => pathOrder.get(a.path) - pathOrder.get(b.path)
      || a.line - b.line || a.column - b.column
      || `${a.severity}\0${a.rule}\0${a.message}`.localeCompare(
        `${b.severity}\0${b.rule}\0${b.message}`,
      ) || Number(a.baseline) - Number(b.baseline));
}

module.exports = { FORMAT, compileLintArtifact, expandLintArtifact };
