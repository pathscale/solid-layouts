"use strict";

const { existsSync, readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { dirname, relative, resolve, sep } = require("node:path");
const { transform } = require("./index.js");

const FORMAT = "solid-layouts-library-v2";
const APPLICATION_BOUNDARY = "solid-layouts/application-boundary";
const SOLID_2_APPLICATION_BOUNDARY = "solid-layouts/solid-2/application-boundary";

/**
 * The specifier a generated component imports its boundary from, and the
 * `solid-layouts` subpath that specifier has to resolve to.
 *
 * Two entries because the runtime is published twice: Solid 2.0 moved
 * `Dynamic` and `createComponent` out of `solid-js/web` and dropped that
 * subpath, so one build cannot serve both majors. The specifier is spelled out
 * in the generated file rather than resolved by a bundler condition, which
 * means `grep` answers which runtime a build is on and a mismatch reads as a
 * wrong-looking import rather than as a resolve failure two layers down.
 */
function boundaryFor(solid) {
  if (solid === undefined || solid === 1) {
    return { specifier: APPLICATION_BOUNDARY, subpath: "." };
  }
  if (solid === 2) {
    return { specifier: SOLID_2_APPLICATION_BOUNDARY, subpath: "./solid-2" };
  }
  throw new Error(`unknown solid major: ${solid}`);
}

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
    for (const searchRoot of requireFromRoot.resolve.paths(module) || []) {
      const packageJsonPath = resolve(searchRoot, module, "package.json");
      if (existsSync(packageJsonPath)) return packageJsonPath;
    }
    throw new Error(`configured Layout package ${JSON.stringify(module)} cannot be resolved from ${root}\n${error.message}`);
  }
}

function requiredFile(packageRoot, path, label) {
  const absolute = resolve(packageRoot, path);
  assertInside(packageRoot, absolute, label);
  if (!existsSync(absolute)) throw new Error(`${label} not found: ${absolute}`);
  return absolute;
}

function publicEntryFrom(packageJson, subpath = ".") {
  const rootExport = packageJson.exports?.[subpath];
  if (typeof rootExport === "string") return rootExport;
  if (rootExport && typeof rootExport === "object") {
    for (const condition of ["import", "default"]) {
      if (typeof rootExport[condition] === "string") return rootExport[condition];
    }
  }
  // Only the root entry has the legacy fields to fall back on. A named subpath
  // that is missing is a version of the runtime the installed package does not
  // publish, which is worth saying plainly rather than silently serving the
  // wrong major from `main`.
  if (subpath !== ".") {
    throw new Error(
      `${packageJson.name}@${packageJson.version} does not export ${subpath}; it predates Solid 2 support`,
    );
  }
  for (const field of ["module", "main"]) {
    if (typeof packageJson[field] === "string") return packageJson[field];
  }
  throw new Error(`${packageJson.name} has no public JavaScript entry`);
}

function exportTarget(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const condition of ["import", "default"]) {
      const target = exportTarget(value[condition]);
      if (target) return target;
    }
  }
}

function publicSubpathForTarget(module, packageJson, packageRoot, target) {
  const targetPath = relative(packageRoot, target).split(sep).join("/");
  for (const [subpath, value] of Object.entries(packageJson.exports || {})) {
    if (subpath === "." || !subpath.startsWith("./")) continue;
    const pattern = exportTarget(value);
    if (!pattern?.startsWith("./")) continue;
    const targetPattern = pattern.slice(2);
    const wildcard = targetPattern.indexOf("*");
    if (wildcard === -1) {
      if (targetPath === targetPattern) return `${module}${subpath.slice(1)}`;
      continue;
    }
    const prefix = targetPattern.slice(0, wildcard);
    const suffix = targetPattern.slice(wildcard + 1);
    if (!targetPath.startsWith(prefix) || !targetPath.endsWith(suffix)) continue;
    const matched = targetPath.slice(prefix.length, targetPath.length - suffix.length);
    return `${module}${subpath.slice(1).replace("*", matched)}`;
  }
}

function namedExports(entry) {
  const source = readFileSync(entry, "utf8");
  const names = new Set();
  const declaration = /export\s*\{([^}]+)\}(?:\s*from\s*["'][^"']+["'])?;?/g;
  for (const match of source.matchAll(declaration)) {
    for (const value of match[1].split(",")) {
      const parts = value.trim().replace(/^type\s+/, "").split(/\s+as\s+/);
      const exported = (parts[1] || parts[0])?.trim();
      if (exported) names.add(exported);
    }
  }
  return names;
}

