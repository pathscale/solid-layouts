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
  __compiled?: CompiledRecipe;
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
    : keyof V;

export type VariantSelection<T extends Record<string, Variant> | undefined> =
  T extends Record<string, Variant>
    ? { [K in keyof T]?: VariantValue<T[K]> }
    : Record<string, never>;

/** The presentation props a recipe accepts at the call site. */
export type PropsOf<R> = R extends { config: { props?: infer P } }
  ? VariantSelection<P extends Record<string, Variant> ? P : undefined>
  : never;

/** The state keys a recipe expects its setup function to return. */
export type StateOf<R> = R extends { config: { state?: infer S } }
  ? VariantSelection<S extends Record<string, Variant> ? S : undefined>
  : never;

/** The slot names a recipe declares. */
export type SlotsOf<R> = R extends { config: { slots: infer S } }
  ? keyof S
  : never;
