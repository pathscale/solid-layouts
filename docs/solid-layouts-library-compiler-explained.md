# Solid Layouts library compiler

For the full repository layout, commands, authored files, application configuration, and failure examples, start with [Getting started](./getting-started.md).

## The pipeline implemented here

This work implements the first half of the two-stage Layouts pipeline:

```text
A = user-authored Layout UI source
B = solid-layouts library compiler
C = npm-ready Layout UI bundle

A + B -> C
```

The application build is a separate stage:

```text
C = published Layout UI bundle
D = user-authored Solid application
E = solid-layouts application compiler
F = executable JavaScript and assets

C + D + E -> F
```

This document focuses on B and the concrete C it produces. The initial E implementation and its Chuzz integration are documented separately.

## A: the authored Test-UI

`Test-UI/src` contains four components copied from the larger UI migration: Icon, Button, Flex, and Chip. The full authored source is [`pathscale/ui` PR #221](https://github.com/pathscale/ui/pull/221); it is A and must be compiled before an application can consume it. `Test-UI` keeps the proof small enough that all of C can be reviewed directly while exercising multiple public exports, slots, variants, HTML passthrough, and event handlers.

The important source is `Test-UI/src/components/icon/Icon.layout.tsx`. It intentionally has this shape:

```tsx
const Icon: Layout<typeof icon, IconProps> = () => {
  const width = local.width ?? 24;
  return <span {...slot.root} />;
};
```

That is Layout template syntax. `local` and `slot` are not defined by ordinary TypeScript or SolidJS, and the zero-parameter function cannot receive them. The authored file is therefore not the package entry and is not copied into C.

The recipe is ordinary static TypeScript. There is no authored package entry in A; B generates the compiler-owned call site that C carries forward:

```ts
import { defineComponent } from "solid-layouts/application-boundary";

export const Icon = defineComponent({ recipe: icon, layout: IconLayout });
```

## B: the independent library compiler

The implementation lives in `packages/solid-layouts-oxc`, not in UI.

The OXC transform now performs the missing Layout-template rewrite:

- It recognizes `Layout<typeof recipe, Model>` declarations.
- It accepts authored zero-parameter Layout functions.
- It creates the valid `({ slot, children }, p)` signature.
- It uses OXC semantic bindings to rewrite only unbound model references.
- `local`, `props`, and `rawProps` become `p`.
- Other unbound model values become `p.value`.
- Imported names, locally bound variables, JavaScript globals, `slot`, and `children` are not incorrectly rewritten.
- It rejects Layout functions with an unsupported parameter shape.

The existing static recipe compiler is also part of B. It inserts the `_layouts` lookup data used by the shared runtime, so recipe selection does not have to rediscover the table for every component instance.

`packages/solid-layouts-oxc/library.js` is the package-level compiler. It:

1. Reads `layouts.library.json`.
2. Walks the authored source directory.
3. Compiles `.layout.tsx` to `.generated.tsx`.
4. Compiles static `.recipe.ts` files.
5. Copies ordinary source and CSS.
6. Rejects missing configured recipes.
7. Rejects rendered slots not declared by the recipe.
8. Verifies generated files parse as TSX.
9. Generates package entries with the application-compiler boundary.
10. Emits `layouts.manifest.json`.
11. Emits the npm package metadata for C.

The same operation is available in three forms:

- `compileLibrary()` from `solid-layouts-oxc/library`
- `pluginSolidLayoutsLibrary()` for an Rsbuild/Rslib host
- the `solid-layouts-library` CLI

The compiler is configuration-driven because the public component export, recipe binding, and Layout binding are package API decisions. `Test-UI/layouts.library.json` makes those joins explicit and gives the compiler exact paths to validate.

## C: the generated Layout UI bundle

The inspectable output is `Test-UI/bundle`.

It contains:

```text
bundle/
  package.json
  index.ts
  types.ts
  layouts.manifest.json
  components/icon/
    Icon.css
    Icon.generated.tsx
    Icon.recipe.ts
  components/button/
    Button.css
    Button.generated.tsx
    Button.recipe.ts
```

`Icon.generated.tsx` is valid TSX:

```tsx
const Icon: Layout<typeof icon, IconProps> = ({ slot, children }, p) => {
  const width = p.width ?? 24;
  return <span {...slot.root} />;
};
```

The compiled recipe contains `_layouts`, and B generates `index.ts` with the `defineComponent` Layout call site. The call site imports through `solid-layouts/application-boundary`, which E must resolve. This is deliberate: C is not flattened executable JavaScript, and it cannot silently bypass E. It is the valid, inspectable Layout UI input carried into the second compiler stage.

`layouts.manifest.json` tells E which public component maps to which entry, recipe, and compiled Layout:

```json
{
  "format": "solid-layouts-library-v1",
  "package": "@pathscale/test-ui",
  "components": {
    "Icon": {
      "entry": "./index.ts",
      "recipe": "./components/icon/Icon.recipe.ts",
      "recipeExport": "icon",
      "layout": "./components/icon/Icon.generated.tsx",
      "layoutExport": "IconLayout"
    }
  }
}
```

The generated `package.json` exposes the component entry and the Layout manifest and records the manifest under `solidLayouts`. That gives the second compiler a deterministic package-level discovery point after an application imports `@pathscale/test-ui`.

## Is C publishable to npm?

Yes. The local npm tarball is:

```text
Test-UI/artifacts/pathscale-test-ui-0.0.0.tgz
```

It contains C only. The invalid authored `Icon.layout.tsx`, compiler configuration, tests, and compiler implementation are not in the tarball.

No package was published. The tarball exists only for local inspection and installation.

## Reproducing the bundle

From `Test-UI`:

```sh
bun run build:layouts
```

That regenerates `bundle` and packs it into `artifacts`.

## Verification performed

- 54 Rust/OXC tests pass, including the conformance corpus, explicit mode behavior, exact application import matching, and application import rewriting.
- 3 library compiler tests pass: successful Icon and Button output, generated boundary/entry validation, missing-recipe failure, and undeclared-slot failure.
- 9 application compiler tests pass, including multiple C exports, absent exports, missing runtime metadata, mismatched generated call sites, and corrupt, unsupported, or incomplete package metadata.
- 143 `solid-layouts` runtime tests pass.
- The runtime TypeScript typecheck passes.
- The generated Test-UI package was packed successfully and its tarball contents were inspected.
- Chuzz imports Icon and Button from C and sends both through E; Button replaces the real title-bar and inspector controls rather than only changing an import.
- Chuzz fails when an absent C export is imported and when E is removed.

## Application-stage boundary

The second compiler E reads `solidLayouts` from C's package metadata, loads `layouts.manifest.json`, follows D's imports, and matches application component references against the exact component records in C. An import with no manifest entry is a hard error. That work belongs to the application compiler and is not put back into UI or mixed into this first-pass package build.

The explicit public entry points, mode boundary, manifest resolution contract, hard failures, and first Chuzz integration are specified in [Compiler modes and the Chuzz application integration](./compiler-modes-and-chuzz-application-plan.md).
