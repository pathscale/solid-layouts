# Getting started: UI source to a running Solid application

This guide shows the complete two-pass flow. It deliberately keeps the UI-library build and application build separate because they consume different inputs and produce different artifacts.

## What each repository is

```text
pathscale/ui or your UI repo
  A: authored recipes, CSS, types and .layout.tsx templates
                              |
                              | B: solid-layouts library compiler
                              v
@pathscale/ui package
  C: generated TSX, compiled recipes, generated entries and manifest
                              |
application source D --------+ E: solid-layouts application compiler
                              v
normal Solid/Rsbuild output F
```

`solid-layouts` supplies B, E, and the shared runtime. It does not supply your component designs. `UI/` is your component-library repository.

For Pathscale:

- The full authored migration is [`pathscale/ui` PR #221](https://github.com/pathscale/ui/pull/221), branch `feat/icon-layout-port`.
- The working compiler fixture is [`Test-UI/`](../Test-UI) in this repository. It contains Icon and Button so every generated file remains easy to inspect while the application proof exercises real component markup changes.
- The current real application consumer is [Chuzz PR #7](https://github.com/pathscale/chuzz/pull/7).

The full PR #221 tree is not yet the input to the working B pipeline. Do not point an application at that raw source and do not copy its generated-looking files into an application. First make it a producer, run B, and consume only C.

## Current availability

`solid-layouts` and `solid-layouts-oxc` are not published on npm yet. There are therefore two configurations in this guide:

1. The current checkout configuration, which uses explicit local paths and is runnable now.
2. The final package configuration, which is the intended public API after the packages and C are published.

The compiler behavior is the same. The path overrides only replace npm package resolution during hands-on development.

## Directory layout for the current proof

Keep the repositories as siblings because Chuzz PR #7 intentionally uses relative checkout paths:

```text
workspace/
  solid-layouts/
  chuzz/
  UI/                 optional; only needed to inspect the full migration
```

Clone the compiler/runtime and, optionally, the full authored UI:

```sh
mkdir workspace
cd workspace
git clone https://github.com/pathscale/solid-layouts.git
git clone --branch feat/icon-layout-port https://github.com/pathscale/ui.git UI
```

`UI/` is role A for the eventual full library. The runnable example below uses `solid-layouts/Test-UI` as a controlled two-component A.

## Producer: author components as A

The producer owns the recipe, Layout template, CSS, and public component name. It does not hand-write the package entry.

### 1. Declare the recipe

`Test-UI/src/components/icon/Icon.recipe.ts`:

```ts
import { recipe } from "solid-layouts";

export const icon = recipe({
  component: "icon",
  element: "span",
  slots: { root: { base: "icon" } },
  props: { name: {}, width: {}, height: {} },
});
```

The recipe declares what can affect presentation and which slots the Layout may render. B compiles its static lookup table once; the runtime does not reconstruct the table for every Icon instance.

### 2. Author the Layout template

`Test-UI/src/components/icon/Icon.layout.tsx` contains template syntax:

```tsx
import "./Icon.css";
import { createMemo } from "solid-js";
import { twMerge } from "tailwind-merge";
import type { Layout } from "solid-layouts";
import type { IComponentBaseProps, ComponentColor } from "../../types";
import { icon } from "./Icon.recipe";

export type IconProps = IComponentBaseProps & {
  width?: number;
  height?: number;
  color?: ComponentColor;
  name?: string;
};

const Icon: Layout<typeof icon, IconProps> = () => {
  const width = local.width ?? 24;
  const height = local.height ?? 24;

  const classes = createMemo(() =>
    twMerge(slot.root.class, local.name, local.class, local.className),
  );

  return (
    <span
      {...slot.root}
      {...{ class: classes() }}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        ...(typeof local.style === "object" ? local.style : {}),
      }}
      data-theme={local.dataTheme}
    />
  );
};

export const IconLayout = Icon;
```

This file is intentionally not valid ordinary TSX. `local` and `slot` have no runtime declarations and the zero-parameter function cannot receive them. B is load-bearing: it rewrites this template before anything is packaged.

### 3. Describe the public package join

`Test-UI/layouts.library.json`:

```json
{
  "source": "src",
  "output": "bundle",
  "components": [
    {
      "name": "Icon",
      "entry": "index.ts",
      "recipe": "components/icon/Icon.recipe.ts",
      "recipeExport": "icon",
      "layout": "components/icon/Icon.layout.tsx",
      "layoutExport": "IconLayout"
    },
    {
      "name": "Button",
      "entry": "index.ts",
      "recipe": "components/button/Button.recipe.ts",
      "recipeExport": "button",
      "layout": "components/button/Button.layout.tsx",
      "layoutExport": "ButtonLayout"
    }
  ]
}
```

This file is explicit because B cannot safely guess which internal recipe/Layout pair defines which public export. A typo or mismatch is a build error.

### 4. Build B and produce C

On a clean checkout, build the native binding using the system Rust toolchain, then run the library compiler:

```sh
cd workspace/solid-layouts/packages/solid-layouts-oxc
./scripts/build-binding.sh

cd ../../Test-UI
bun run build:layouts
```

The script executes `solid-layouts-library --pack`. B reads A and creates:

```text
Test-UI/bundle/
  package.json
  index.ts
  layouts.manifest.json
  types.ts
  components/icon/
    Icon.css
    Icon.generated.tsx
    Icon.recipe.ts
  components/button/
    Button.css
    Button.generated.tsx
    Button.recipe.ts

Test-UI/artifacts/
  pathscale-test-ui-0.0.0.tgz
```

The authored `.layout.tsx` is not shipped. Its generated counterpart has a real function signature and model references:

```tsx
const Icon: Layout<typeof icon, IconProps> = ({ slot, children }, p) => {
  const width = p.width ?? 24;
  const height = p.height ?? 24;
  // ...
};
```

B also owns `bundle/index.ts`:

```ts
import { defineComponent as __defineLayoutComponent } from "solid-layouts/application-boundary";
import { IconLayout } from "./components/icon/Icon.generated";
import { icon } from "./components/icon/Icon.recipe";

export const Icon = __defineLayoutComponent({
  recipe: icon,
  layout: IconLayout,
});
```

The boundary import is deliberate. Normal module resolution cannot satisfy it. E must validate C and resolve the boundary during the application build; removing E does not silently fall back to normal TSX.

The generated `package.json` includes:

```json
{
  "name": "@pathscale/test-ui",
  "exports": {
    ".": {
      "types": "./index.ts",
      "import": "./index.ts"
    },
    "./layouts": "./layouts.manifest.json",
    "./package.json": "./package.json"
  },
  "solidLayouts": "./layouts.manifest.json"
}
```

`solidLayouts` is E's package-level discovery point. C is the artifact to publish to npm; A is not.

## Consumer: use C from application D

Application code remains ordinary Solid TSX:

```tsx
import { Icon } from "@pathscale/ui";

export function SaveAction() {
  return <Icon name="icon-[mdi--content-save]" width={18} />;
}
```

The application does not import a recipe, generated Layout, manifest, or compiler boundary. It imports the public component from C.

### Final package configuration

After `solid-layouts`, `solid-layouts-oxc`, and the compiled `@pathscale/ui` C package are published, an Rsbuild application uses package resolution:

```ts
import { defineConfig } from "@rsbuild/core";
import { pluginBabel } from "@rsbuild/plugin-babel";
import { pluginSolid } from "@rsbuild/plugin-solid";
import { pluginSolidLayoutsApplication } from "solid-layouts-oxc/application";

export default defineConfig({
  plugins: [
    pluginSolidLayoutsApplication({
      layouts: ["@pathscale/ui"],
    }),
    pluginBabel({ include: /\.(?:jsx|tsx|ts)$/ }),
    pluginSolid(),
  ],
});
```

Order is load-bearing. E must parse application TSX before Babel/Solid lowers JSX to runtime calls.

At setup E:

1. Resolves `@pathscale/ui/package.json` from the application.
2. Requires `solidLayouts`.
3. Reads and validates the manifest and every referenced entry, recipe, and generated Layout.
4. Creates the exact public export index once for the build.
5. Checks application imports against that index.
6. Rewrites validated Layout-package imports to C's resolved public entry.
7. Resolves `solid-layouts/application-boundary` to the shared runtime.

### Current local-checkout configuration

Before publication, provide the package identity plus C's directory and the runtime path explicitly:

```ts
import { pluginSolidLayoutsApplication } from "../../../../solid-layouts/packages/solid-layouts-oxc/application.js";

pluginSolidLayoutsApplication({
  layouts: [
    {
      module: "@pathscale/test-ui",
      root: "../../../../solid-layouts/Test-UI/bundle",
    },
  ],
  runtime: "../../../../solid-layouts/packages/solid-layouts/src/index.ts",
})
```

TypeScript needs a path for the local C types, and the bundler needs the local runtime path. The bundler does not need a C alias: E rewrites `@pathscale/test-ui` to the validated absolute C entry. Chuzz PR #7 is the exact working example. The object-shaped Layout source and `runtime` option are checkout overrides, not a second compiler mode.

## Run the current Chuzz proof

With `solid-layouts` and `chuzz` as sibling directories:

```sh
cd workspace
git clone https://github.com/pathscale/solid-layouts.git
git clone https://github.com/pathscale/chuzz.git

git -C chuzz fetch origin pull/7/head:solid-layouts-icon
git -C chuzz switch solid-layouts-icon

cd solid-layouts/packages/solid-layouts-oxc
./scripts/build-binding.sh
cd ../../Test-UI
bun run build:layouts

cd ../../chuzz/apps/chuzz/frontend
bun install --frozen-lockfile
bun run build
```

Chuzz imports Icon and Button from `@pathscale/test-ui`; its other components continue to come from the existing `@pathscale/ui`. The Button migration replaces the raw controls in `TitleBar.tsx` and `SidePanel.tsx`, preserving their event handlers and application-specific CSS while making the component body changes visible in review.

## Expected failures

There is no graceful fallback. These failures mean the contract is working:

| Failure | Where it stops | Why |
| --- | --- | --- |
| `.layout.tsx` does not name/import its configured recipe | B | A cannot be joined deterministically |
| Layout renders an undeclared slot | B | Recipe and markup disagree |
| Recipe declares a slot the Layout never renders | B | C would carry dead or mistyped identity |
| Configured package cannot be resolved | E setup | C is absent |
| Package has no `solidLayouts` field | E setup | The package is not a valid C |
| Manifest is malformed, unsupported, or names another package | E setup | C cannot be trusted |
| Manifest points at a missing entry/recipe/Layout/export | E setup | C is internally inconsistent |
| Application imports a public export absent from the manifest | E source pass | D asked for a component C cannot prove |
| E is removed | Normal module resolution | C's compiler boundary intentionally remains unresolved |

## Tests and exact commands

### Runtime

```sh
cd packages/solid-layouts
bun run test
bun run typecheck
```

This runs 143 tests under Solid's browser condition. The condition matters: Bun otherwise resolves Solid's server build, where reactivity tests can pass without exercising updates.

### Native compiler and conformance corpus

```sh
cd packages/solid-layouts-oxc
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

The 54 Rust tests include parser/diagnostic tests, recipe compilation, exact import matching and rewriting, template rewriting, and the input/output fixture corpus under `fixtures/`.

### JavaScript library/application hosts

```sh
cd packages/solid-layouts-oxc
./scripts/build-binding.sh
bun run test:library
bun run test:application
```

The library-host tests compile a temporary producer and assert generated TSX, entry boundaries, missing-recipe failures, and slot mismatches. The application-host tests resolve a real C fixture and cover absent exports, missing discovery metadata, corrupt/unsupported manifests, missing generated files, and entry/manifest disagreement.

### Generated C freshness

```sh
cd Test-UI
bun ../packages/solid-layouts-oxc/bin/solid-layouts-library.js
cd ..
git diff --exit-code -- Test-UI/bundle
```

CI performs all four groups and fails if the committed C fixture no longer matches B.

## Moving from Test-UI to the complete Pathscale UI

The safe migration order is:

1. Check out PR #221 as A.
2. Add one `layouts.library.json` component record at a time.
3. Run B and inspect that component's generated C diff.
4. Add library-host failures for any new syntax shape before accepting it.
5. Keep generated entries and manifests owned by B; do not restore hand-written wiring.
6. Pack C and inspect its contents before publishing.
7. Configure E against that C package in Chuzz.
8. Move one Chuzz import at a time and require a successful application build.
9. Confirm that removing E and importing a nonexistent manifest export both fail.
10. Measure bundle and per-instance cost only after correctness is established.

The key boundary is always the same: application D consumes C. It never consumes raw A.
