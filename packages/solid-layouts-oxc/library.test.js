"use strict";

const { afterEach, expect, test } = require("bun:test");
const {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { compileLibrary, lintLibrary ,
  emitSourceManifest,
} = require("./library.js");

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
  const packageJson = JSON.parse(
    readFileSync(join(result.outputRoot, "package.json"), "utf8"),
  );
  const button = readFileSync(
    join(result.outputRoot, "components/button/Button.generated.tsx"),
    "utf8",
  );
  const buttonRecipe = readFileSync(
    join(result.outputRoot, "components/button/Button.recipe.ts"),
    "utf8",
  );

  // Not destructured: `children` has to stay a member expression or Solid
  // inserts it once and the layout can never update it.
  expect(layout).toContain("(_stable, p) =>");
  expect(layout).not.toContain("{ slot, children }");
  expect(layout).toContain("p.width");
  expect(layout).not.toContain("local.width");
  expect(recipe).toContain("_layouts:");
  expect(entry).toContain('from "solid-layouts/application-boundary"');
  expect(entry).toContain("export const Icon = __defineLayoutComponent");
  expect(entry).toContain("export const Button = __defineLayoutComponent");
  expect(packageJson.private).toBe(true);
  expect(entry).toContain("as __LayoutComponent<__ButtonProps>");
  expect(entry).toContain("export type { ButtonProps, ButtonVariant, ButtonSize }");
  expect(button).toContain("Boolean(p.isDisabled)");
  expect(button).toContain("p.squareSize / 2");
  expect(button).not.toContain("local.isDisabled");
  expect(buttonRecipe).toContain('"justify"');
  expect(result.manifest.components.Icon.layout).toBe(
    "./components/icon/Icon.generated.tsx",
  );
  expect(result.manifest.components.Button.layout).toBe(
    "./components/button/Button.generated.tsx",
  );
});

test("lints the library with the native project checker", () => {
  const root = fixture();
  const result = lintLibrary({ root });
  expect(result.failed).toBe(false);
  expect(result.diagnostics).toHaveLength(1);
  expect(result.diagnostics[0].rule).toBe("manual-classes");
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

test("discovers components without an authored library manifest", () => {
  const root = fixture();
  expect(() => readFileSync(join(root, "layouts.library.json"))).toThrow();

  const result = compileLibrary({ root });

  expect(Object.keys(result.manifest.components)).toEqual(["Button", "Chip", "Flex", "Icon"]);
});

test("fails when a discovered recipe source is missing", () => {
  const root = fixture();
  rmSync(join(root, "src/components/icon/Icon.recipe.ts"));

  expect(() => compileLibrary({ root })).toThrow("recipe import not found");
});

test("fails when the Layout export cannot be derived", () => {
  const root = fixture();
  const layoutPath = join(root, "src/components/icon/Icon.layout.tsx");
  const layout = readFileSync(layoutPath, "utf8").replace("IconLayout", "PublicIconLayout");
  writeFileSync(layoutPath, layout);

  expect(() => compileLibrary({ root })).toThrow("expected public Layout export IconLayout");
});

test("accepts a formatted multiline Layout annotation", () => {
  const root = fixture();
  const layoutPath = join(root, "src/components/icon/Icon.layout.tsx");
  const layout = readFileSync(layoutPath, "utf8").replace(
    "Layout<typeof icon, IconProps>",
    "Layout<\n  typeof icon,\n  IconProps\n>",
  );
  writeFileSync(layoutPath, layout);

  expect(() => compileLibrary({ root })).not.toThrow();
});

test("the manifest is derived from the package's own entries, not a declared list", () => {
  // The list used to live in `layouts.library.json` as an `exports` array, which
  // is the same information as the package's entry files and could only drift
  // from them. It did: a library renamed eleven components and the manifest kept
  // the old names, so the application compiler rejected every new one and
  // accepted names that no longer existed.
  const root = mkdtempSync(join(tmpdir(), "layouts-manifest-"));
  mkdirSync(join(root, "src/components/alert"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "@scope/kit", version: "1.0.0", exports: { ".": "./dist/index.js" } }),
  );
  writeFileSync(
    join(root, "layouts.library.json"),
    JSON.stringify({ mode: "source", source: "src/components", output: "dist" }),
  );
  writeFileSync(
    join(root, "src/index.ts"),
    [
      'export { Alert } from "./components/alert";',
      'export type { AlertProps } from "./components/alert";',
      'export { FLAVORS } from "./constants";',
    ].join("\n"),
  );

  const { manifest } = emitSourceManifest({ root });
  const names = Object.keys(manifest.components);

  expect(names).toContain("Alert");
  // A type is not a component.
  expect(names).not.toContain("AlertProps");
  // Neither is a constant.
  expect(names).not.toContain("FLAVORS");
});
