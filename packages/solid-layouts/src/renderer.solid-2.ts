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

import * as solid from "solid-js";

/**
 * `props` without `keys`. See the 1.9 twin for why this lives here.
 *
 * Reached through the module object because this package is developed against
 * an installed 1.9, whose types do not declare `omit`. Unlike the conditional
 * this replaced, there is no second arm for a bundler to resolve: only the
 * name that exists at runtime in 2.0 is ever read.
 */
const { omit } = solid as unknown as {
  omit(
    props: Record<string, unknown>,
    ...keys: string[]
  ): Record<string, unknown>;
};

export const rest = (
  props: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> => omit(props, ...(keys as string[]));
