"use strict";

const {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} = require("node:fs");
const { basename, dirname, relative, resolve, sep } = require("node:path");
const { lintProject, transform } = require("./index.js");
const { boundaryFor } = require("./application.js");

const FORMAT = "solid-layouts-library-v2";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readLibraryConfig(root, options = {}) {
  const configPath = resolve(root, options.config || "layouts.library.json");
  if (existsSync(configPath)) return { configPath, config: readJson(configPath) };
  if (options.config) throw new Error(`Layout library config not found: ${configPath}`);
  return {
    configPath: undefined,
    config: {
      source: options.source || "src",
      output: options.output || "bundle",
    },
  };
}

function filesBelow(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) files.push(...filesBelow(path));
    else files.push(path);
  }
  return files.sort();
}

function portable(path) {
  return path.split(sep).join("/");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveModule(fromFile, specifier) {
  if (!specifier.startsWith(".")) {
    throw new Error(`${fromFile}: Layout recipes must be imported through a relative path`);
  }
  const candidate = resolve(dirname(fromFile), specifier);
  for (const suffix of ["", ".ts", ".tsx", ".js", ".jsx"]) {
    const path = `${candidate}${suffix}`;
    if (existsSync(path)) return path;
  }
  throw new Error(`${fromFile}: recipe import not found: ${specifier}`);
}

function exportedTypes(source) {
  const names = new Set();
  for (const match of source.matchAll(/\bexport\s+(?:declare\s+)?(?:type|interface)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/\bexport\s+type\s*\{([^}]+)\}/g)) {
    for (const item of match[1].split(",")) {
      const name = item.trim().split(/\s+as\s+/).at(-1);
      if (name) names.add(name);
    }
  }
  return [...names];
}

