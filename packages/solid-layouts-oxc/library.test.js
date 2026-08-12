"use strict";

const { afterEach, expect, test } = require("bun:test");
const {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { compileLibrary } = require("./library.js");

const temporary = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "solid-layouts-library-"));
  temporary.push(directory);
  const source = resolve(__dirname, "../../Test-UI");
  cpSync(join(source, "package.json"), join(directory, "package.json"));
  cpSync(join(source, "layouts.library.json"), join(directory, "layouts.library.json"));
  cpSync(join(source, "src"), join(directory, "src"), { recursive: true });
  return directory;
}

test("builds valid generated Layout source and a package manifest", () => {
  const root = fixture();
  const result = compileLibrary({ root });
  const layout = readFileSync(
    join(result.outputRoot, "components/icon/Icon.generated.tsx"),
    "utf8",
  );
  const recipe = readFileSync(
    join(result.outputRoot, "components/icon/Icon.recipe.ts"),
    "utf8",
  );
  const entry = readFileSync(join(result.outputRoot, "index.ts"), "utf8");
  const button = readFileSync(
    join(result.outputRoot, "components/button/Button.generated.tsx"),
    "utf8",
  );

  expect(layout).toContain("({ slot, children }, p) =>");
  expect(layout).toContain("p.width");
  expect(layout).not.toContain("local.width");
  expect(recipe).toContain("_layouts:");
  expect(entry).toContain('from "solid-layouts/application-boundary"');
  expect(entry).toContain("export const Icon = __defineLayoutComponent");
  expect(entry).toContain("export const Button = __defineLayoutComponent");
  expect(button).toContain("Boolean(p.isDisabled)");
  expect(button).not.toContain("local.isDisabled");
  expect(result.manifest.components.Icon.layout).toBe(
    "./components/icon/Icon.generated.tsx",
  );
  expect(result.manifest.components.Button.layout).toBe(
    "./components/button/Button.generated.tsx",
  );
});

test("fails when a rendered slot is absent from the recipe", () => {
  const root = fixture();
  const layoutPath = join(root, "src/components/icon/Icon.layout.tsx");
  const layout = readFileSync(layoutPath, "utf8").replace(
    "slot.root.class",
    "slot.missing.class",
  );
  writeFileSync(layoutPath, layout);

  expect(() => compileLibrary({ root })).toThrow(
    "rendered slot missing is not declared",
  );
});

test("fails when the configured recipe source is missing", () => {
  const root = fixture();
  rmSync(join(root, "src/components/icon/Icon.recipe.ts"));

  expect(() => compileLibrary({ root })).toThrow("recipe not found");
});
