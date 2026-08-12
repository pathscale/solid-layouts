import { cx } from "./cx";
import type { RecipeConfig, SlotAttrs, VariantClasses } from "./types";

/**
 * Every declared slot, resolved.
 *
 * `root` is spelled out rather than left to the index signature because the
 * config requires it, so every caller reaching for it would otherwise have to
 * handle an `undefined` that cannot happen.
 */
export type ResolvedSlots = { root: SlotAttrs } & Record<string, SlotAttrs>;

/**
 * The whole of a component's design vocabulary, in one declaration.
 *
 * `props` and `state` are separate because they come from different places:
 * props are set at the call site and are presentation; state is computed by
 * the logic and is never set by a caller. That split is what lets
 * `defineComponent` route an incoming prop to the right layer without being
 * told, and it makes a name appearing in both an error rather than a silent
 * collision.
 *
 * Contains no reactivity and no Solid import. A recipe is a pure function from
 * a selection to a set of attributes, which is what makes it testable without
 * a DOM and cheap to call.
 */
export type Recipe<C extends RecipeConfig = RecipeConfig> = {
  readonly config: C;
  /**
   * Resolves every declared slot for one selection of props and state.
   *
   * `overrides` is the consumer's trailing `class`, merged last and into the
   * root slot only: a caller styling `<Badge class="..."/>` means the badge,
   * not its internals.
   */
  resolve(
    selection: Record<string, unknown>,
    overrides?: string,
  ): ResolvedSlots;
  /** Derives a new recipe from this one. See `extend` below. */
  extend<E extends Partial<RecipeConfig>>(patch: E): Recipe<RecipeConfig>;
};

/**
 * Whether a variant value should contribute its classes.
 *
 * `false` and `undefined` select nothing, which is what makes
 * `{ true: "..." }` behave as a boolean flag. `0` and `""` are values, not
 * absence, so they select normally.
 */
function selectedKey(value: unknown): string | undefined {
  if (value === undefined || value === null || value === false) return undefined;
  if (value === true) return "true";
  return String(value);
}

function classesForSlot(
  classes: VariantClasses,
  slot: string,
  isRoot: boolean,
): string | undefined {
  if (typeof classes === "string") {
    // A bare string is shorthand for the root slot. Applying it to every slot
    // instead would put the component's modifier class on its own internals.
    return isRoot ? classes : undefined;
  }
  return classes[slot];
}

export function recipe<const C extends RecipeConfig>(config: C): Recipe<C> {
  const slotNames = Object.keys(config.slots);
  const propAxes = Object.entries(config.props ?? {});
  const stateAxes = Object.entries(config.state ?? {});

  const collision = propAxes.find(([name]) => name in (config.state ?? {}));
  if (collision) {
    // Thrown at module evaluation, not at render: the recipe is built once when
    // the module loads, so this surfaces the moment the file is imported rather
    // than the first time someone renders the component.
    throw new Error(
      `${config.component}: "${collision[0]}" is declared as both a prop and ` +
        `state. A prop is set by the caller and state is computed by the logic; ` +
        `a name cannot be both.`,
    );
  }

  function resolve(
    selection: Record<string, unknown>,
    overrides?: string,
  ): ResolvedSlots {
    const out: Record<string, SlotAttrs> = {};

    for (const slot of slotNames) {
      const isRoot = slot === "root";
      let classes = config.slots[slot]?.base ?? "";

      for (const [axis, variant] of propAxes) {
        const key = selectedKey(selection[axis]);
        if (key === undefined) continue;
        const variantClasses = variant[key];
        if (variantClasses === undefined) continue;
        classes = cx(classes, classesForSlot(variantClasses, slot, isRoot));
      }

      const attrs: SlotAttrs = { class: classes };

      for (const [axis, variant] of stateAxes) {
        const key = selectedKey(selection[axis]);
        if (key !== undefined) {
          const variantClasses = variant[key];
          if (variantClasses !== undefined) {
            attrs.class = cx(
              attrs.class,
              classesForSlot(variantClasses, slot, isRoot),
            );
          }
        }

        // State mirrors to a data attribute on every slot, not just the root.
        // CSS and tests select on these, and an indicator that cannot be
        // matched on `[data-expanded]` forces a descendant selector instead.
        const value = selection[axis];
        if (value !== undefined && value !== null) {
          attrs[`data-${axis}`] =
            typeof value === "boolean" ? String(value) : String(value);
        }
      }

      // Root carries the component's identity; other slots qualify it, so a
      // selector can find `accordion-trigger` or its `-indicator` specifically.
      attrs["data-slot"] = isRoot
        ? config.component
        : `${config.component}-${slot}`;

      if (isRoot && overrides) {
        attrs.class = cx(attrs.class, overrides);
      }

      out[slot] = attrs;
    }

    return out as ResolvedSlots;
  }

  /**
   * Derives a recipe from this one, for building your own component on
   * someone else's rather than overriding at every call site.
   *
   * Slots, props and state are merged per axis, so a patch adds values to an
   * existing axis without restating the ones it inherited. `component` must be
   * given: two recipes sharing a `data-slot` would be indistinguishable to a
   * selector.
   */
  function extend<E extends Partial<RecipeConfig>>(patch: E): Recipe<RecipeConfig> {
    if (!patch.component) {
      throw new Error(
        `extending ${config.component}: a derived recipe needs its own ` +
          `\`component\`, or the two are indistinguishable in the DOM.`,
      );
    }

    return recipe({
      ...config,
      ...patch,
      component: patch.component,
      slots: { ...config.slots, ...(patch.slots ?? {}) } as RecipeConfig["slots"],
      props: mergeAxes(config.props, patch.props),
      state: mergeAxes(config.state, patch.state),
    });
  }

  return { config, resolve, extend };
}

function mergeAxes(
  base: Record<string, Record<string, VariantClasses>> | undefined,
  patch: Record<string, Record<string, VariantClasses>> | undefined,
): Record<string, Record<string, VariantClasses>> | undefined {
  if (!base) return patch;
  if (!patch) return base;

  const out = { ...base };
  for (const [axis, variant] of Object.entries(patch)) {
    out[axis] = { ...(base[axis] ?? {}), ...variant };
  }
  return out;
}