function discoverComponents(sourceRoot) {
  const layouts = filesBelow(sourceRoot).filter((path) => /\.layout\.(?:tsx|jsx)$/.test(path));
  const components = layouts.map((layout) => {
    const source = readFileSync(layout, "utf8");
    const name = basename(layout).replace(/\.layout\.(?:tsx|jsx)$/, "");
    const annotations = [...source.matchAll(
      /\bLayout\s*<\s*typeof\s+([A-Za-z_$][\w$]*)(?:\s*,\s*([A-Za-z_$][\w$]*))?\s*>/g,
    )];
    if (annotations.length !== 1) {
      throw new Error(`${layout}: expected exactly one Layout<typeof recipe, Props> annotation`);
    }
    const recipeExport = annotations[0][1];
    const propsType = annotations[0][2];
    const imports = [...source.matchAll(
      /import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["']/g,
    )];
    const recipeImports = [];
    for (const match of imports) {
      for (const item of match[1].split(",")) {
        const [imported, local = imported] = item.trim().split(/\s+as\s+/);
        if (local === recipeExport) recipeImports.push({ imported, specifier: match[2] });
      }
    }
    if (recipeImports.length !== 1 || recipeImports[0].imported !== recipeExport) {
      throw new Error(`${layout}: ${recipeExport} must have one unaliased recipe import`);
    }
    const recipe = resolveModule(layout, recipeImports[0].specifier);
    if (!/\.recipe\.(?:ts|tsx|js|jsx)$/.test(recipe)) {
      throw new Error(`${layout}: ${recipeExport} must come from a *.recipe module`);
    }
    const layoutExport = `${name}Layout`;
    if (!new RegExp(`\\bexport\\s+const\\s+${layoutExport}\\b`).test(source)) {
      throw new Error(`${layout}: expected public Layout export ${layoutExport}`);
    }
    const discoveredTypes = exportedTypes(source);
    if (propsType && !discoveredTypes.includes(propsType)) {
      throw new Error(`${layout}: props type ${propsType} must be exported`);
    }
    const typeExports = propsType
      ? [propsType, ...discoveredTypes.filter((name) => name !== propsType)]
      : discoveredTypes;
    return {
      name,
      entry: "index.ts",
      recipe: portable(relative(sourceRoot, recipe)),
      recipeExport,
      layout: portable(relative(sourceRoot, layout)),
      layoutExport,
      propsType,
      typeExports,
    };
  });
  const names = new Set();
  for (const component of components) {
    if (names.has(component.name)) {
      throw new Error(`Layout library declares component ${component.name} more than once`);
    }
    names.add(component.name);
  }
  return components;
}

function assertInside(root, path, label) {
  const fromRoot = relative(root, path);
  if (!fromRoot || fromRoot.startsWith(`..${sep}`) || fromRoot === "..") {
    throw new Error(`${label} must be a child of ${root}: ${path}`);
  }
}

function formatDiagnostics(filename, diagnostics) {
  return diagnostics
    .map((diagnostic) =>
      `${filename}:${diagnostic.line}:${diagnostic.column}: ${diagnostic.severity}: ${diagnostic.message}`,
    )
    .join("\n");
}

function compileFile(source, filename, libraryOutput = "layout", solid = 1) {
  const result = transform(source, filename, { mode: "library", libraryOutput, solid });
  if (result.failed) throw new Error(formatDiagnostics(filename, result.diagnostics));
  return result.code;
}

function lintLibrary(options = {}) {
  const root = resolve(options.root || process.cwd());
  const { configPath, config } = readLibraryConfig(root, options);
  const sourceRoot = resolve(root, config.source || "src");
  assertInside(root, sourceRoot, "source directory");
  const files = filesBelow(sourceRoot)
    .filter((filename) => /\.(?:ts|tsx|js|jsx)$/.test(filename))
    .map((filename) => ({ filename, source: readFileSync(filename, "utf8") }));
  let diagnostics = lintProject(files);
  const fingerprint = (item) =>
    `${relative(root, item.filename).split(sep).join("/")}:${item.severity}:${item.rule}:${item.message}`;
  const baselinePath = config.lint?.baseline
    ? resolve(root, config.lint.baseline)
    : undefined;
  const current = diagnostics.map(fingerprint).sort();
  if (options.updateBaseline) {
    if (!baselinePath) throw new Error(`${configPath || root} has no lint.baseline path`);
    writeJson(baselinePath, { format: "solid-layouts-lint-baseline-v1", diagnostics: current });
  }
  if (baselinePath && existsSync(baselinePath)) {
    const baseline = readJson(baselinePath);
    if (baseline.format !== "solid-layouts-lint-baseline-v1" || !Array.isArray(baseline.diagnostics)) {
      throw new Error(`invalid Layout lint baseline: ${baselinePath}`);
    }
    const allowed = new Map();
    for (const item of baseline.diagnostics) allowed.set(item, (allowed.get(item) || 0) + 1);
    diagnostics = diagnostics.map((item) => {
      const key = fingerprint(item);
      const remaining = allowed.get(key) || 0;
      if (remaining === 0) return item;
      allowed.set(key, remaining - 1);
      return { ...item, baseline: true };
    });
    const stale = [...allowed.values()].some((count) => count > 0);
    if (stale && !options.updateBaseline) {
      diagnostics.push({
        filename: baselinePath,
        rule: "baseline-stale",
        severity: "error",
        message: "Layout lint debt was removed; update the baseline so it cannot return unnoticed",
        line: 1,
        column: 1,
      });
    }
  }
  return {
    root,
    sourceRoot,
    diagnostics,
    failed: diagnostics.some((item) =>
      !item.baseline &&
      (item.severity === "error" || (config.lint?.warningsAsErrors && item.severity === "warning")),
    ),
  };
}

/**
 * Why source mode asks for a list when nothing else does.
 *
 * Convention-based discovery reads every `*.layout.tsx` and emits a `generated`
 * manifest entry carrying the recipe, the Layout and their exports, so the
 * application compiler can verify the join. Source mode generates alongside an
 * existing package instead, where the public surface is whatever that package's
 * own barrel exports, including parts like `AccordionItem` that share a parent's
 * layout file and have no file of their own. The compiler cannot infer that, so
 * source mode is told.
 *
 * The old message said only "must declare its public Layout exports", which
 * reads as a missing field rather than as a consequence of the mode, and sends
 * you to write the list rather than to ask whether you wanted the mode. The
 * documentation says no authored component manifest is required, and for
 * convention-based discovery that is true.
 */
function sourceModeExportsMessage(configPath) {
  return [
    `${configPath}: source mode needs an "exports" array naming this package's public components.`,
    "",
    'Only `mode: "source"` needs one. Convention-based discovery derives the manifest from',
    "every `*.layout.tsx` it finds, and emits richer entries the application compiler can",
    "verify; source mode generates alongside a package whose public surface it cannot see,",
    "so the list is how it learns the names.",
    "",
    "If this package does not need adjacent generation, delete the config and let discovery",
    "do it. If it does, the list has to be kept in step with the barrel by hand: nothing",
    "compares them, and a rename that misses it leaves the manifest naming components that",
    "no longer exist while rejecting the ones that do.",
  ].join("\n");
}

function generateLibrarySource(options = {}) {
  const root = resolve(options.root || process.cwd());
  const { configPath, config } = readLibraryConfig(root, options);
  const solid = options.solid ?? config.solid;
  if (config.mode !== "source") {
    throw new Error(`${configPath || root} must set mode to "source" for adjacent generation`);
  }
  if (!Array.isArray(config.exports) || config.exports.length === 0) {
    throw new Error(sourceModeExportsMessage(configPath));
  }
  const lint = lintLibrary({ ...options, root });
  if (lint.failed) {
    throw new Error(lint.diagnostics.map((item) =>
      `${item.filename}:${item.line}:${item.column}: ${item.severity}: ${item.message}`,
    ).join("\n"));
  }

  let changed = 0;
  for (const input of filesBelow(lint.sourceRoot)) {
    if (!/\.layout\.(tsx|jsx)$/.test(input)) continue;
    const output = input.replace(/\.layout\.(tsx|jsx)$/, ".generated.$1");
    const compiled = `${compileFile(readFileSync(input, "utf8"), input, "component", solid).trimEnd()}\n`;
    const current = existsSync(output) ? readFileSync(output, "utf8") : "";
    if (current === compiled) continue;
    if (options.check) {
      throw new Error(`${output} is stale; run solid-layouts-library --generate`);
    }
    writeFileSync(output, compiled);
    changed += 1;
  }
  return { ...lint, changed };
}

function emitSourceManifest(options = {}) {
  const root = resolve(options.root || process.cwd());
  const { configPath, config } = readLibraryConfig(root, options);
  if (config.mode !== "source") throw new Error(`${configPath || root} is not a source library config`);
  const exports = config.exports || [];
  if (exports.length === 0) throw new Error(sourceModeExportsMessage(configPath));
  const duplicates = exports.filter((name, index) => exports.indexOf(name) !== index);
  if (duplicates.length) throw new Error(`${configPath} repeats Layout export ${duplicates[0]}`);
  const sourcePackage = readJson(resolve(root, "package.json"));
  const outputRoot = resolve(root, config.output || "dist");
  const components = Object.fromEntries(
    [...exports].sort().map((name) => [name, { kind: "embedded" }]),
  );
  const manifest = {
    format: FORMAT,
    package: sourcePackage.name,
    version: sourcePackage.version,
    components,
  };
  mkdirSync(outputRoot, { recursive: true });
  writeJson(resolve(outputRoot, "layouts.manifest.json"), manifest);
  return { root, outputRoot, manifest };
}

function modulePath(fromFile, toFile) {
  let specifier = relative(dirname(fromFile), toFile).split(sep).join("/");
  specifier = specifier.replace(/\.(ts|tsx|js|jsx)$/, "");
  return specifier.startsWith(".") ? specifier : `./${specifier}`;
}

function generateEntries(components, outputRoot, solid) {
  const entries = new Map();
  for (const component of components) {
    const entry = resolve(outputRoot, component.entry);
    const generatedLayout = resolve(
      outputRoot,
      component.layout.replace(/\.layout\.(tsx|jsx)$/, ".generated.$1"),
    );
    const recipe = resolve(outputRoot, component.recipe);
    const lines = entries.get(entry) || [
      `import { defineComponent as __defineLayoutComponent } from "${boundaryFor(solid).specifier}";`,
      'import type { Component as __LayoutComponent } from "solid-js";',
    ];
    const componentExpression = component.propsType
      ? `__defineLayoutComponent({ recipe: ${component.recipeExport}, layout: ${component.layoutExport} }) as __LayoutComponent<__${component.name}Props>`
      : `__defineLayoutComponent({ recipe: ${component.recipeExport}, layout: ${component.layoutExport} })`;
    lines.push(
      `import { ${component.layoutExport} } from ${JSON.stringify(modulePath(entry, generatedLayout))};`,
      `import { ${component.recipeExport} } from ${JSON.stringify(modulePath(entry, recipe))};`,
      ...(component.propsType
        ? [`import type { ${component.propsType} as __${component.name}Props } from ${JSON.stringify(modulePath(entry, generatedLayout))};`]
        : []),
      `export const ${component.name} = ${componentExpression};`,
    );
    if (component.typeExports?.length) {
      lines.push(
        `export type { ${component.typeExports.join(", ")} } from ${JSON.stringify(modulePath(entry, generatedLayout))};`,
      );
    }
    entries.set(entry, lines);
  }
  for (const [entry, lines] of entries) {
    mkdirSync(dirname(entry), { recursive: true });
    writeFileSync(entry, `${lines.join("\n")}\n`);
  }
}

function assertComponent(component, sourceRoot, outputRoot, solid) {
  for (const key of ["name", "entry", "recipe", "recipeExport", "layout", "layoutExport"]) {
    if (!component[key]) throw new Error(`component entry is missing ${key}`);
  }

  const sourceLayout = resolve(sourceRoot, component.layout);
  const sourceRecipe = resolve(sourceRoot, component.recipe);
  const generatedLayout = resolve(
    outputRoot,
    component.layout.replace(/\.layout\.(tsx|jsx)$/, ".generated.$1"),
  );
  const generatedRecipe = resolve(outputRoot, component.recipe);
  const generatedEntry = resolve(outputRoot, component.entry);

  for (const [label, path] of [
    ["layout", sourceLayout],
    ["recipe", sourceRecipe],
    ["generated layout", generatedLayout],
    ["generated recipe", generatedRecipe],
    ["generated entry", generatedEntry],
  ]) {
    if (!existsSync(path)) throw new Error(`${component.name}: ${label} not found: ${path}`);
  }

  const layoutInput = readFileSync(sourceLayout, "utf8");
  const layoutOutput = readFileSync(generatedLayout, "utf8");
  const recipeOutput = readFileSync(generatedRecipe, "utf8");
  const entryOutput = readFileSync(generatedEntry, "utf8");

  if (!new RegExp(
    `\\bLayout\\s*<\\s*typeof\\s+${escapeRegExp(component.recipeExport)}\\b`,
  ).test(layoutInput)) {
    throw new Error(
      `${component.name}: ${component.layout} does not name ${component.recipeExport} in its Layout annotation`,
    );
  }
  let expectedRecipeImport = relative(dirname(sourceLayout), sourceRecipe)
    .split(sep)
    .join("/")
    .replace(/\.(ts|tsx|js|jsx)$/, "");
  if (!expectedRecipeImport.startsWith(".")) expectedRecipeImport = `./${expectedRecipeImport}`;
  const importsRecipe = [...layoutInput.matchAll(
    /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']([^"']+)["']/g,
  )].some((match) => {
    const bindings = match[1].split(",").map((binding) =>
      binding.trim().split(/\s+as\s+/).at(-1),
    );
    return match[2] === expectedRecipeImport && bindings.includes(component.recipeExport);
  });
  if (!importsRecipe) {
    throw new Error(
      `${component.name}: ${component.layout} does not import ${component.recipeExport} from ${expectedRecipeImport}`,
    );
  }
  if (!recipeOutput.includes(`export const ${component.recipeExport}`)) {
    throw new Error(
      `${component.name}: ${component.recipe} does not export ${component.recipeExport}`,
    );
  }
  if (!recipeOutput.includes("_layouts:")) {
    throw new Error(`${component.name}: ${component.recipe} did not compile to a static recipe table`);
  }
  if (!layoutOutput.includes(component.layoutExport)) {
    throw new Error(
      `${component.name}: generated layout does not export ${component.layoutExport}`,
    );
  }
  if (!entryOutput.includes(boundaryFor(solid).specifier)) {
    throw new Error(`${component.name}: ${component.entry} has no application compiler boundary`);
  }

  const renderedSlots = new Set(
    [...layoutOutput.matchAll(/\bslot\.([A-Za-z_$][\w$]*)/g)].map((match) => match[1]),
  );
  if (/\bslot\s*\[/.test(layoutOutput)) {
    throw new Error(`${component.name}: computed slot access cannot be validated statically`);
  }
  const declaredSlotList = [
    ...recipeOutput.matchAll(/["']([A-Za-z_$][\w$-]*)["']:\{base:/g),
  ].map((match) => match[1]);
  const declaredSlots = new Set(declaredSlotList);
  if (declaredSlots.size !== declaredSlotList.length) {
    throw new Error(`${component.name}: ${component.recipeExport} declares a slot more than once`);
  }
  for (const slot of renderedSlots) {
    if (!declaredSlots.has(slot)) {
      throw new Error(
        `${component.name}: rendered slot ${slot} is not declared by ${component.recipeExport}`,
      );
    }
  }
  for (const slot of declaredSlots) {
    if (!renderedSlots.has(slot)) {
      throw new Error(
        `${component.name}: declared slot ${slot} is not rendered by ${component.layoutExport}`,
      );
    }
  }

  const generatedRelative = relative(outputRoot, generatedLayout).split(sep).join("/");
  return {
    kind: "generated",
    entry: `./${component.entry}`,
    recipe: `./${component.recipe}`,
    recipeExport: component.recipeExport,
    layout: `./${generatedRelative}`,
    layoutExport: component.layoutExport,
  };
}

function compileLibrary(options = {}) {
  const root = resolve(options.root || process.cwd());
  const { configPath, config } = readLibraryConfig(root, options);
  if (config.mode === "source") return generateLibrarySource({ ...options, root });
  const solid = options.solid ?? config.solid;
  const sourceRoot = resolve(root, config.source || "src");
  const outputRoot = resolve(root, config.output || "bundle");
  const sourcePackage = readJson(resolve(root, "package.json"));

  assertInside(root, sourceRoot, "source directory");
  assertInside(root, outputRoot, "output directory");
  if (sourceRoot === outputRoot || outputRoot.startsWith(`${sourceRoot}${sep}`)) {
    throw new Error("output directory must not be inside the authored source directory");
  }

  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });

  for (const input of filesBelow(sourceRoot)) {
    const fromSource = relative(sourceRoot, input);
    if (/\.generated\.(tsx|jsx)$/.test(fromSource)) continue;

    const isLayout = /\.layout\.(tsx|jsx)$/.test(fromSource);
    const outputRelative = isLayout
      ? fromSource.replace(/\.layout\.(tsx|jsx)$/, ".generated.$1")
      : fromSource;
    const output = resolve(outputRoot, outputRelative);
    mkdirSync(dirname(output), { recursive: true });

    if (isLayout || /\.recipe\.(ts|tsx|js|jsx)$/.test(fromSource)) {
      const compiled = compileFile(readFileSync(input, "utf8"), input, "layout", solid);
      writeFileSync(output, compiled);
      const parsed = transform(compiled, output, { mode: "library", parseOnly: true });
      if (parsed.failed) throw new Error(formatDiagnostics(output, parsed.diagnostics));
    } else {
      copyFileSync(input, output);
    }
  }

  const configuredComponents = config.components || discoverComponents(sourceRoot);
  generateEntries(configuredComponents, outputRoot, solid);

  const components = {};
  for (const component of configuredComponents) {
    components[component.name] = assertComponent(component, sourceRoot, outputRoot, solid);
  }
  if (Object.keys(components).length === 0) {
    throw new Error(`${configPath || sourceRoot} must contain at least one Layout component`);
  }

  const manifest = {
    format: FORMAT,
    package: sourcePackage.name,
    version: sourcePackage.version,
    components,
  };
  writeJson(resolve(outputRoot, "layouts.manifest.json"), manifest);

  const packageJson = {
    name: sourcePackage.name,
    version: sourcePackage.version,
    description: sourcePackage.description,
    license: sourcePackage.license,
    private: sourcePackage.private === true || undefined,
    type: "module",
    sideEffects: sourcePackage.sideEffects ?? ["**/*.css"],
    types: "./index.ts",
    exports: {
      ".": {
        types: "./index.ts",
        import: "./index.ts",
      },
      "./layouts": "./layouts.manifest.json",
      "./package.json": "./package.json",
    },
    files: ["**/*"],
    peerDependencies: sourcePackage.peerDependencies,
    dependencies: sourcePackage.dependencies,
    solidLayouts: "./layouts.manifest.json",
  };
  writeJson(resolve(outputRoot, "package.json"), packageJson);

  return { root, sourceRoot, outputRoot, manifest };
}

function pluginSolidLayoutsLibrary(options = {}) {
  return {
    name: options.solid === 2 ? "solid-layouts:library:solid-2" : "solid-layouts:library",
    setup(api) {
      const root = resolve(options.root || api.context.rootPath);
      const { config } = readLibraryConfig(root, options);
      const solid = options.solid ?? config.solid;
      const compile = () =>
        compileLibrary({
          ...options,
          root,
        });
      api.onBeforeBuild(compile);
      api.onBeforeDevCompile(compile);
      if (config.mode === "source") {
        const sourceRoot = resolve(root, config.source || "src");
        api.modifyBundlerChain({
          order: "pre",
          handler(chain) {
            chain.module
              .rule("solid-layouts-library")
              .test(/\.recipe\.(?:js|jsx|ts|tsx)$/)
              .include.add(sourceRoot)
              .end()
              .use("solid-layouts-library")
              .loader(require.resolve("./loader.js"))
              .options({ mode: "library", libraryOutput: "layout", solid });
          },
        });
        api.onAfterBuild(() => emitSourceManifest({ ...options, root }));
      }
    },
  };
}

/**
 * The Solid 2.0 form of the library plugin. See its application twin for why
 * this is a second exported name rather than an option on the first.
 */
function pluginSolid2LayoutsLibrary(options = {}) {
  return pluginSolidLayoutsLibrary({ ...options, solid: 2 });
}

module.exports = {
  FORMAT,
  compileLibrary,
  generateLibrarySource,
  emitSourceManifest,
  lintLibrary,
  pluginSolid2LayoutsLibrary,
  pluginSolidLayoutsLibrary,
};
