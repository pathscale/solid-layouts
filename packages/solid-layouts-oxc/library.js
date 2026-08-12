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
const { dirname, extname, relative, resolve, sep } = require("node:path");
const { transform } = require("./index.js");

const FORMAT = "solid-layouts-library-v1";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
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

function compileFile(source, filename) {
  const result = transform(source, filename, { mode: "library" });
  if (result.failed) throw new Error(formatDiagnostics(filename, result.diagnostics));
  return result.code;
}

function modulePath(fromFile, toFile) {
  let specifier = relative(dirname(fromFile), toFile).split(sep).join("/");
  specifier = specifier.replace(/\.(ts|tsx|js|jsx)$/, "");
  return specifier.startsWith(".") ? specifier : `./${specifier}`;
}

function generateEntries(components, outputRoot) {
  const entries = new Map();
  for (const component of components) {
    const entry = resolve(outputRoot, component.entry);
    const generatedLayout = resolve(
      outputRoot,
      component.layout.replace(/\.layout\.(tsx|jsx)$/, ".generated.$1"),
    );
    const recipe = resolve(outputRoot, component.recipe);
    const lines = entries.get(entry) || [
      'import { defineComponent as __defineLayoutComponent } from "solid-layouts/application-boundary";',
    ];
    lines.push(
      `import { ${component.layoutExport} } from ${JSON.stringify(modulePath(entry, generatedLayout))};`,
      `import { ${component.recipeExport} } from ${JSON.stringify(modulePath(entry, recipe))};`,
      `export const ${component.name} = __defineLayoutComponent({ recipe: ${component.recipeExport}, layout: ${component.layoutExport} });`,
    );
    entries.set(entry, lines);
  }
  for (const [entry, lines] of entries) {
    mkdirSync(dirname(entry), { recursive: true });
    writeFileSync(entry, `${lines.join("\n")}\n`);
  }
}

function assertComponent(component, sourceRoot, outputRoot) {
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

  if (!layoutInput.includes(`Layout<typeof ${component.recipeExport}`)) {
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
  if (!entryOutput.includes("solid-layouts/application-boundary")) {
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
    entry: `./${component.entry}`,
    recipe: `./${component.recipe}`,
    recipeExport: component.recipeExport,
    layout: `./${generatedRelative}`,
    layoutExport: component.layoutExport,
  };
}

function compileLibrary(options = {}) {
  const root = resolve(options.root || process.cwd());
  const configPath = resolve(root, options.config || "layouts.library.json");
  const config = readJson(configPath);
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
      const compiled = compileFile(readFileSync(input, "utf8"), input);
      writeFileSync(output, compiled);
      const parsed = transform(compiled, output, { mode: "library", parseOnly: true });
      if (parsed.failed) throw new Error(formatDiagnostics(output, parsed.diagnostics));
    } else {
      copyFileSync(input, output);
    }
  }

  const configuredComponents = config.components || [];
  generateEntries(configuredComponents, outputRoot);

  const components = {};
  for (const component of configuredComponents) {
    components[component.name] = assertComponent(component, sourceRoot, outputRoot);
  }
  if (Object.keys(components).length === 0) {
    throw new Error(`${configPath} must declare at least one component`);
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
    name: "solid-layouts:library",
    setup(api) {
      const compile = () =>
        compileLibrary({
          ...options,
          root: options.root || api.context.rootPath,
        });
      api.onBeforeBuild(compile);
      api.onBeforeDevCompile(compile);
    },
  };
}

module.exports = { FORMAT, compileLibrary, pluginSolidLayoutsLibrary };
