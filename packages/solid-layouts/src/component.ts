import * as solid from "solid-js";
import {
  type Context,
  children as resolveChildren,
  createContext,
  createMemo,
  useContext,
} from "solid-js";
import type { ComponentDefaults, UIConfig } from "./defaults.js";
import { globalDefaultsFor } from "./defaults.js";
import { __nextInstance, __slotId } from "./ids.js";
import type { Recipe } from "./recipe.js";
import { Dynamic, type JSX, createComponent } from "./renderer.js";
import type { PropsOf, SlotAttrs, SlotsOf, StateOf } from "./types.js";

/**
 * `props` without `keys`, still tracked.
 *
 * 1.9 spells this `splitProps(props, keys)[1]`. 2.0 renamed it to `omit`, made
 * it variadic, and took `splitProps` away.
 *
 * Detected from the module object rather than configured, and resolved once at
 * load rather than branched per call. Which one is there is a fact about the
 * `solid-js` that got installed, and no build flag can be more right about that
 * than the module itself; a flag can only disagree with it.
 */
type Solid1Props = {
  splitProps(
    props: Record<string, unknown>,
    keys: string[],
  ): [Record<string, unknown>, Record<string, unknown>];
};
type Solid2Props = {
  omit(
    props: Record<string, unknown>,
    ...keys: string[]
  ): Record<string, unknown>;
};

const rest: (
  props: Record<string, unknown>,
  keys: readonly string[],
) => Record<string, unknown> =
  "omit" in solid
    ? (props, keys) =>
        (solid as unknown as Solid2Props).omit(props, ...keys)
    : (props, keys) =>
        (solid as unknown as Solid1Props).splitProps(props, keys as string[])[1];

/**
 * The component that provides a context's value.
 *
 * 1.9 hangs it off the context as `.Provider`. In 2.0 the context *is* the
 * provider and `.Provider` is gone, so asking for it and falling back covers
 * both without knowing which is running.
 */
type Provider<T> = (props: { value: T; children: JSX.Element }) => JSX.Element;

const providerOf = <T,>(context: unknown): Provider<T> =>
  ((context as { Provider?: unknown }).Provider ?? context) as Provider<T>;

/** The four props every consumer may set, whatever the component declares. */
const ESCAPE_KEYS = ["class", "className", "style", "children"] as const;

/**
 * The half of `splitProps` neither major ships: both give back a remainder,
 * neither gives back a subset.
 *
 * Each bucket is a plain object of getters over `props`, which is what
 * `splitProps` returned anyway, so reads stay tracked at the point of use.
 *
 * A key absent from `props` is skipped rather than defined as `undefined`,
 * matching `splitProps`. `setup` receives the behaviour bucket, and some read
 * their own keys with `in` or `Object.keys`, which a defined-but-undefined key
 * would answer wrongly.
 */
function pick(
  props: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (!(key in props)) continue;
    Object.defineProperty(out, key, {
      get: () => props[key],
      enumerable: true,
      configurable: true,
    });
  }
  return out;
}

/**
 * What a layout receives.
 *
 * Two parameters, and the split is load-bearing rather than stylistic.
 * Destructuring props in Solid normally pins a reactive value, but not
 * everything handed to a layout is reactive: `slot` is a stable object and
 * `children` is resolved once. Putting those two in their own parameter makes
 * `{...slot.root}` and `{children}` safe to destructure, while everything
 * reactive stays behind `props`, where the read is visible at the point of use.
 *
 * Written as one parameter, `const { slot, children, expanded } = props`
 * would look uniform and silently stop `expanded` updating.
 */
export type LayoutStable<R> = {
  slot: Record<SlotsOf<R> & string, SlotAttrs>;
  children: JSX.Element;
};

export type Layout<R, Model = Record<never, never>> = (
  stable: LayoutStable<R>,
  props: PropsOf<R> & StateOf<R> & Model & Record<string, unknown>,
) => JSX.Element;

/**
 * Subtree-scoped defaults. The layer `configureUI` cannot express.
 *
 * The empty default is load-bearing under 2.0, where `useContext` throws
 * `ContextNotFoundError` instead of returning `undefined` when nothing above
 * has provided a value. Every component built here reads this context and most
 * trees never mount a `<UIDefaults>`, so a default-less context would make an
 * unconfigured application throw on its first render. 1.9 reads the same
 * default the same way, so this is one spelling rather than a branch.
 */
