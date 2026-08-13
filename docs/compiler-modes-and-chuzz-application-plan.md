# Compiler modes and the Chuzz application integration

For a command-by-command producer and consumer setup, start with [Getting started](./getting-started.md). This document defines the mode boundary and explains why the integration is shaped this way.

## Status

Both compiler passes now exist for the four-component proof. The library compiler produces the local Test-UI bundle from the authored Icon, Button, Flex, and Chip Layouts, and the application compiler consumes that bundle from Chuzz before the normal Solid transform. This is the working slice, not a claim that the complete UI library has been ported.

```text
A = user-authored Layout UI source
B = solid-layouts library compiler
C = npm-ready Layout UI bundle
D = user-authored Solid application
E = solid-layouts application compiler
F = executable JavaScript and assets

A + B     -> C
C + D + E -> F
```

`Test-UI` is the controlled producer fixture for A, B, and C. Chuzz is the first real consumer D. Another toy application is unnecessary.

## Mode is explicit

The compiler must never infer its mode from filenames, package contents, the presence of a manifest, or whether it happens to be running under Rslib or Rsbuild. A monorepo may build a library and an application in the same process, so inference would be ambiguous.

The two public JavaScript entry points are:

```ts
import {
  compileLibrary,
  pluginSolidLayoutsLibrary,
} from "solid-layouts-oxc/library";
```

and:

```ts
import {
  compileApplication,
  pluginSolidLayoutsApplication,
} from "solid-layouts-oxc/application";
```

The corresponding command-line entry points are:

```text
solid-layouts-library
solid-layouts-application
```

The supported host-level API is:

```ts
type LibraryOptions = {
  root?: string;
  config?: string;
};

compileLibrary(options?: LibraryOptions): {
  root: string;
  sourceRoot: string;
  outputRoot: string;
  manifest: LayoutManifest;
};

pluginSolidLayoutsLibrary(options?: LibraryOptions): RsbuildPlugin;

type LayoutPackage = string | {
  module: string;
  root: string;
};

type ApplicationOptions = {
  root?: string;
  layouts?: LayoutPackage[];
};

compileApplication(options?: ApplicationOptions): ApplicationIndex;
compileApplicationFile(
  source: string,
  filename: string,
  application: ApplicationIndex,
): TransformResult;

pluginSolidLayoutsApplication(options?: ApplicationOptions & {
  include?: string;
  runtime?: string;
}): RsbuildPlugin;
```

`compileLibrary` produces C. `compileApplication` resolves and validates all configured C packages and builds E's immutable module/export index. `compileApplicationFile` applies that index to one D source module. The two plugins connect those operations to build hosts. The object form of `LayoutPackage` and `runtime` are local-checkout overrides used by this test; published consumers should use package specifiers.

The root `solid-layouts-oxc` export remains the low-level native `transform` API for compiler hosts. `FORMAT`, `APPLICATION_BOUNDARY`, and `resolveLayoutSource` are implementation exports, not application authoring APIs.

Each public host passes an explicit mode into the shared native compiler:

```ts
type CompilerMode = "library" | "application";
```

The package root exports the existing low-level native API for compiler-host internals. It is not a third public mode: `transform` requires `mode: "library" | "application"`. `parseOnly` changes whether output is emitted; it does not select a mode.

Configuration also does not select a mode:

- `layouts.library.json` describes inputs and outputs after the library entry point has selected library mode.
- Application plugin options describe Layout package sources after the application entry point has selected application mode.

## Library mode: A + B -> C

Library mode owns package production. It:

1. Reads the library configuration.
2. Parses authored recipes and Layout templates.
3. Rewrites Layout template syntax into valid generated Solid TSX.
4. Compiles static recipe lookup data.
5. Validates the exact recipe-to-Layout relationship.
6. Validates declared and rendered slots.
7. Emits package entry call sites.
8. Emits `layouts.manifest.json`.
9. Emits npm package metadata with a `solidLayouts` discovery field.
10. Packs only C, never the invalid authored `.layout.tsx` input.

Library mode does not inspect an application import graph and does not perform application matching.

## Application mode: C + D + E -> F

Application mode owns package consumption. It does not regenerate C and does not accept authored library templates as a substitute for C.

For each configured Layout package, E must:

1. Resolve the package from the application using normal package resolution.
2. Read that package's `package.json`.
3. Require its `solidLayouts` field.
4. Resolve the referenced `layouts.manifest.json` inside that package.
5. Require a supported manifest format.
6. Validate that the manifest package identity agrees with the resolved package.
7. Validate every entry, recipe, generated Layout, and named export referenced by the manifest.
8. Require C to declare the shared `solid-layouts` runtime as a peer dependency.
9. Resolve C's public JavaScript entry.
10. Build an exact `(module specifier, public export) -> Layout record` index once per build.
11. Parse application modules before Solid lowers JSX.
12. Match each Layout component reference against that exact index.
13. Rewrite the configured package import to the validated public C entry.

The manifest lookup is exact. Merely listing a package name in configuration is not proof that one of its exports has a Layout.

```text
import { Icon as StatusIcon } from "@pathscale/test-ui"
             |                         |
             |                         +-- resolve C and its manifest
             +-- match public export Icon, not local alias StatusIcon
```

Named imports, aliases, and namespace member references retain enough origin information to resolve the public export rather than only the local binding name. C currently emits named component exports; default component exports are therefore outside the current package format instead of being guessed.

## Hard failures

E must stop the build when a configured Layout reference cannot be proven. There is no graceful fallback.

The following are errors:

- A configured Layout package cannot be resolved.
- Its package metadata has no `solidLayouts` field.
- Its manifest is missing or malformed.
- Its manifest format is unsupported.
- Its manifest claims a different package identity.
- An imported public export has no component record.
- A component record points to a missing entry, recipe, or generated Layout.
- A named recipe or Layout export is absent from its file.
- A package call site disagrees with its component record.
- A reference is ambiguous and cannot be resolved statically.

The diagnostic should point to the application import or JSX reference where possible, while manifest-integrity failures should identify the package and broken manifest field.

Ordinary Solid components are not automatically Layout components. E enforces imports from packages explicitly configured as Layout sources. This keeps the concern bounded and allows an application to use unrelated third-party Solid components without requiring those packages to adopt Solid Layouts.

## No-compiler behavior

C carries generated TSX and recipe data forward for E. It must also carry a compiler-owned application boundary so that removing E cannot silently produce F through an accidental runtime fallback.

The intended shape is a compiler-controlled import or marker in C's generated call site. For example:

```ts
import { defineLayoutComponent } from "solid-layouts/application-boundary";
```

The application plugin resolves or rewrites that boundary before normal module resolution and Solid compilation. Without E, the marker remains unresolved and the build fails. The exact marker spelling is an implementation decision; the required property is:

```text
No application compiler -> no executable application output
```

A helper that merely throws at runtime is insufficient because the missing compiler must be detected during the build.

## Implemented separation

The native transform has an explicit required mode. Library mode performs recipe and Layout generation without application matching. Application mode receives a manifest-derived module/export index and performs exact import-origin matching. The two hosts share the parser and diagnostics, but neither pass is inferred from filenames or configuration:

```text
shared parser, diagnostics and source utilities
                     |
          +----------+----------+
          |                     |
    library mode          application mode
    recipe/Layout         manifest-backed
    generation            import matching
```

The application host builds the exact export index from C once at plugin setup. The native matcher does not treat every export from a configured module as a Layout.

## Why Chuzz is the first consumer

Chuzz is a real Rsbuild/Solid application. It already consumes `@pathscale/ui`, renders Icon in multiple locations, disables code splitting, and is intended to expose both bundle cost and per-instance cost under Boa.

The integration changes Icon and Button because the current C fixture contains both. Existing `@pathscale/ui` remains in place for Flex, Chip, motion, CSS, and color types.

Conceptually, application source changes from:

```ts
import { Flex, Icon } from "@pathscale/ui";
```

to:

```ts
import { Flex } from "@pathscale/ui";
import { Button, Icon } from "@pathscale/test-ui";
```

This is not hand-generated component code. Chuzz imports the compiler-produced C package. The authored Layout, generated Layout TSX, compiled recipe table, and manifest remain owned by the producer/compiler pipeline.

In a normally installed application, Chuzz selects application mode explicitly in `rsbuild.config.ts`:

```ts
import { pluginSolidLayoutsApplication } from "solid-layouts-oxc/application";

export default defineConfig({
  plugins: [
    pluginSolidLayoutsApplication({
      layouts: ["@pathscale/test-ui"],
    }),
    pluginBabel(/* existing configuration */),
    pluginSolid(),
  ],
});
```