function publicSubpathSources(source) {
  const entrySource = readFileSync(source.publicEntry, "utf8");
  const publicComponents = new Set(source.exports);
  const subpaths = new Map();
  const reexport = /export\s*\{([^}]+)\}\s*from\s*["']([^"']+)["'];?/g;
  for (const match of entrySource.matchAll(reexport)) {
    const specifier = match[2];
    if (!specifier.startsWith(".")) continue;
    const target = resolve(dirname(source.publicEntry), specifier);
    if (!existsSync(target)) continue;
    const module = publicSubpathForTarget(
      source.module,
      source.packageJson,
      source.packageRoot,
      target,
    );
    if (!module) continue;
    const subpath = subpaths.get(module) || { module, exports: new Set(), resolved: target };
    for (const name of namedExports(target)) {
      if (publicComponents.has(name)) subpath.exports.add(name);
    }
    for (const declaration of match[1].split(",")) {
      const parts = declaration.trim().split(/\s+as\s+/);
      const imported = parts[0]?.trim();
      const exported = (parts[1] || parts[0])?.trim();
      if (imported && exported && publicComponents.has(exported)) {
        subpath.exports.add(imported);
      }
    }
    subpaths.set(module, subpath);
  }
  return [...subpaths.values()]
    .map(({ module, exports, resolved }) => ({
      module,
      exports: [...exports].sort(),
      resolved,
    }))
    .sort((a, b) => a.module.localeCompare(b.module));
}

function resolvePublicPackageEntry(root, module, subpath = ".") {
  const packageJsonPath = resolvePackageJson(root, module);
  const packageRoot = dirname(packageJsonPath);
  const packageJson = readJson(packageJsonPath, `${module} package metadata`);
  if (packageJson.name !== module) {
    throw new Error(`resolved package ${packageJson.name} does not match ${module}`);
  }
  return requiredFile(
    packageRoot,
    publicEntryFrom(packageJson, subpath),
    `${module} public entry`,
  );
}

function validateComponent(module, packageRoot, name, component) {
  if (component?.kind === "embedded") return;
  if (component?.kind !== "generated") {
    throw new Error(`${module}: component ${name} has unsupported manifest kind ${JSON.stringify(component?.kind)}`);
  }
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
    packageJson,
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
  const rootSources = sources.map(({ module, exports, publicEntry }) => ({
    module,
    exports,
    resolved: publicEntry,
  }));
  return {
    root,
    sources,
    layoutSources: [...rootSources, ...sources.flatMap(publicSubpathSources)],
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
  const boundary = boundaryFor(options.solid);
  return {
    name: options.solid === 2 ? "solid-layouts:application:solid-2" : "solid-layouts:application",
    enforce: "post",
    setup(api) {
      const application = compileApplication({
        ...options,
        root: options.root || api.context.rootPath,
      });
      const runtime = options.runtime
        ? resolve(application.root, options.runtime)
        : resolvePublicPackageEntry(application.root, "solid-layouts", boundary.subpath);
      if (!existsSync(runtime)) throw new Error(`solid-layouts runtime not found: ${runtime}`);

      api.modifyBundlerChain({
        order: "post",
        handler(chain) {
          chain.resolve.alias.set(boundary.specifier, runtime);
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

/**
 * The Solid 2.0 form of the application plugin.
 *
 * A separate exported name rather than an option the caller passes, because
 * the choice is not independent of the rest of the build: it has to agree with
 * `pluginSolid2()` and with the installed `solid-js`. A name that must match
 * its neighbour in the plugin list is easier to get right, and easier to read
 * back later, than a flag that must.
 */
function pluginSolid2LayoutsApplication(options = {}) {
  return pluginSolidLayoutsApplication({ ...options, solid: 2 });
}

module.exports = {
  APPLICATION_BOUNDARY,
  FORMAT,
  SOLID_2_APPLICATION_BOUNDARY,
  boundaryFor,
  compileApplication,
  compileApplicationFile,
  pluginSolid2LayoutsApplication,
  pluginSolidLayoutsApplication,
  resolveLayoutSource,
};
