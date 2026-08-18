# Solid 2 support for the layouts toolchain

Scoped 2026-08-15 on `next/solid-2`, branched from `master` at `a107bf1`, which
is exactly the published state: solid-layouts 0.1.3, solid-layouts-oxc 0.1.7,
rsbuild-plugin-solid-layouts 0.1.4. Tagged `solid-1-baseline`.

**Status: built, tested, unpublished.** The toolchain now serves both majors.
Steps 1 to 5 below are done; step 6, publishing, is not.

## It is one file, and inside that file one import

I had this down as "three packages need Solid 2 support", which was true but
useless. Measured, the whole dependence was:

| where | Solid sites | note |
| --- | ---: | --- |
| `packages/solid-layouts/src/component.ts` | **32** | 437 lines. This was the job. |
| `packages/solid-layouts/src/component.test.ts` | 34 | follows the source |
| `packages/solid-layouts/src/ids.test.ts` | 3 | `createRoot` only |
| `packages/solid-layouts-oxc` (3,850 lines of Rust) | **2 real** | an emitted import header and a builtins list |
| `packages/rsbuild-plugin-solid-layouts` | **0** | a thin wrapper, no Solid usage |

Then it got smaller again. Of the four things `component.ts` used that 2.0
changed, three can be told apart at runtime from the module object itself, so
they needed no fork at all:

| what | how it is handled |
| --- | --- |
| `splitProps` became `omit` | resolved once at load: `"omit" in solid` |
| `Context.Provider` became the context | `context.Provider ?? context` |
| `useContext` throws instead of returning `undefined` | the internal defaults context now carries `{}`, which both majors read the same way |
| **`Dynamic` and `createComponent` moved module** | **the only real fork** |

The fourth cannot be detected, because it is a module specifier and those are
resolved before any code runs. 1.9 serves them from `solid-js/web`; 2.0 moved
them to `@solidjs/web` **and dropped the `solid-js/web` subpath entirely**, so
no single import statement resolves under both. That is now `src/renderer.ts`,
twenty lines, with a twin in `src/renderer.solid-2.ts`. `scripts/build.mjs`
emits the tree twice with the twin swapped in. `dist/component.js` and
`dist/solid-2/component.js` are identical files.

## Three things the migration guide did not tell me

Read out of `solid-js@2.0.0-rc.0` and `@solidjs/signals@2.0.0-rc.0` rather than
out of the guide, and all three changed the plan:

1. **`Dynamic` survived unchanged.** It is still a component taking a
   `component` prop, exported from `@solidjs/web`. The plan predicted a rewrite
   to a `dynamic(source)` factory. `dynamic()` exists, but `Dynamic` does too,
   and `createComponent` is re-exported by `@solidjs/web` from `solid-js`, so
   the two names the renderer needs are the same two names in both majors.
2. **`JSX` is gone from `solid-js`.** Core no longer declares the namespace at
   all, because the shape of an element is the renderer's business. It comes
   from `@solidjs/web` now. The plan missed this entirely, and it is the reason
   the renderer module has to carry the type as well as the two values.
3. **`useContext` throws in the implementation, not just the docs.**
   `getContext` throws `ContextNotFoundError` when the resolved value is
   `undefined` and `NoOwnerError` when there is no owner. A provider supplying
   `undefined` counts as having provided, so an empty provider **shadows a real
   one above it with a throw**. `defineComponent` now skips the wrapper when the
   setup returned no context, which is a correctness fix under 2.0 and a no-op
   under 1.9.

## `splitProps` was the part that changed shape

Four buckets came out of one call, and the call made them disjoint by
construction: a key named in two lists landed in the earlier one only.

```js
const [presentation, escape, behaviour, passthrough] =
  splitProps(props, presentationKeys, ["class", "className", "style", "children"], behaviourKeys);
```

`omit` returns only the remainder, and neither major ships the subset half. So
the three routed buckets are picked by name, the fourth still falls out of one
call, and which bucket each declared key belongs to is decided **once per
component** rather than once per render.

## The compiler: an option, not a fork

`solid: 1 | 2` on `TransformOptions`. It decides one thing, the specifier a
generated component imports its boundary from:

```
solid-layouts/application-boundary          ->  solid-layouts/solid-2/application-boundary
```

Told rather than sniffed: the compiler sees one source file, and which Solid an
application runs on is not written in it. Default is 1 and the emission is
byte-identical to before, asserted by a test rather than by inspection.

The builtins list gained 2.0's renames (`Suspense` to `Loading`, `SuspenseList`
to `Reveal`, `ErrorBoundary` to `Errored`, plus `Repeat`) and the source check
admits `@solidjs/web`. Neither is gated behind the option: the check tests a
name against a module, and no 1.9 build can import `Loading` from a Solid module
that does not export one.

## Why the specifier and not an export condition

Both work. A `solid-2` export condition would keep the generated files
byte-identical between majors and cost no compiler change at all. It was built
that way first and then removed, for one reason: a specifier is a line you can
read. `grep` answers which runtime a build is on, and a mismatch reads as a
wrong-looking import rather than as a resolve failure two layers down. The
condition also needed `customConditions` in every consumer's tsconfig to keep
tsc agreeing with the bundler.

The cost of the explicit form is one edit in `@pathscale/ui`, because the
library funnels every hand-written runtime import through `src/lib/layouts/index.ts`.