const UIDefaultsContext = createContext<UIConfig>({});

export function UIDefaults(
  props: { children: JSX.Element } & UIConfig,
): JSX.Element {
  const overrides = rest(props as unknown as Record<string, unknown>, [
    "children",
  ]);
  const inherited = useContext(UIDefaultsContext);

  // Merged with anything above rather than replacing it, so nesting two
  // providers configuring different components composes instead of clobbering.
  const value = createMemo<UIConfig>(() => ({
    ...inherited,
    ...(overrides as UIConfig),
  }));

  return createComponent(providerOf<UIConfig>(UIDefaultsContext), {
    get value() {
      return value();
    },
    get children() {
      return props.children;
    },
  });
}

export type DefineComponentConfig<
  R extends Recipe,
  Model = Record<never, never>,
> = {
  recipe: R;
  /** The exported name. Only used to look defaults up by. */
  name?: string;
  /** Rendered when there is no `layout`. Falls back to the recipe's. */
  element?: string;
  /**
   * Which slot this component *is*, when it is part of a compound.
   *
   * `Badge`, `Badge.Anchor` and `Badge.Label` share one recipe but are three
   * components, each rendering a different slot. Naming the slot here is what
   * puts the caller's plain HTML on the right element and gives the component
   * the right class; it defaults to `root`, which is what a component that is
   * the whole of its recipe wants.
   */
  slot?: SlotsOf<R> & string;
  /** Library defaults, the lowest layer of the cascade. */
  defaults?: ComponentDefaults;
  /**
   * The prop names this component's logic consumes.
   *
   * Declared for the same reason presentation is: without it there is no way
   * to tell `onValueChange`, which belongs to the logic, from `onClick`, which
   * belongs on the element. Anything in neither list is plain HTML and passes
   * through untouched, which is what `id`, `aria-*`, `title` and
   * `data-testid` need.
   */
  behaviour?: readonly string[];
  /** Receives behaviour props only, never presentation. */
  setup?: (behaviour: Record<string, unknown>) => Record<string, unknown>;
  layout?: Layout<R, Model>;
  /** The compiled Layout owns its existing prop split during source migration. */
  embedded?: boolean;
  /**
   * Wraps the layout. Assembly, so it does not belong in the markup.
   *
   * `Context<any>` because `Context` is invariant in its value: a
   * `Context<AlertValue | undefined>` is not assignable to `Context<unknown>`,
   * so narrowing this would reject every real context a component provides.
   */
  // biome-ignore lint/suspicious/noExplicitAny: see above
  provide?: Context<any>;
};

/**
 * Builds a component from a recipe and, optionally, logic and markup.
 *
 * This is what the generator writes. It is a normal function and a normal
 * import, so a hand-written call works identically; the generator exists to
 * stop anyone typing it, not to do anything they could not.
 */
/**
 * The props a component built from `R` accepts.
 *
 * `Behaviour` is supplied by the caller because nothing in the recipe knows
 * about it: those props are the ones neither presentation nor plain HTML.
 */
export type ComponentProps<R extends Recipe, Behaviour = unknown> = PropsOf<R> &
  StateOf<R> &
  Behaviour &
  JSX.HTMLAttributes<HTMLElement>;

export function defineComponent<
  R extends Recipe,
  Model = Record<never, never>,