The application pass must see TSX before the Solid JSX transform lowers component and prop information.

For the current hands-on test, Chuzz uses the same API with `{ module, root }` and an explicit runtime path. Those two path overrides point at the system/local checkouts without installing anything:

```ts
pluginSolidLayoutsApplication({
  layouts: [{
    module: "@pathscale/test-ui",
    root: "../../../../solid-layouts/Test-UI/bundle",
  }],
  runtime: "../../../../solid-layouts/packages/solid-layouts/src/index.ts",
})
```

The published path remains `layouts: ["@pathscale/test-ui"]`; package resolution then locates C from Chuzz's dependency graph.

## First end-to-end proof

The positive path is:

```text
Test-UI authored Icon and Button
       |
       v
solid-layouts library compiler B
       |
       v
local npm-ready package C
       |
       +---------- Chuzz imports Icon and Button
                          |
                          v
              application compiler E
              resolves package metadata
              reads manifest
              matches exact public exports
              rewrites the package import to C
              validates generated Layout and recipe
                          |
                          v
                 normal Solid/Rsbuild flow
                          |
                          v
                    Chuzz output F
```

The implemented test matrix is:

1. Valid local C package accepts and rewrites both Icon and Button imports.
2. Importing an export absent from the manifest fails.
3. A configured package without the `solidLayouts` discovery field fails.
4. A corrupt or unsupported manifest fails.
5. A component record pointing at a missing generated Layout fails.
6. A generated entry that disagrees with its manifest record fails.
7. Removing the application compiler from the actual Chuzz build fails because the compiler boundary remains unresolved.

Small isolated fixtures are still appropriate for these negative cases. They test compiler diagnostics; they are not a replacement toy application.

## Implemented order and remaining work

The completed slice is:

1. Added the explicit compiler mode to the shared native options.
2. Made `solid-layouts-oxc/library` always select library mode.
3. Removed application matching from library mode.
4. Added `solid-layouts-oxc/application`, its CLI, and its Rsbuild/Rspack integration.
5. Added one-time package/manifest validation and an exact module/export index.
6. Passed that index to the native application matcher and preserved import aliases and namespace origins.
7. Added the unresolved compiler boundary to generated C entries.
8. Added positive and hard-failure compiler tests.
9. Made E resolve C's public entry and rewrite validated application imports instead of relying on a hand-written bundler alias.
10. Pointed Chuzz at the local compiler-produced C directory and local runtime, without installing packages.
11. Redirected Icon and Button imports in Chuzz to C and replaced the raw title-bar and inspector buttons with the compiled component.

The next work is manual Chuzz behavior review, settling the published package names/API types, publishing or installing a packed C through the normal dependency graph, expanding one component per commit, and measuring bundle delta and per-instance runtime cost in the target Boa environment.

## Runtime cost

B and E parse and transform source only during builds. They add no parser, AST, manifest walk, or template compiler to F.

The shared runtime is required by C and is bundled once by the application. For each mounted component, `defineComponent` splits incoming props by destination, allocates the stable slot interface, creates memos for the recipe selection and resolved slot attributes, and invokes the generated Layout. A compiled recipe indexes precomputed slot/axis tables; it does not rebuild the recipe declaration. Solid invalidates those memos when their reactive inputs change rather than rerunning them for unrelated DOM updates.

The expected risk is therefore initial mount and large-list creation, not steady-state browser rendering. The exact bundle-byte delta and mount/update time must be measured in Chuzz's production build and Boa target before a performance claim is accepted. Source inspection is enough to identify the work but not enough to turn it into a percentage.

## Responsibility boundaries

The separation is intentional:

| Concern | Owner |
| --- | --- |
| Authored recipe and Layout template | A |
| Template rewriting, recipe compilation, package manifest emission | B |
| Valid reusable Layout package artifact | C |
| Application components and Layout call sites | D |
| Package discovery, exact matching, compiler-boundary resolution | E |
| Normal Solid-generated JavaScript and assets | F |
| Class lookup, reactive state application, children/default handling | shared runtime |

Neither Chuzz nor UI should reproduce compiler output manually. B and E remain independent compiler hosts over shared parsing infrastructure, and the runtime remains the single reusable implementation of behavior that should not be duplicated per component.
