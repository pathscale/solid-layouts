import {
  type Context,
  type JSX,
  children as resolveChildren,
  createContext,
  createMemo,
  splitProps,
  useContext,
} from "solid-js";
import { Dynamic, createComponent } from "solid-js/web";
import type { ComponentDefaults, UIConfig } from "./defaults";
import { globalDefaultsFor } from "./defaults";
import { nextInstance, slotId } from "./ids";
import type { Recipe } from "./recipe";
import type { PropsOf, SlotAttrs, SlotsOf, StateOf } from "./types";

/**
 * What a layout receives.
 *
 * Two parameters, and the split is load-bearing rather than stylistic.
 * Destructuring props in Solid normally pins a reactive value, but not
 * everything handed to a layout is reactive: `slot` is a stable object and
 * `children` is resolved once. Putting those two in their own parameter makes
 * `{...slot.root}` and `{children}` safe to destructure, while everything
 * reactive stays behind `p` where the read is visible at the point of use.
 *
 * Written as one parameter, `const { slot, children, expanded } = p` would
 * look uniform and silently stop `expanded` updating.
 */
export type LayoutStable<R> = {
  slot: Record<SlotsOf<R> & string, SlotAttrs>;
  children: JSX.Element;
};

export type Layout<R> = (
  stable: LayoutStable<R>,
  p: PropsOf<R> & StateOf<R> & Record<string, unknown>,
) => JSX.Element;

/** Subtree-scoped defaults. The layer `configureUI` cannot express. */
const UIDefaultsContext = createContext<UIConfig>();

export function UIDefaults(
  props: { children: JSX.Element } & UIConfig,
): JSX.Element {
  const [, overrides] = splitProps(props, ["children"]);
  const inherited = useContext(UIDefaultsContext);

  // Merged with anything above rather than replacing it, so nesting two
  // providers configuring different components composes instead of clobbering.
  const value = createMemo<UIConfig>(() => ({
    ...(inherited ?? {}),
    ...(overrides as UIConfig),
  }));

  return createComponent(UIDefaultsContext.Provider, {
    get value() {
      return value();
    },
    get children() {
      return props.children;
    },
  });
}

export type DefineComponentConfig<R extends Recipe> = {
  recipe: R;
  /** The exported name. Only used to look defaults up by. */
  name?: string;
  /** Rendered when there is no `layout`. Falls back to the recipe's. */
  element?: string;
  /** Library defaults, the lowest layer of the cascade. */
  defaults?: ComponentDefaults;
  /** Receives behaviour props only, never presentation. */
  setup?: (behaviour: Record<string, unknown>) => Record<string, unknown>;
  layout?: Layout<R>;
  /** Wraps the layout. Assembly, so it does not belong in the markup. */
  provide?: Context<unknown>;
};

/**
 * Builds a component from a recipe and, optionally, logic and markup.
 *
 * This is what the generator writes. It is a normal function and a normal
 * import, so a hand-written call works identically; the generator exists to
 * stop anyone typing it, not to do anything they could not.
 */