>(
  config: DefineComponentConfig<R, Model>,
): (props: ComponentProps<R, Model>) => JSX.Element {
  const { recipe, setup, layout, provide, embedded = false } = config;
  const componentName = config.name ?? recipe.config.component;
  const element = config.element ?? recipe.config.element ?? "div";

  const behaviourKeys = config.behaviour ?? [];
  const presentationKeys = Object.keys(recipe.config.props ?? {});
  const stateKeys = Object.keys(recipe.config.state ?? {});
  const slotNames = Object.keys(recipe.config.slots);
  /** The slot this component renders as itself. See `slot` on the config. */
  const rootSlot = (config.slot ?? "root") as string;

  // Which bucket each declared key belongs to, decided once per component
  // rather than once per render. `splitProps` made the buckets disjoint by
  // construction: a key named in two lists landed in the earlier one only.
  // Picking by name does not, so first claim wins here instead. The order
  // decides real cases - a recipe that declares `size` and a component whose
  // logic also wants `size` must not hand the logic a prop the presentation
  // cascade has already resolved.
  const claimed = new Set<string>();
  const claim = (keys: readonly string[]): string[] => {
    const own: string[] = [];
    for (const key of keys) {
      if (claimed.has(key)) continue;
      claimed.add(key);
      own.push(key);
    }
    return own;
  };
  const presentationOwn = claim(presentationKeys);
  const escapeOwn = claim(ESCAPE_KEYS);
  const behaviourOwn = claim(behaviourKeys);
  /** Everything routed somewhere. What is left over is plain HTML. */
  const routedKeys = [...presentationOwn, ...escapeOwn, ...behaviourOwn];

  const compiled = recipe.config._layouts;

  return function LayoutComponent(outer: ComponentProps<R, Model>) {
    // The public signature is typed; the body works in terms of a plain record
    // because every split here is by name at runtime, and threading the generic
    // through `splitProps` buys nothing but noise.
    const props = outer as unknown as Record<string, unknown>;
    const subtree = useContext(UIDefaultsContext);
    const instance = __nextInstance();
    /**
     * The id of one of this instance's slots, for aria wiring.
     *
     * A user-set `id` wins on the root and becomes the base for the rest, so
     * `aria-controls` points at the element the author actually named rather
     * than at a generated id the DOM does not carry.
     */
    const idOf = (slot: string) => {
      const given = (props as Record<string, unknown>).id;
      if (typeof given === "string") {
        return slot === rootSlot ? given : `${given}-${slot}`;
      }
      return __slotId(compiled?.slotIds, slot, instance);
    };

    // Four-way split by destination. What the recipe declares is presentation;
    // the universal four are the consumer's escape hatches; what the component
    // declares is behaviour and goes to the logic; everything left is plain
    // HTML and belongs on the element.
    //
    // The fourth bucket is not optional. Without it `id`, `onClick`,
    // `aria-label` and `data-testid` were swallowed as behaviour and never
    // reached the DOM at all.
    //
    // One `splitProps` call used to return all four. Solid 2 has only the
    // remainder half of it, so the three routed buckets are picked by name and
    // the fourth still falls out of one call, as before.
    const presentation = pick(props, presentationOwn);
    const escape = pick(props, escapeOwn);
    const behaviour = pick(props, behaviourOwn);
    const passthrough = rest(props, routedKeys);

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
        subtree[componentName]?.[key] ??
        globalDefaultsFor(componentName)?.[key] ??
        config.defaults?.[key] ??
        // The recipe's own, so a default can live beside the axis it defaults
        // rather than in a file of its own.
        recipe.config.defaults?.[key]
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
        //
        // The root slot also carries the plain-HTML props. Without this a
        // component with a layout drops them: the no-layout path spreads
        // `passthrough` onto the element itself, but a layout only ever sees
        // `slot`, so `<Badge.Anchor id="x" onClick={...}>` rendered neither.
        // Recipe attributes go on top, so a caller still cannot overwrite the
        // class or the `data-slot` that identifies the component.
        //
        // Compiled components are not an exception, though they were: this read
        // `name === rootSlot && !embedded`, which exempted every component the
        // compiler produces, which is all of them in a real library. A stock
        // button rendered without the `aria-label`, `title`, `data-testid` or
        // `onClick` its caller passed, and nothing said so. It cost 72 of the 78
        // failures that porting one application to a Layout-based library
        // produced, and each one read as an application bug.
        get: () =>
          name === rootSlot
            ? ({
                ...asAttributes(passthrough as Record<string, unknown>),
                ...(resolved()[name] as SlotAttrs),
              } as SlotAttrs)
            : (resolved()[name] as SlotAttrs),
        enumerable: true,
      });
    }

    // `children()` rather than the raw prop: it memoises, so a layout can
    // reference `children` more than once. Raw `props.children` cannot.
    //
    // Built on first read rather than here, because `children()` is a memo and
    // a memo computes immediately: creating it at this point constructs every
    // child before the layout has rendered anything. A layout that provides a
    // context then provides it to nobody — its children already exist, outside
    // it — which is what `<Alert>` hit, its indicator throwing "must be used
    // within <Alert>" while sitting inside one. Deferring lets the read happen
    // under the provider.
    let kids: (() => JSX.Element) | undefined;

    const stable = {
      slot,
      get children() {
        if (!kids) kids = resolveChildren(() => escape.children as JSX.Element);
        return kids();
      },
    } as LayoutStable<R>;

    // Presentation reads resolve through the cascade; state reads unwrap the
    // model's accessors. Both are getters, which is what lets a layout say
    // `props.expanded` instead of `props.expanded()`.
    const readable = {} as Record<string, unknown>;
    if (embedded) {
      for (const key of Object.keys(props)) {
        Object.defineProperty(readable, key, {
          get: () => props[key],
          enumerable: true,
          configurable: true,
        });
      }
    }
    for (const key of presentationKeys) {
      Object.defineProperty(readable, key, {
        get: () => presentationValue(key),
        enumerable: true,
      });
    }
    // Declared state is unwrapped: the recipe named it, so it is a value the
    // class map consumes and the layout reads without parentheses.
    for (const key of stateKeys) {
      Object.defineProperty(readable, key, {
        get: () => {
          const accessor = model?.[key];
          return typeof accessor === "function" ? accessor() : accessor;
        },
        enumerable: true,
      });
    }

    // Everything else the setup returns passes through untouched.
    //
    // Unwrapping these too was a bug with a sharp edge: a model member that is
    // itself a function, such as an event handler, would be *called* rather
    // than returned, and `p.setTyped` came back as the result of invoking it
    // with no arguments. Only a name the recipe declared as state can be
    // assumed to be an accessor.
    for (const key of Object.keys(model ?? {})) {
      if (stateKeys.includes(key) || key === "context") continue;
      Object.defineProperty(readable, key, {
        get: () => model?.[key],
        enumerable: true,
      });
    }
    Object.defineProperty(readable, "style", {
      get: () => escape.style,
      enumerable: true,
    });
    Object.defineProperty(readable, "slotId", { value: idOf, enumerable: false });

    const rendered = layout
      ? layout(stable, readable as never)
      : createComponent(Dynamic, {
          component: element,
          get children() {
            return stable.children;
          },
          // Pass-through first, the recipe's attributes last: a caller may set
          // `id` or `aria-label`, but must not be able to overwrite the class
          // or the `data-slot` that identifies the component.
          ...asAttributes(passthrough as Record<string, unknown>),
          ...spreadable(() => resolved()[rootSlot] as SlotAttrs),
        });

    // Nothing to provide means no wrapper, and under 2.0 that is a correctness
    // rule rather than an optimisation: a provider counts as having provided
    // even when its value is `undefined`, and `useContext` throws on an
    // undefined value, so an empty provider would shadow a real one above it
    // with a throw. Under 1.9 the two spellings are indistinguishable.
    if (!provide || !model || !("context" in model)) return rendered;

    return createComponent(providerOf(provide), {
      get value() {
        return model.context;
      },
      get children() {
        return rendered;
      },
    });
  };
}

