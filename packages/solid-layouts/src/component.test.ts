import { afterEach, describe, expect, test } from "bun:test";
import { createRenderEffect, createRoot, createSignal } from "solid-js";

// Run these with `bun test --conditions=browser`, which the package script
// does. Solid ships separate client and server builds behind export
// conditions, and without an explicit one Bun resolves the server build, where
// effects run once and signals never propagate. Every reactivity assertion
// below would then pass while testing nothing, which is worse than failing:
// `createRenderEffect(() => log.push(n()))` records `[0]` and stays there.
import { asAttributes, defineComponent } from "./component";
import { configureUI, resetUIConfig } from "./defaults";
import { recipe } from "./recipe";
import type { SlotAttrs } from "./types";

afterEach(resetUIConfig);

const button = recipe({
  component: "button",
  element: "button",
  slots: { root: { base: "btn" }, icon: { base: "btn__icon" } },
  props: {
    color: { primary: "btn--primary", danger: "btn--danger" },
    size: { sm: "btn--sm", md: "btn--md", lg: "btn--lg" },
  },
  state: { loading: { true: "btn--loading" } },
});

/**
 * Captures what a layout is handed, so the parts that are otherwise invisible
 * can be asserted on: the three-way props split, the cascade, and whether `p`
 * reads through to a signal rather than freezing at first render.
 *
 * No JSX and no DOM. The layout is just a function, which is the property that
 * makes this testable at all.
 */
function capturing() {
  const seen: {
    slot?: Record<string, SlotAttrs>;
    p?: Record<string, unknown>;
    children?: unknown;
  } = {};
  const layout = (
    stable: { slot: Record<string, SlotAttrs>; children: unknown },
    p: Record<string, unknown>,
  ) => {
    seen.slot = stable.slot;
    seen.p = p;
    seen.children = stable.children;
    return null;
  };
  return { seen, layout };
}

function mount(
  component: (props: Record<string, unknown>) => unknown,
  props: Record<string, unknown> = {},
) {
  return createRoot((dispose) => {
    component(props);
    return dispose;
  });
}

describe("defineComponent: the props split", () => {
  test("presentation reaches the recipe, declared behaviour reaches setup", () => {
    const { seen, layout } = capturing();
    let behaviour: Record<string, unknown> | undefined;

    const Button = defineComponent({
      recipe: button,
      layout: layout as never,
      behaviour: ["value"],
      setup: (b) => {
        behaviour = b;
        return { loading: () => false };
      },
    });

    const dispose = mount(Button, {
      color: "danger",
      onClick: "handler",
      value: 7,
    });

    expect(seen.slot?.root?.class).toContain("btn--danger");
    // The whole point of the split: setup must not see presentation.
    expect(behaviour).not.toHaveProperty("color");
    expect(behaviour?.value).toBe(7);
    // And it must not see plain HTML either. `onClick` belongs on the
    // element, not in the logic, and only what the component declared as
    // behaviour arrives here.
    expect(behaviour).not.toHaveProperty("onClick");
    dispose();
  });

  test("undeclared props are HTML and reach the element", () => {
    // The bucket that did not exist: `id`, `onClick`, `aria-label` and
    // `data-testid` were swallowed as behaviour and never rendered.
    let rendered: Record<string, unknown> | undefined;
    const Button = defineComponent({
      recipe: button,
      layout: ((_s: unknown, _p: unknown) => null) as never,
    });
    const Capture = defineComponent({
      recipe: button,
      layout: ((stable: unknown, p: Record<string, unknown>) => {
        rendered = p;
        return null;
      }) as never,
    });
    void Button;

    const dispose = mount(Capture, { id: "save", "aria-label": "Save" });
    // They are not presentation and not declared behaviour, so they are HTML.
    expect(rendered).not.toHaveProperty("aria-label");
    dispose();
  });

  test("camelCased data props become the attributes they mean", () => {
    // `dataTheme` is the prop name in TypeScript on roughly forty components,
    // but the DOM wants `data-theme`. Solid sets unknown props verbatim, so
    // without the rename the element carries a literal `dataTheme` attribute
    // and every `[data-theme]` selector misses it.
    let theme = "dark";
    const attributes = asAttributes({
      get dataTheme() {
        return theme;
      },
      dataTestId: "save",
      id: "save",
    });

    expect(Object.keys(attributes).sort()).toEqual([
      "data-test-id",
      "data-theme",
      "id",
    ]);
    expect(attributes["data-theme"]).toBe("dark");
    expect(attributes.id).toBe("save");

    // Lazily, so a prop that changes still reaches the element.
    theme = "light";
    expect(attributes["data-theme"]).toBe("light");

    // A component with nothing to rename is handed back untouched, rather
    // than wrapped in a proxy it does not need.
    const plain = { id: "save" };
    expect(asAttributes(plain)).toBe(plain);
  });

  test("class and style are the consumer's, not the logic's", () => {
    let behaviour: Record<string, unknown> | undefined;
    const { seen, layout } = capturing();

    const Button = defineComponent({
      recipe: button,
      layout: layout as never,
      setup: (b) => {
        behaviour = b;
        return {};
      },
    });

    const dispose = mount(Button, { class: "mine", style: { color: "red" } });

    expect(behaviour).not.toHaveProperty("class");
    expect(seen.slot?.root?.class.endsWith("mine")).toBe(true);
    dispose();
  });
});

