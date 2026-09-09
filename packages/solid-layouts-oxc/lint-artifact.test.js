"use strict";

const { expect, test } = require("bun:test");
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { compileLintArtifact, expandLintArtifact } = require("./lint-artifact.js");

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