/**
 * Renames camelCased `data*` props to the attributes they mean.
 *
 * A caller writes `dataTheme="dark"` because that is what the prop is called in
 * TypeScript, but the DOM wants `data-theme`. Solid sets unknown props as
 * attributes verbatim, so without this the element gets a literal `dataTheme`
 * attribute and every `[data-theme]` selector misses. It is one rule rather
 * than a per-component concern: `dataTheme` is on roughly forty components.
 *
 * The lookup is lazy, so a prop that changes still reaches the element.
 */
export function asAttributes(
  props: Record<string, unknown>,
): Record<string, unknown> {
  const toAttribute = (key: string): string =>
    /^data[A-Z]/.test(key)
      ? `data-${key.slice(4).replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`
      : key;

  const back = new Map<string, string>();
  for (const key of Object.keys(props)) {
    const attribute = toAttribute(key);
    if (attribute !== key) back.set(attribute, key);
  }
  if (back.size === 0) return props;

  return new Proxy(props, {
    get: (target, key) =>
      target[back.get(key as string) ?? (key as string)] as unknown,
    has: (target, key) =>
      back.has(key as string) || Reflect.has(target, key),
    ownKeys: (target) => Reflect.ownKeys(target).map((key) => toAttribute(key as string)),
    getOwnPropertyDescriptor: (target, key) => {
      const source = back.get(key as string) ?? (key as string);
      if (!Reflect.has(target, source)) return undefined;
      return {
        enumerable: true,
        configurable: true,
        get: () => target[source] as unknown,
      };
    },
  }) as Record<string, unknown>;
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
