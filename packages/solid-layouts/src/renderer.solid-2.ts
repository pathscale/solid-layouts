/**
 * The renderer, for Solid 2.0. See `renderer.ts` for why this file is the only
 * one that has a twin.
 *
 * `Dynamic` survived the major with the same props, and `createComponent` is
 * re-exported by `@solidjs/web` from `solid-js`, so the two names this module
 * carries are the same two names its 1.9 twin carries. The `JSX` namespace did
 * not survive: `solid-js` no longer declares one, because the shape of an
 * element is the renderer's business, so it comes from `@solidjs/web` here.
 *
 * The build swaps this file in as `renderer.ts` when emitting the
 * `solid-layouts/solid-2` entry. It is never part of the 1.9 output, which is
 * what lets it import a package a 1.9 consumer has no reason to install.
 */
export type { JSX } from "@solidjs/web";
export { Dynamic, createComponent } from "@solidjs/web";