export function defineComponent<R extends Recipe>(
  config: DefineComponentConfig<R>,
): (props: Record<string, unknown>) => JSX.Element {
  const { recipe, setup, layout, provide } = config;
  const componentName = config.name ?? recipe.config.component;
  const element = config.element ?? recipe.config.element ?? "div";

  const presentationKeys = Object.keys(recipe.config.props ?? {});
  const stateKeys = Object.keys(recipe.config.state ?? {});
  const slotNames = Object.keys(recipe.config.slots);

  const compiled = recipe.config.__compiled;

  return function LayoutComponent(props) {
    const subtree = useContext(UIDefaultsContext);
    const instance = nextInstance();
    /** The id of one of this instance's slots, for aria wiring. */
    const idOf = (slot: string) => slotId(compiled?.slotIds, slot, instance);

    // Three-way split by origin: what the recipe declares is presentation, the
    // universal four are the consumer's escape hatches, and everything left is
    // behaviour and belongs to the logic.
    const [presentation, escape, behaviour] = splitProps(
      props,
      presentationKeys,
      ["class", "className", "style", "children"],
    );

    // `slotId` reaches the logic as well as the layout: an accordion item has
    // to hand its trigger's id to `aria-controls` on the panel, and that is a
    // behavioural fact rather than a presentational one.
    const model = setup
      ? setup(
          Object.defineProperty(behaviour as Record<string, unknown>, "slotId", {
            value: idOf,
            enumerable: false,
          }) as Record<string, unknown>,
        )
      : undefined;

    /** Lowest precedence first: library, app, subtree, call site. */
    const presentationValue = (key: string): unknown => {
      const atCallSite = (presentation as Record<string, unknown>)[key];
      if (atCallSite !== undefined) return atCallSite;
      return (
        subtree?.[componentName]?.[key] ??
        globalDefaultsFor(componentName)?.[key] ??
        config.defaults?.[key]
      );
    };

    const selection = createMemo<Record<string, unknown>>(() => {
      const out: Record<string, unknown> = {};
      for (const key of presentationKeys) out[key] = presentationValue(key);
      for (const key of stateKeys) {
        const accessor = model?.[key];
        out[key] = typeof accessor === "function" ? accessor() : accessor;
      }
      return out;
    });

    // One resolve for every slot, memoised. Resolving per slot access would
    // repeat the whole computation once per element in the layout.
    const resolved = createMemo(() =>
      recipe.resolve(
        selection(),
        [escape.class, escape.className].filter(Boolean).join(" ") || undefined,
      ),
    );

    const slot = {} as Record<string, SlotAttrs>;
    for (const name of slotNames) {
      Object.defineProperty(slot, name, {
        // Non-null because `slotNames` and `resolve` iterate the same
        // `recipe.config.slots`, so a declared slot always resolves.
        get: () => resolved()[name] as SlotAttrs,
        enumerable: true,
      });
    }

    // `children()` rather than the raw prop: it memoises, so a layout can
    // reference `children` more than once. Raw `props.children` cannot.
    const kids = resolveChildren(() => escape.children as JSX.Element);

    const stable = {
      slot,
      get children() {
        return kids();
      },
    } as LayoutStable<R>;

    // Presentation reads resolve through the cascade; state reads unwrap the
    // model's accessors. Both are getters, which is what lets a layout say
    // `p.expanded` instead of `p.expanded()`.
    const p = {} as Record<string, unknown>;
    for (const key of presentationKeys) {
      Object.defineProperty(p, key, {
        get: () => presentationValue(key),
        enumerable: true,
      });
    }
    for (const key of stateKeys) {
      Object.defineProperty(p, key, {
        get: () => {
          const accessor = model?.[key];
          return typeof accessor === "function" ? accessor() : accessor;
        },
        enumerable: true,
      });
    }
    Object.defineProperty(p, "style", {
      get: () => escape.style,
      enumerable: true,
    });
    Object.defineProperty(p, "slotId", { value: idOf, enumerable: false });

    const rendered = layout
      ? layout(stable, p as never)
      : createComponent(Dynamic, {
          component: element,
          get children() {
            return kids();
          },
          // Spread last so the recipe's class and data attributes win over
          // anything an unrecognised prop happened to set.
          ...spreadable(() => resolved().root),
        });

    if (!provide) return rendered;

    return createComponent(provide.Provider, {
      get value() {
        return model?.context;
      },
      get children() {
        return rendered;
      },
    });
  };
}

/**
 * Turns a slot accessor into getter-backed own properties.
 *
 * A plain spread would read the attributes once at creation and freeze the
 * class string at whatever the state was on first render.
 */
function spreadable(get: () => SlotAttrs): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get: (_, key: string) => get()[key],
      has: (_, key: string) => key in get(),
      ownKeys: () => Reflect.ownKeys(get()),
      getOwnPropertyDescriptor: () => ({
        enumerable: true,
        configurable: true,
      }),
    },
  );
}

/**
 * Assembles a compound component: `Accordion.Item`, `Accordion.Trigger`.
 *
 * The parts stay separately exported as well. A consumer who wants only
 * `AccordionItem` should not have to pull the root in to reach it.
 */
export function compound<
  Root extends (props: never) => JSX.Element,
  Parts extends Record<string, unknown>,
>(root: Root, parts: Parts): Root & Parts {
  return Object.assign(root, parts);
}
