"use strict";

const { afterEach, expect, test } = require("bun:test");
const {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { dirname, join, resolve } = require("node:path");
const {
  compileApplication,
  compileApplicationFile,
  pluginSolidLayoutsApplication,
} = require("./application.js");

const temporary = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "solid-layouts-application-"));
  temporary.push(root);
  writeFileSync(join(root, "package.json"), '{"name":"application-fixture","private":true}\n');
  const packageRoot = join(root, "node_modules/@pathscale/test-ui");
  mkdirSync(dirname(packageRoot), { recursive: true });
  symlinkSync(resolve(__dirname, "../../Test-UI/bundle"), packageRoot, "dir");
  return { root, packageRoot };
}

function makePackageEditable(root, packageRoot) {
  const copy = join(root, "editable-package");
  cpSync(packageRoot, copy, { recursive: true, dereference: true });
  rmSync(packageRoot);
  symlinkSync(copy, packageRoot, "dir");
  return copy;
}

test("resolves an exact component index from C and accepts its public export", () => {
  const { root } = fixture();
  const application = compileApplication({ root, layouts: ["@pathscale/test-ui"] });
  expect(application.layoutSources).toEqual([
    {
      module: "@pathscale/test-ui",
      exports: ["Button", "Chip", "Flex", "Icon"],
      resolved: resolve(__dirname, "../../Test-UI/bundle/index.ts"),
    },
  ]);
  const result = compileApplicationFile(
    'import { Icon as StatusIcon } from "@pathscale/test-ui"; export const View = () => <StatusIcon />;',
    join(root, "src/View.tsx"),
    application,
  );
  expect(result.failed).toBe(false);
  expect(result.changed).toBe(true);
  expect(result.code).toContain(application.layoutSources[0].resolved);
});

test("resolves a Layout package without a package.json export", () => {
  const { root, packageRoot } = fixture();
  const copy = makePackageEditable(root, packageRoot);
  const packageJsonPath = join(copy, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  delete packageJson.exports["./package.json"];
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

  const application = compileApplication({ root, layouts: ["@pathscale/test-ui"] });

  expect(application.sources[0].packageJsonPath.endsWith("/editable-package/package.json")).toBe(true);
  expect(application.layoutSources[0].exports).toContain("Icon");
});

test("resolves the import-only solid-layouts runtime for the bundler alias", () => {
  const { root } = fixture();
  symlinkSync(
    resolve(__dirname, "../solid-layouts"),
    join(root, "node_modules/solid-layouts"),
    "dir",
  );
  let bundlerConfig;

  pluginSolidLayoutsApplication({ layouts: ["@pathscale/test-ui"] }).setup({
    context: { rootPath: root },
    modifyBundlerChain(config) {
      bundlerConfig = config;
    },
  });

  expect(bundlerConfig.order).toBe("post");
});

test("accepts another public component exported by C", () => {
  const { root } = fixture();
  const application = compileApplication({ root, layouts: ["@pathscale/test-ui"] });
  const result = compileApplicationFile(
    'import { Button } from "@pathscale/test-ui"; export const View = () => <Button />;',
    join(root, "src/View.tsx"),
    application,
  );
  expect(result.failed).toBe(false);
  expect(result.changed).toBe(true);
  expect(result.code).toContain(application.layoutSources[0].resolved);
});

test("rejects a public export absent from C's manifest", () => {
  const { root } = fixture();
  const application = compileApplication({ root, layouts: ["@pathscale/test-ui"] });
  expect(() =>
    compileApplicationFile(
      'import { Missing } from "@pathscale/test-ui"; export const View = () => <Missing />;',
      join(root, "src/View.tsx"),
      application,
    ),
  ).toThrow("public export `Missing`");
});

test("rejects a package with no Layout manifest discovery field", () => {
  const { root, packageRoot } = fixture();
  const copy = makePackageEditable(root, packageRoot);
  writeFileSync(join(copy, "package.json"), '{"name":"@pathscale/test-ui"}\n');
  expect(() => compileApplication({ root, layouts: ["@pathscale/test-ui"] })).toThrow(
    "has no solidLayouts field",
  );
});

test("rejects C when its shared runtime dependency is undeclared", () => {
  const { root, packageRoot } = fixture();
  const copy = makePackageEditable(root, packageRoot);
  const packageJsonPath = join(copy, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  delete packageJson.peerDependencies["solid-layouts"];
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  expect(() => compileApplication({ root, layouts: ["@pathscale/test-ui"] })).toThrow(
    "must declare solid-layouts as a peer dependency",
  );
});

test("rejects a corrupt Layout manifest", () => {
  const { root, packageRoot } = fixture();
  const copy = makePackageEditable(root, packageRoot);
  writeFileSync(join(copy, "layouts.manifest.json"), "not-json\n");
  expect(() => compileApplication({ root, layouts: ["@pathscale/test-ui"] })).toThrow(
    "is not valid JSON",
  );
});

test("rejects an unsupported Layout manifest format", () => {
  const { root, packageRoot } = fixture();
  const copy = makePackageEditable(root, packageRoot);
  const manifestPath = join(copy, "layouts.manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.format = "solid-layouts-library-v999";
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  expect(() => compileApplication({ root, layouts: ["@pathscale/test-ui"] })).toThrow(
    "unsupported Layout manifest format",
  );
});

test("rejects a component record whose generated Layout is missing", () => {
  const { root, packageRoot } = fixture();
  const copy = makePackageEditable(root, packageRoot);
  rmSync(join(copy, "components/icon/Icon.generated.tsx"));
  expect(() => compileApplication({ root, layouts: ["@pathscale/test-ui"] })).toThrow(
    "generated Layout not found",
  );
});

test("rejects a generated entry that disagrees with its component record", () => {
  const { root, packageRoot } = fixture();
  const copy = makePackageEditable(root, packageRoot);
  const entryPath = join(copy, "index.ts");
  const entry = readFileSync(entryPath, "utf8").replace(
    "layout: IconLayout",
    "layout: WrongLayout",
  );
  writeFileSync(entryPath, entry);
  expect(() => compileApplication({ root, layouts: ["@pathscale/test-ui"] })).toThrow(
    "entry call site disagrees",
  );
});
