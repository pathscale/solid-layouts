# Layouts

A component-authoring pattern for SolidJS: logic in a `.ts` file, markup in a `.layout.tsx` file,
presentation declared at the call site and resolved by a recipe.

The design is specified in [`UI/docs/layouts.md`](https://github.com/pathscale/UI/blob/layouts/docs/layouts.md)
on the `layouts` branch. This repository holds the runtime and the tooling.

## Layout

```
packages/
  solid-layouts/          the runtime. recipe(), the Layout type, defineComponent, compound
  solid-layouts-oxc/      the pre-pass, built on oxc
    crates/common/        options and diagnostics. no parser dependency
    crates/transform/     the pass itself
fixtures/                 conformance corpus: input .tsx to expected output
```

## Working on the pass

```sh
cd packages/solid-layouts-oxc
cargo test --workspace
```

No JS runtime is involved. The Node binding is behind the `napi` feature, off by default, so the
transform is developed and tested as pure Rust:

```sh
cargo check --features napi     # only when building the binding itself
```

## Two rules worth knowing before changing anything

**Deleting the pass must leave working code.** The runtime ships and works with no tooling at all;
the pass only makes it smaller and faster. If removing it changes behaviour rather than size, the
design is wrong and the change does not land.

**oxc versions are pinned exactly and bumped deliberately.** `oxc_traverse`'s own documentation
describes it as codegen-generated and internally steered. The AST changes shape between releases:
0.144 moved `type_annotation` from `BindingPattern` to `VariableDeclarator`, turned
`BindingPattern` into an enum, and split `export const x = 1` out of `ExportNamedDeclaration` into
a separate `Statement::ExportDeclaration`. Treat a bump as a change to review, not a routine
update.

## Node

Node is not used in this repository, and Bun is the runtime everywhere. The one exception is the
frozen Babel on-ramp, which is a Node program by construction, is written once, and is never
maintained afterwards.
