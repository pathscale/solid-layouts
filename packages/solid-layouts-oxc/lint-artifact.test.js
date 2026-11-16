"use strict";

const { expect, test } = require("bun:test");
const { spawnSync } = require("node:child_process");
const {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { lintLibrary } = require("./library.js");
const {
  FORMAT,
  compileLintArtifact,
  expandLintArtifact,
  verifyLintArtifact,
} = require("./lint-artifact.js");

function layoutTree(files) {
  const root = mkdtempSync(join(tmpdir(), "solid-layouts-lint-artifact-"));
  const sourceRoot = join(root, "src");
  mkdirSync(sourceRoot, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(sourceRoot, name), content);
  return { root, sourceRoot };
}

function warning(filename) {
  return {
    filename,
    line: 1,
    column: 1,
    severity: "warning",
    rule: "known",
    message: "known answer",
    baseline: false,
  };
}

test("packs exact compiler-owned Layout nodes without treating them as source", () => {
  const root = mkdtempSync(join(tmpdir(), "solid-layouts-lint-artifact-"));
  try {
    const sourceRoot = join(root, "src");
    mkdirSync(join(sourceRoot, "button"), { recursive: true });
    const filename = join(sourceRoot, "button", "Button.layout.tsx");
    writeFileSync(filename, "export const Button = () => <button class=\"x\" />;\n");
    const diagnostic = {
      filename,
      line: 1,
      column: 37,
      severity: "warning",
      rule: "manual-classes",
      message: "manual class composition belongs in the recipe",
      baseline: true,
    };
    const first = compileLintArtifact({ root, sourceRoot, diagnostics: [diagnostic] });
    const second = compileLintArtifact({ root, sourceRoot, diagnostics: [diagnostic] });

    expect(first.bytes).toEqual(second.bytes);
    expect(first.report.sourceFiles).toBe(1);
    expect(first.report.diagnostics).toBe(1);
    expect(expandLintArtifact(first.artifact)).toEqual([{
      path: "src/button/Button.layout.tsx",
      line: 1,
      column: 37,
      severity: "warning",
      rule: "manual-classes",
      message: "manual class composition belongs in the recipe",
      baseline: true,
    }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("source bytes and node boundaries both participate in identity", () => {
  const root = mkdtempSync(join(tmpdir(), "solid-layouts-lint-artifact-"));
  try {
    const sourceRoot = join(root, "src");
    mkdirSync(sourceRoot, { recursive: true });
    const filename = join(sourceRoot, "A.layout.tsx");
    writeFileSync(filename, "const A = 1;\n");
    const make = (line) => compileLintArtifact({
      root,
      sourceRoot,
      diagnostics: [{
        filename,
        line,
        column: 1,
        severity: "warning",
        rule: "known",
        message: "known answer",
        baseline: true,
      }],
    });
    const original = make(1);
    const moved = make(2);
    writeFileSync(filename, "const A = 2;\n");
    const changed = make(1);

    expect(moved.report.artifactSha256).not.toBe(original.report.artifactSha256);
    expect(changed.artifact.source.sha256).not.toBe(original.artifact.source.sha256);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verifies an artifact against the unchanged Layout tree", () => {
  const { root, sourceRoot } = layoutTree({ "A.layout.tsx": "const A = 1;\n" });
  try {
    const { artifact } = compileLintArtifact({
      root,
      sourceRoot,
      diagnostics: [warning(join(sourceRoot, "A.layout.tsx"))],
    });
    expect(verifyLintArtifact(artifact, { root, sourceRoot })).toEqual(expandLintArtifact(artifact));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verification rejects changed Layout bytes", () => {
  const { root, sourceRoot } = layoutTree({ "A.layout.tsx": "const A = 1;\n" });
  try {
    const { artifact } = compileLintArtifact({ root, sourceRoot, diagnostics: [] });
    writeFileSync(join(sourceRoot, "A.layout.tsx"), "const A = 2;\n");
    expect(() => verifyLintArtifact(artifact, { root, sourceRoot }))
      .toThrow("lint artifact source digest does not match the source tree");
    writeFileSync(join(sourceRoot, "A.layout.tsx"), "const A = 10;\n");
    expect(() => verifyLintArtifact(artifact, { root, sourceRoot }))
      .toThrow("lint artifact byte count does not match the source tree");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verification rejects an added Layout file", () => {
  const { root, sourceRoot } = layoutTree({ "A.layout.tsx": "const A = 1;\n" });
  try {
    const { artifact } = compileLintArtifact({ root, sourceRoot, diagnostics: [] });
    writeFileSync(join(sourceRoot, "B.layout.tsx"), "const B = 1;\n");
    expect(() => verifyLintArtifact(artifact, { root, sourceRoot }))
      .toThrow("lint artifact path table does not match the source tree");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verification rejects a removed Layout file", () => {
  const { root, sourceRoot } = layoutTree({
    "A.layout.tsx": "const A = 1;\n",
    "B.layout.tsx": "const B = 1;\n",
  });
  try {
    const { artifact } = compileLintArtifact({ root, sourceRoot, diagnostics: [] });
    rmSync(join(sourceRoot, "B.layout.tsx"));
    expect(() => verifyLintArtifact(artifact, { root, sourceRoot }))
      .toThrow("lint artifact path table does not match the source tree");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("expansion rejects malformed artifact shapes", () => {
  const { root, sourceRoot } = layoutTree({ "A.layout.tsx": "const A = 1;\n" });
  try {
    const { artifact } = compileLintArtifact({
      root,
      sourceRoot,
      diagnostics: [warning(join(sourceRoot, "A.layout.tsx"))],
    });
    const broken = (edit) => {
      const copy = structuredClone(artifact);
      edit(copy);
      return () => expandLintArtifact(copy);
    };
    expect(broken((copy) => { copy.format = "other"; })).toThrow("unknown lint artifact format: other");
    expect(broken((copy) => { copy.paths = "src/A.layout.tsx"; })).toThrow("invalid lint artifact path table");
    expect(broken((copy) => { copy.source.files = 2; })).toThrow("lint artifact file count mismatch");
    expect(broken((copy) => { copy.kinds = [["warning", "known"]]; })).toThrow("invalid lint artifact kind table");
    expect(broken((copy) => { copy.current = [[1, [[1, 1, 0]]]]; }))
      .toThrow("lint artifact file index is out of range");
    expect(broken((copy) => { copy.current = [[0, [[1, 1, 7]]]]; }))
      .toThrow("lint artifact kind index is out of range");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("counts diagnostics outside the Layout corpus instead of packing them", () => {
  const { root, sourceRoot } = layoutTree({
    "A.layout.tsx": "const A = 1;\n",
    "util.ts": "export const u = 1;\n",
  });
  try {
    const compiled = compileLintArtifact({
      root,
      sourceRoot,
      diagnostics: [
        warning(join(sourceRoot, "A.layout.tsx")),
        warning(join(sourceRoot, "util.ts")),
        { ...warning(join(root, "lint-baseline.json")), severity: "error", rule: "baseline-stale" },
      ],
    });
    expect(compiled.report.diagnostics).toBe(1);
    expect(compiled.report.skippedDiagnostics).toBe(2);
    expect(expandLintArtifact(compiled.artifact).map((node) => node.path)).toEqual(["src/A.layout.tsx"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("refuses a symlinked Layout file and skips other symlinks", () => {
  const { root, sourceRoot } = layoutTree({ "A.layout.tsx": "const A = 1;\n" });
  try {
    const outside = join(root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "B.layout.tsx"), "const B = 1;\n");
    symlinkSync(outside, join(sourceRoot, "linked"));
    expect(compileLintArtifact({ root, sourceRoot, diagnostics: [] }).report.sourceFiles).toBe(1);
    symlinkSync(join(outside, "B.layout.tsx"), join(sourceRoot, "B.layout.tsx"));
    expect(() => compileLintArtifact({ root, sourceRoot, diagnostics: [] }))
      .toThrow("lint artifact refuses symlink");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the lint CLI writes the artifact and keeps stdout empty", () => {
  const root = mkdtempSync(join(tmpdir(), "solid-layouts-lint-artifact-"));
  try {
    const fixture = resolve(__dirname, "../../Test-UI");
    cpSync(join(fixture, "package.json"), join(root, "package.json"));
    cpSync(join(fixture, "src"), join(root, "src"), { recursive: true });
    const output = join(root, "out", "lint-artifact.json");
    const run = spawnSync(
      process.execPath,
      [join(__dirname, "bin", "solid-layouts-lint.js"), "--root", root, "--artifact", output],
      { encoding: "utf8" },
    );
    expect(run.status).toBe(0);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("solid-layouts lint artifact: ");

    const written = readFileSync(output);
    const lint = lintLibrary({ root });
    expect(written.equals(compileLintArtifact(lint).bytes)).toBe(true);
    const artifact = JSON.parse(written.toString("utf8"));
    expect(artifact.format).toBe(FORMAT);
    expect(verifyLintArtifact(artifact, { root, sourceRoot: lint.sourceRoot }))
      .toEqual(expandLintArtifact(artifact));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
