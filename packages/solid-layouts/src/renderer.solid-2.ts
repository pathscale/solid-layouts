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

/** What this module needs of a 2.0 owner. See `ownChildren`. */
type Owner2 = { _context: unknown };

const { createOwner, getOwner, runWithOwner } = solid as unknown as {
  createOwner(): Owner2;
  getOwner(): Owner2 | null;
  runWithOwner<T>(owner: Owner2 | null, fn: () => T): T;
};

/**
 * Resolve a component's children under an owner that inherits the caller's
 * context but not its lifetime. See the 1.9 twin for why both halves matter.
 *
 * 2.0 does not spell it the same way. `createRoot`'s second argument is an
 * options bag here rather than 1.9's detached owner, and the new root is
 * parented to whatever is running, so that route would hand the children right
 * back to the effect they must outlive. What 2.0 does have is a flatter model
 * of context: an owner holds a plain snapshot object in `_context`, copied
 * from its parent when it is created, and `getContext` reads that object
 * directly rather than walking the chain.
 *
 * So the two halves are assembled rather than inherited together. The scope is
 * created under the component, which makes the component's disposal the one
 * that reaches it, and then its context snapshot is replaced with the read
 * site's — the same field, assigned the same way, that `setContext` writes one
 * key at a time.
 */
export const ownChildren = <T>(owner: unknown, build: () => T): T => {
  const readSite = getOwner();
  const scope = runWithOwner(owner as Owner2 | null, () => createOwner());
  if (readSite) scope._context = readSite._context;
  return runWithOwner(scope, build);
};
