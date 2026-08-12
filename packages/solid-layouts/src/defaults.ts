/**
 * The defaults cascade, minus the subtree layer.
 *
 * Four places a presentation value can come from, later winning:
 *
 *     *.defaults.ts  →  configureUI()  →  <UIDefaults>  →  call site
 *        library         app, global      app, subtree      per use
 *
 * The first two live here because neither needs reactivity: a library default
 * is passed to `defineComponent` and an app default is set once at startup.
 * `<UIDefaults>` needs a context and lives with the component code.
 *
 * The `configureUI` layer is the one a build pass can fold away entirely. It
 * is statically known, so `<Button>` can be compiled as though the author had
 * typed `size="lg"`, with no lookup at runtime.
 */

export type ComponentDefaults = Record<string, unknown>;

/** Keyed by the component's exported name, e.g. `Button`, `AccordionItem`. */
export type UIConfig = Record<string, ComponentDefaults>;

let globalDefaults: UIConfig = {};

/**
 * Sets application-wide defaults. Call once, at startup.
 *
 * Merged per component rather than replaced, so two calls configuring
 * different components do not clobber each other. Within a component the
 * later call wins per key.
 */
export function configureUI(config: UIConfig): void {
  const next: UIConfig = { ...globalDefaults };
  for (const [component, defaults] of Object.entries(config)) {
    next[component] = { ...(next[component] ?? {}), ...defaults };
  }
  globalDefaults = next;
}

/** The configured defaults for one component, or nothing. */
export function globalDefaultsFor(component: string): ComponentDefaults | undefined {
  return globalDefaults[component];
}

/**
 * Drops all application-wide defaults.
 *
 * Exists for tests. Module state that cannot be reset makes test order
 * significant, which is a bug waiting to be blamed on something else.
 */
export function resetUIConfig(): void {
  globalDefaults = {};
}

/**
 * Resolves one presentation value across the cascade layers available without
 * reactivity, lowest precedence first.
 *
 * `undefined` means "not set" at every layer, which is why a caller cannot
 * pass `undefined` to mean "use no value". That is the same rule Solid's own
 * props merging follows, and the alternative would make it impossible to
 * spread a partial props object without accidentally clearing defaults.
 */
export function resolveDefault(
  key: string,
  layers: (ComponentDefaults | undefined)[],
): unknown {
  let value: unknown;
  for (const layer of layers) {
    if (layer === undefined) continue;
    const candidate = layer[key];
    if (candidate !== undefined) value = candidate;
  }
  return value;
}
