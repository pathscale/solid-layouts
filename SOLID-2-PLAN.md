# Solid 2 support for the layouts toolchain

Measured 2026-08-15 on `next/solid-2`, branched from `master` at `a107bf1`,
which is exactly the published state: solid-layouts 0.1.3, solid-layouts-oxc
0.1.7, rsbuild-plugin-solid-layouts 0.1.4. Tagged `solid-1-baseline`.

## It is one file

I had this down as "three packages need Solid 2 support", which was true but
useless. Measured, the whole dependence is:

| where | Solid sites | note |
| --- | ---: | --- |
| `packages/solid-layouts/src/component.ts` | **32** | 437 lines. This is the job. |
| `packages/solid-layouts/src/component.test.ts` | 34 | follows the source |
| `packages/solid-layouts/src/ids.test.ts` | 3 | `createRoot` only |
| `packages/solid-layouts/src/defaults.ts` | 1 | |
| `packages/solid-layouts-oxc` (3,850 lines of Rust) | **2 real** | an emitted import header and a builtins list; the other two hits are a test fixture |
| `packages/rsbuild-plugin-solid-layouts` | **0** | `index.js` + `index.d.ts`, a thin wrapper, no Solid usage |

`component.ts` imports exactly this:

```ts
import {
  type Context, type JSX,
  children as resolveChildren, createContext, createMemo, splitProps, useContext,
} from "solid-js";
import { Dynamic, createComponent } from "solid-js/web";
```

Seven named imports and two from `web`. That is the entire surface.

## What each one becomes

| 1.x | 2.0 | difficulty |
| --- | --- | --- |
| `splitProps(props, a, b, c)` | `omit(props, ...)` | **the real work** — see below |
| `useContext` | same name, but **throws** on a default-less context instead of returning `undefined` | design decision |
| `createComponent`, `Dynamic` | move to `@solidjs/web`; `Dynamic` becomes the `dynamic(source)` factory | mechanical |
| `children`, `createMemo`, `createContext` | unchanged names | mechanical |
| `Context.Provider` | context is the provider: `<Ctx value={…}>` | mechanical |

### `splitProps` is the one that matters

The runtime's whole prop-routing model is built on it. From `component.js`:

```js
const [presentation, escape, behaviour, passthrough] =
  splitProps(props, presentationKeys, ["class", "className", "style", "children"], behaviourKeys);
```

Four buckets from one call. `omit(props, ...keys)` returns **only the
remainder**, so this becomes several `omit` calls plus explicit picks, and the
bucket boundaries have to be re-derived rather than falling out of the split.
That is the piece to design first, because everything else in the file reads
those four names.

### The Rust is two lines

```rust
// match_layouts.rs:246
SOLID_BUILTINS.contains(&name) && (source == "solid-js" || source == "solid-js/web")
```

`SOLID_BUILTINS` lists `For, Show, Switch, Match, Suspense, SuspenseList, …`.
Under 2.0, `Suspense` is `Loading`, `SuspenseList` is `Reveal`, `ErrorBoundary`
is `Errored`, and `Index` is gone in favour of `<For keyed={false}>`. So the
list changes and the source check has to admit `@solidjs/web`.

```rust
// lib.rs:257 — the header prepended to every .generated.tsx
"import { defineComponent as __defineLayoutComponent } from \"solid-layouts/application-boundary\";
 import type { Component as __LayoutComponent } from \"solid-js\";"
```

`Component` still comes from `solid-js`; only the builtins source list needs
widening. Both edits are small and both need fixture regeneration.

## Order of work

1. **`component.ts` prop routing.** Replace the four-bucket `splitProps` with
   `omit` plus explicit picks. Everything else is downstream of this.
2. **The context decision.** `useContext` throwing changes what a compound
   component does outside its provider — in `@pathscale/ui` that pattern appears
   at 57 sites with only 17 guarded. Decide here, because the runtime is where
   the fallback lives.
3. **`@solidjs/web` imports and `dynamic()`.**
4. **Rust: builtins list + source check**, then regenerate fixtures.
5. **`rsbuild-plugin-solid-layouts`**: nothing in its own source, but it sits
   beside `@rsbuild/plugin-solid@1.2.2`, which *depends on*
   `babel-preset-solid: ^1.9.12`. That is a hard pin on Solid 1's JSX transform
   and needs an override to `babel-preset-solid@next` or a patched plugin.
6. **Publish under a prerelease tag** (`0.2.0-rc.0` on `next`) so
   `@pathscale/ui` on `next/solid-2` can consume it without touching `latest`.

## What is NOT blocked on this

The 11 `@solid-primitives/*` packages `@pathscale/ui` depends on peer-pin
`solid-js: ^1.6.12` and call `createEffect`/`onCleanup` internally, both of
which change signature. They break at runtime, not at install, and no work here
fixes that. Either upstream ships Solid 2 releases, or the four or five we
actually use get vendored.