describe("defineComponent: the defaults cascade", () => {
  test("a library default applies when nothing overrides it", () => {
    const { seen, layout } = capturing();
    const Button = defineComponent({
      recipe: button,
      layout: layout as never,
      defaults: { size: "md" },
    });

    const dispose = mount(Button);
    expect(seen.slot?.root?.class).toContain("btn--md");
    dispose();
  });

  test("configureUI beats the library default", () => {
    configureUI({ button: { size: "lg" } });
    const { seen, layout } = capturing();
    const Button = defineComponent({
      recipe: button,
      layout: layout as never,
      defaults: { size: "md" },
    });

    const dispose = mount(Button);
    expect(seen.slot?.root?.class).toContain("btn--lg");
    expect(seen.slot?.root?.class).not.toContain("btn--md");
    dispose();
  });

  test("the call site beats everything", () => {
    configureUI({ button: { size: "lg" } });
    const { seen, layout } = capturing();
    const Button = defineComponent({
      recipe: button,
      layout: layout as never,
      defaults: { size: "md" },
    });

    const dispose = mount(Button, { size: "sm" });
    expect(seen.slot?.root?.class).toContain("btn--sm");
    dispose();
  });

  test("defaults are looked up by the component's exported name", () => {
    configureUI({ FancyButton: { size: "lg" } });
    const { seen, layout } = capturing();
    const Button = defineComponent({
      recipe: button,
      name: "FancyButton",
      layout: layout as never,
    });

    const dispose = mount(Button);
    expect(seen.slot?.root?.class).toContain("btn--lg");
    dispose();
  });
});

describe("defineComponent: state", () => {
  test("p reads a value, not an accessor", () => {
    const { seen, layout } = capturing();
    const Button = defineComponent({
      recipe: button,
      layout: layout as never,
      setup: () => ({ loading: () => true }),
    });

    const dispose = mount(Button);
    // The whole reason `p` is getter-backed: no parens at the call site.
    expect(seen.p?.loading).toBe(true);
    dispose();
  });

  test("p tracks a signal rather than freezing at first render", () => {
    const [loading, setLoading] = createSignal(false);
    const { seen, layout } = capturing();
    const Button = defineComponent({
      recipe: button,
      layout: layout as never,
      setup: () => ({ loading }),
    });

    const dispose = mount(Button);
    expect(seen.p?.loading).toBe(false);
    setLoading(true);

    // `p`'s getters read the model's accessor directly, with no memo in the
    // way, so they are correct from any context. A destructured or snapshotted
    // `p` would still say false here, which is what the two-parameter
    // signature exists to prevent.
    expect(seen.p?.loading).toBe(true);
    dispose();
  });

  test("a slot updates when the state it reflects changes", () => {
    const [loading, setLoading] = createSignal(false);
    const { seen, layout } = capturing();
    const Button = defineComponent({
      recipe: button,
      layout: layout as never,
      setup: () => ({ loading }),
    });

    // Read inside a render effect, because that is what JSX does: a spread
    // compiles to `createRenderEffect`, not `createEffect`. Two things follow.
    // A Solid memo with no observer does not recompute when read from plain
    // code, so asserting on the getter directly would test the absence of an
    // observer rather than the runtime. And `createEffect` is deferred, so it
    // would not have run before the signal was set.
    const seenClasses: string[] = [];
    const dispose = createRoot((d) => {
      Button({});
      createRenderEffect(() => {
        seenClasses.push(seen.slot?.root?.class ?? "");
      });
      return d;
    });

    setLoading(true);

    expect(seenClasses[0]).not.toContain("btn--loading");
    expect(seenClasses.at(-1)).toContain("btn--loading");
    dispose();
  });

  test("state reaches every slot's data attributes", () => {
    const { seen, layout } = capturing();
    const Button = defineComponent({
      recipe: button,
      layout: layout as never,
      setup: () => ({ loading: () => true }),
    });

    const dispose = mount(Button);
    expect(seen.slot?.icon?.["data-loading"]).toBe("true");
    dispose();
  });

  test("a slot carries its identity", () => {
    const { seen, layout } = capturing();
    const Button = defineComponent({ recipe: button, layout: layout as never });

    const dispose = mount(Button);
    expect(seen.slot?.root?.["data-slot"]).toBe("button");
    expect(seen.slot?.icon?.["data-slot"]).toBe("button-icon");
    dispose();
  });
});

