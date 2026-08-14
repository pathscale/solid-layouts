/**
 * The renderer, for Solid 1.9. Its Solid 2.0 twin is `renderer.solid-2.ts`.
 *
 * This file exists because it is the *only* thing in the runtime that a major
 * of Solid can move rather than rename. Everything else either kept its name
 * and module (`createContext`, `useContext`, `createMemo`, `children`, the
 * `Context` type) or can be told apart at runtime from the module object
 * itself, which is what `component.ts` does for `splitProps` / `omit` and for
 * `Context.Provider`. Rendering cannot: 1.9 puts `Dynamic` and
 * `createComponent` under `solid-js/web`, 2.0 moved them to `@solidjs/web` and
 * dropped the `solid-js/web` subpath entirely, so no single import statement
 * resolves under both.
 *
 * The build therefore emits the same sources twice, swapping this file for its
 * twin: `solid-layouts` is the 1.9 package entry, `solid-layouts/solid-2` the
 * 2.0 one. This module is the only difference between the two outputs -
 * `dist/component.js` and `dist/solid-2/component.js` are identical files.
 */
export type { JSX } from "solid-js";
export { Dynamic, createComponent } from "solid-js/web";
