/**
 * A variant's class for one of its values.
 *
 * A bare string applies to the root slot, which is the common case and keeps
 * a single-slot recipe short. An object targets slots by name, which is what
 * a compound part needs: an accordion trigger's `expanded` state has to reach
 * both the button and its indicator.
 */
export type VariantClasses = string | Record<string, string>;

/** One variant axis: the values it can take, and the classes each implies. */
export type Variant = Record<string, VariantClasses>;

export type SlotDefinition = {
  /** Always present on this slot. Conventionally its BEM element. */
  base?: string;
};

export type RecipeConfig = {
  /** Names the component. Becomes the `data-slot` value on the root slot. */
  component: string;
  /**
   * The element a shared layout renders when the component has no layout file
   * of its own. Only meaningful for a single-slot recipe.
   */
  element?: string;
  /**
   * Every element this component renders. `root` is required: it is the slot a
   * consumer's `class` override merges into and the one that carries the
   * component's `data-slot`.
   */
  slots: { root: SlotDefinition } & Record<string, SlotDefinition>;
  /** Set at the call site. Presentation. */
  props?: Record<string, Variant>;
  /** Computed by the logic. Never set by the caller. Mirrored to `data-*`. */
  state?: Record<string, Variant>;
  /**
   * The value each axis takes when nothing else sets it — the lowest layer of
   * the cascade.
   *
   * Here rather than in a file of its own: a default is a fact about the design
   * vocabulary, so it belongs with the axis it defaults, and splitting it out
   * meant two files to open to answer one question.
   */
  defaults?: Record<string, unknown>;
  /**
   * Set only when this recipe's own classes are Tailwind utilities, which
   * selects `twMerge` for the consumer's trailing `class` instead of `cx`.
   * With Tailwind the tail can contradict the recipe and only `twMerge`
   * resolves it; with BEM nothing can collide, so the join is both correct and
   * far cheaper.
   */
  tailwind?: boolean;
  /**
   * Written by the compiler, never by hand.
   *
   * `_layouts` names the owner rather than merely marking the field private,
   * which matters because the compiler injects it into source it does not own.
   * A generic `__compiled` would collide with the next tool that has the same
   * idea. Everything under this key is written by the compiler, read by the
   * runtime, and carries no stability guarantee between versions.
   *
   * The same information as `slots`, `props` and `state`, arranged so it can
   * be indexed instead of walked: slot, then variant axis, then value, to the
   * class that combination contributes. Deciding at compile time which slot a
   * bare-string variant reaches, and which axes touch a given slot, means the
   * runtime does neither on any render.
   *
   * Absent when the recipe could not be compiled, which happens whenever any
   * part of the declaration is not a literal. The runtime then walks the
   * configuration as before, so a computed recipe still works.
   */
  _layouts?: CompiledRecipe;
};

export type CompiledSlot = {
  base: string;
  /** axis name to value to class, for this slot only. */
  axes: Record<string, Record<string, string>>;
};

export type CompiledRecipe = {
  slots: Record<string, CompiledSlot>;
  /** The axes that mirror to `data-*`. Declaration order. */
  stateKeys: string[];
  /**
   * The stable index the compiler assigned to each slot.
   *
   * Assigned ahead of time across every recipe the compiler saw, so nothing
   * registers itself to become addressable. An instance id is then
   * `${slotIds[name]}-${counter}`, which makes the runtime's contribution a
   * counter increment rather than string building on every mount.
   */
  slotIds: Record<string, number>;
};

/** The attributes a resolved slot contributes to its element. */
export type SlotAttrs = {
  class: string;
  [dataAttribute: string]: string | undefined;
};

/**
 * Turns a variant record into the union of its value names, with `true`/`false`
 * collapsing to `boolean` so `{ true: "..." }` reads as a boolean prop.
 */
type VariantValue<V extends Variant> = "true" extends keyof V
  ? boolean
  : "false" extends keyof V
    ? boolean
    : [keyof V] extends [never]
      ? // An axis with no declared values carries data rather than classes: a
        // status readout the layout prints but nothing styles. Resolving to
        // `keyof {}` would give `never`, and intersecting `never` into the
        // layout's props makes every field on it inaccessible.
        unknown
      : keyof V;

export type VariantSelection<T extends Record<string, Variant> | undefined> =
  T extends Record<string, Variant>
    ? { [K in keyof T]?: VariantValue<T[K]> }
    : // An absent axis group contributes nothing. `Record<string, never>`
      // would be the tempting spelling and is actively wrong: intersected
      // with the other group it types every property as `never`, so a recipe
      // that declares state but no props ends up with no readable fields at
      // all. An empty object adds no constraint, which is the intent.
      // eslint-disable-next-line @typescript-eslint/ban-types
      {};

type ConfigOf<R> = R extends { config: infer C } ? C : never;

/**
 * The axis group under `key`, or nothing when the recipe does not declare it.
 *
 * The check is against a *required* property deliberately. Inferring through
 * an optional one (`{ props?: infer P }`) matches a config that omits `props`
 * entirely and infers `unknown`, which then fails the `Record<string, Variant>`
 * test and lands in whatever the false branch is. Every spelling of that
 * branch was wrong: `never` poisoned the intersection so no field on the
 * layout's props was readable, and `Record<string, never>` typed every field
 * as `never` for the same effect.
 */
type AxisGroup<R, Key extends string> = ConfigOf<R> extends Record<Key, infer G>
  ? G extends Record<string, Variant>
    ? VariantSelection<G>
    : // biome-ignore lint/complexity/noBannedTypes: an absent group must add
      // no constraint, which is what the empty object means here.
      {}
  : // biome-ignore lint/complexity/noBannedTypes: same.
    {};

/** The presentation props a recipe accepts at the call site. */
export type PropsOf<R> = AxisGroup<R, "props">;

/** The state keys a recipe expects its setup function to return. */
export type StateOf<R> = AxisGroup<R, "state">;

/** The slot names a recipe declares. */
export type SlotsOf<R> = R extends { config: { slots: infer S } }
  ? keyof S
  : never;