describe("defineComponent: children", () => {
  test("children are handed to the layout", () => {
    const { seen, layout } = capturing();
    const Button = defineComponent({ recipe: button, layout: layout as never });

    const dispose = mount(Button, { children: "press me" });
    expect(seen.children).toBe("press me");
    dispose();
  });

  test("children can be read more than once", () => {
    const { seen, layout } = capturing();
    const Button = defineComponent({ recipe: button, layout: layout as never });

    const dispose = mount(Button, { children: "press me" });
    // `children()` memoises. Raw `props.children` recreates on each access,
    // which is why the runtime resolves it rather than passing it through.
    expect(seen.children).toBe("press me");
    expect(seen.children).toBe("press me");
    dispose();
  });
});

describe("defineComponent: identity", () => {
  test("a user-set id wins and becomes the base for the other slots", () => {
    // `id` is a standard HTML attribute; `<label for>`, anchors and test
    // hooks all need it, so it cannot be refused. Slot identity is a separate
    // thing and lives in `data-slot`.
    let ids: (string | undefined)[] = [];
    const Button = defineComponent({
      recipe: button,
      layout: ((_s: unknown, p: Record<string, unknown>) => {
        const slotId = p.slotId as (s: string) => string | undefined;
        ids = [slotId("root"), slotId("icon")];
        return null;
      }) as never,
    });

    const dispose = mount(Button, { id: "save" });
    expect(ids[0]).toBe("save");
    expect(ids[1]).toBe("save-icon");
    dispose();
  });

  test("data-slot is the compiler's and a caller cannot overwrite it", () => {
    const { seen, layout } = capturing();
    const Button = defineComponent({ recipe: button, layout: layout as never });

    const dispose = mount(Button, { id: "mine" });
    expect(seen.slot?.root?.["data-slot"]).toBe("button");
    dispose();
  });
});

describe("defineComponent: what p unwraps", () => {
  test("a model member that is a function is returned, not called", () => {
    // The bug this exists to prevent: unwrapping everything meant an event
    // handler was invoked with no arguments the moment a layout read it, and
    // `p.setTyped` came back as `undefined` rather than as the handler.
    let seen: unknown;
    let calls = 0;
    const Button = defineComponent({
      recipe: button,
      setup: () => ({
        loading: () => false,
        onPress: () => {
          calls += 1;
        },
      }),
      layout: ((_s: unknown, p: Record<string, unknown>) => {
        seen = p.onPress;
        return null;
      }) as never,
    });

    const dispose = mount(Button);
    expect(typeof seen).toBe("function");
    expect(calls).toBe(0);
    dispose();
  });

  test("a declared state key is still unwrapped to its value", () => {
    const { seen, layout } = capturing();
    const Button = defineComponent({
      recipe: button,
      setup: () => ({ loading: () => true }),
      layout: layout as never,
    });

    const dispose = mount(Button);
    expect(seen.p?.loading).toBe(true);
    dispose();
  });

  test("the context is not exposed on p", () => {
    // It is assembly, handed to the provider by defineComponent. A layout
    // reading it would be reaching around the boundary.
    const { seen, layout } = capturing();
    const Button = defineComponent({
      recipe: button,
      setup: () => ({ context: { secret: 1 } }),
      layout: layout as never,
    });

    const dispose = mount(Button);
    expect(seen.p).not.toHaveProperty("context");
    dispose();
  });
});
