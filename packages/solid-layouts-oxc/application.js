"use strict";

const { existsSync, readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { dirname, relative, resolve, sep } = require("node:path");
const { transform } = require("./index.js");

const FORMAT = "solid-layouts-library-v1";
const APPLICATION_BOUNDARY = "solid-layouts/application-boundary";

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${path}\n${error.message}`);
  }
}

function assertInside(root, path, label) {
  const fromRoot = relative(root, path);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
    throw new Error(`${label} must resolve inside ${root}: ${path}`);
  }
}

function resolvePackageJson(root, module) {
  const requireFromRoot = createRequire(resolve(root, "package.json"));
  try {
    return requireFromRoot.resolve(`${module}/package.json`);
  } catch (error) {
    throw new Error(`configured Layout package ${JSON.stringify(module)} cannot be resolved from ${root}\n${error.message}`);
  }
}

function requiredFile(packageRoot, path, label) {
  const absolute = resolve(packageRoot, path);
  assertInside(packageRoot, absolute, label);
  if (!existsSync(absolute)) throw new Error(`${label} not found: ${absolute}`);
  return absolute;
}

function publicEntryFrom(packageJson) {
  const rootExport = packageJson.exports?.["."];
  if (typeof rootExport === "string") return rootExport;
  if (rootExport && typeof rootExport === "object") {
    for (const condition of ["import", "default"]) {
      if (typeof rootExport[condition] === "string") return rootExport[condition];
    }
  }
  for (const field of ["module", "main"]) {
    if (typeof packageJson[field] === "string") return packageJson[field];
  }
  throw new Error(`${packageJson.name} has no public JavaScript entry`);
}

function validateComponent(module, packageRoot, name, component) {
  for (const key of ["entry", "recipe", "recipeExport", "layout", "layoutExport"]) {
    if (!component?.[key]) {
      throw new Error(`${module}: component ${name} is missing manifest field ${key}`);
    }
  }

  const entry = requiredFile(packageRoot, component.entry, `${module}: ${name} entry`);
  const recipe = requiredFile(packageRoot, component.recipe, `${module}: ${name} recipe`);
  const layout = requiredFile(packageRoot, component.layout, `${module}: ${name} generated Layout`);
  const entrySource = readFileSync(entry, "utf8");
  const recipeSource = readFileSync(recipe, "utf8");
  const layoutSource = readFileSync(layout, "utf8");
  const identifier = /^[A-Za-z_$][\w$]*$/;
  for (const [label, value] of [
    ["public export", name],
    ["recipe export", component.recipeExport],
    ["Layout export", component.layoutExport],
  ]) {
    if (!identifier.test(value)) {
      throw new Error(`${module}: ${name} ${label} is not a valid identifier: ${value}`);
    }
  }

  if (!entrySource.includes(APPLICATION_BOUNDARY)) {
    throw new Error(`${module}: ${name} entry has no application compiler boundary`);
  }
  if (!new RegExp(`\\bexport\\s+const\\s+${component.recipeExport}\\b`).test(recipeSource)) {
    throw new Error(`${module}: ${name} recipe export ${component.recipeExport} was not found`);
  }
  if (!new RegExp(`\\bexport\\s+const\\s+${component.layoutExport}\\b`).test(layoutSource)) {
    throw new Error(`${module}: ${name} Layout export ${component.layoutExport} was not found`);
  }
  const callSite = `export const ${name} = __defineLayoutComponent({ recipe: ${component.recipeExport}, layout: ${component.layoutExport} })`;
  if (!entrySource.includes(callSite)) {
    throw new Error(`${module}: ${name} entry call site disagrees with its Layout manifest record`);
  }
}

function resolveLayoutSource(root, configured) {
  const module = typeof configured === "string" ? configured : configured.module;
  if (!module) throw new Error("configured Layout source is missing its module name");
  const packageRoot = typeof configured === "string"
    ? dirname(resolvePackageJson(root, module))
    : resolve(root, configured.root);
  const packageJsonPath = requiredFile(packageRoot, "package.json", `${module} package metadata`);
  const packageJson = readJson(packageJsonPath, `${module} package metadata`);
  if (packageJson.name !== module) {
    throw new Error(`resolved package ${packageJson.name} does not match configured Layout source ${module}`);
  }
  if (typeof packageJson.solidLayouts !== "string" || !packageJson.solidLayouts) {
    throw new Error(`${module} has no solidLayouts field in ${packageJsonPath}`);
  }
  if (typeof packageJson.peerDependencies?.["solid-layouts"] !== "string") {
    throw new Error(`${module} must declare solid-layouts as a peer dependency`);
  }
  const publicEntry = requiredFile(
    packageRoot,
    publicEntryFrom(packageJson),
    `${module} public entry`,
  );

  const manifestPath = requiredFile(
    packageRoot,
    packageJson.solidLayouts,
    `${module} Layout manifest`,
  );
  const manifest = readJson(manifestPath, `${module} Layout manifest`);
  if (manifest.format !== FORMAT) {
    throw new Error(`${module} uses unsupported Layout manifest format ${JSON.stringify(manifest.format)}`);
  }
  if (manifest.package !== module) {
    throw new Error(`${module} manifest claims package identity ${JSON.stringify(manifest.package)}`);
  }

  const components = manifest.components;
  if (!components || typeof components !== "object" || Array.isArray(components)) {
    throw new Error(`${module} Layout manifest has no component index`);
  }
  const exports = Object.keys(components).sort();
  if (exports.length === 0) throw new Error(`${module} Layout manifest has no components`);
  for (const name of exports) validateComponent(module, packageRoot, name, components[name]);

  return {
    module,
    exports,
    publicEntry,
    packageRoot,
    packageJsonPath,
    manifestPath,
    manifest,
  };
}

function compileApplication(options = {}) {
  const root = resolve(options.root || process.cwd());
  const layouts = options.layouts || ["@pathscale/ui"];
  if (!Array.isArray(layouts) || layouts.length === 0) {
    throw new Error("application compiler requires at least one Layout package");
  }
  const sources = layouts.map((configured) => resolveLayoutSource(root, configured));
  return {
    root,
    sources,
    layoutSources: sources.map(({ module, exports, publicEntry }) => ({
      module,
      exports,
      resolved: publicEntry,
    })),
  };
}

function compileApplicationFile(source, filename, application) {
  const result = transform(source, filename, {
    mode: "application",
    layoutSources: application.layoutSources,
  });
  if (result.failed) {
    const diagnostics = result.diagnostics
      .map((diagnostic) =>
        `${filename}:${diagnostic.line}:${diagnostic.column}: ${diagnostic.severity}: ${diagnostic.message}`,
      )
      .join("\n");
    throw new Error(diagnostics);
  }
  return result;
}

function pluginSolidLayoutsApplication(options = {}) {
  return {
    name: "solid-layouts:application",
    enforce: "post",
    setup(api) {
      const application = compileApplication({
        ...options,
        root: options.root || api.context.rootPath,
      });
      const runtime = options.runtime
        ? resolve(application.root, options.runtime)
        : createRequire(resolve(application.root, "package.json")).resolve("solid-layouts");
      if (!existsSync(runtime)) throw new Error(`solid-layouts runtime not found: ${runtime}`);

      api.modifyBundlerChain({
        order: "post",
        handler(chain) {
          chain.resolve.alias.set(APPLICATION_BOUNDARY, runtime);
          chain.module
            .rule("solid-layouts-application")
            .after("babel-js")
            .test(/\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/)
            .include.add(resolve(application.root, options.include || "src"))
            .end()
            .use("solid-layouts-application")
            .loader(require.resolve("./loader.js"))
            .options({
              mode: "application",
              layoutSources: application.layoutSources,
            });
        },
      });
    },
  };
}

module.exports = {
  APPLICATION_BOUNDARY,
  FORMAT,
  compileApplication,
  compileApplicationFile,
  pluginSolidLayoutsApplication,
  resolveLayoutSource,
};