## The plugins

Two more exported names rather than an option on the existing two:

```js
pluginSolid2LayoutsLibrary(),
pluginBabel({ include: /\.(?:jsx|tsx)$/ }),
pluginSolid2(),
```

The choice is not independent of the rest of the build. It has to agree with
`pluginSolid2()` and with the installed `solid-js`, and a name that must match
its neighbour in the plugin list is easier to get right than a flag that must.
`pluginSolidLayoutsLibrary`/`Application` are untouched.

Asking a runtime that predates this for `./solid-2` now fails by name rather
than quietly falling back to `main` and serving the wrong major.

## Order of work

1. ~~**`component.ts` prop routing.**~~ Done. `pick` plus one `rest`, buckets
   resolved per component.
2. **The context decision.** Half done. The runtime's own context carries a
   default now, which settles `solid-layouts`. The library question is open:
   `@pathscale/ui` calls `useContext` at **57 sites with only 17 guarded**, and
   every compound component that currently works standalone throws under 2.0
   unless each context gets a default. That is an API decision about what 3.0
   *is*, and it does not belong in this repository.
3. ~~**`@solidjs/web` imports.**~~ Done, and smaller than expected: `Dynamic`
   did not change shape.
4. ~~**Rust: builtins list, source check, boundary option.**~~ Done. 60 Rust
   tests, 22 JS tests.
5. ~~**`rsbuild-plugin-solid-layouts`.**~~ Done. Still true that it sits beside
   `@rsbuild/plugin-solid@1.2.2`, which *depends on* `babel-preset-solid:
   ^1.9.12`. That is a hard pin on Solid 1's JSX transform and needs an override
   to `babel-preset-solid@next` or a patched plugin. Untested.
6. **Publish under a prerelease tag** (`0.2.0-rc.0` on `next`) so
   `@pathscale/ui` on `next/solid-2` can consume it without touching `latest`.
   Not done.

## What is verified, and what is not

Verified by running it: 145 runtime tests under 1.9 unchanged; both builds
emitted; 60 Rust tests; 22 compiler JS tests; the boundary specifier checked
end to end through the rebuilt native binding in both bundle and source mode.

**Not verified:** the 2.0 build has never run against an installed `solid-js@2`.
It typechecks with `skipLibCheck`, so its declarations bind to `@solidjs/web`
but nothing has checked `@solidjs/web` against the Solid 2 it expects. The first
real test is a `@pathscale/ui` build on Solid 2, and that is the next thing to
do.

## What is NOT blocked on this

The 11 `@solid-primitives/*` packages `@pathscale/ui` depends on peer-pin
`solid-js: ^1.6.12` and call `createEffect`/`onCleanup` internally, both of
which change signature. They break at runtime, not at install, and no work here
fixes that. Either upstream ships Solid 2 releases, or the four or five we
actually use get vendored.

## Correction, 2026-08-18: runtime detection cannot be bundled

The table above records three differences as "told apart at runtime from the
module object itself, so they needed no fork at all". For `splitProps`/`omit`
that was wrong, and it was wrong in a way no test in this repository could
see.

`"omit" in solid ? solid.omit(...) : solid.splitProps(...)` picks the correct
arm every time it executes. It still cannot be linked: a bundler resolves
*both* arms against the installed `solid-js`, so when a consumer bundles
against Solid 2 the 1.9 arm's `splitProps` is a missing export and the build
fails before any of it runs.

    ESModulesLinkingError: export 'splitProps' (imported as 'solid') was not
    found in 'solid-js'

It reached a consumer as a build that would not start, and every job here was
green at the time, because all of them run this package against the installed
Solid 1.9 and none of them asked a bundler to link the 2.0 entry.

**The rule this yields:** a difference between majors belongs in `renderer.ts`,
which the build already swaps, not in a runtime conditional. Only the arm that
exists is then compiled. Runtime detection is fine for a value that varies
within one major, and never for one that varies between them.

**The guard:** `fixtures/solid-2-consumer` installs `solid-js@2.0.0-rc.0` and
`@solidjs/web@2.0.0-rc.0`, imports the package's `solid-2` entry, and bundles
it with Rspack, which is the linker that produced the original failure. The
`solid-2-consumer` CI job runs it. Reintroducing the conditional fails that job
with the message above, which was checked rather than assumed.

**What it does not cover.** The fixture imports the entry and calls into it; it
writes no JSX, so it exercises the Solid 2 *runtime* and not the Solid 2
*compiler*. Those are separate choices: a consumer must also point its JSX
transform at Solid 2 (`babel-preset-solid@2`, whose `moduleName` defaults to
`@solidjs/web`), and a build that gets the runtime right and the transform
wrong emits `solid-js/web` imports, a subpath 2.0 removed. Covering that means
a second fixture that compiles a component, and it is not covered here.

Two traps found while writing the fixture, both worth knowing before touching
it:

- Aliasing `solid-layouts` to the package root does not work. An alias replaces
  the whole specifier, so the `/solid-2` subpath export is never consulted; the
  alias has to name the built entry.
- Solid must be aliased to the *fixture's* copy. Otherwise the bundler walks up
  to `packages/solid-layouts/node_modules` and links `@solidjs/web` 2.0 against
  Solid 1.9, which fails on a dozen unrelated exports and says nothing about
  the code under test.
