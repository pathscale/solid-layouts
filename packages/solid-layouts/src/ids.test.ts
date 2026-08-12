import { afterEach, describe, expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { defineComponent } from "./component";
import { __nextInstance, __resetInstances, __slotId } from "./ids";
import { parityCompiled } from "./__parity__/parity.compiled";
import { recipe } from "./recipe";
import type { CompiledRecipe, RecipeConfig } from "./types";

afterEach(__resetInstances);

describe("slot ids", () => {
  test("the compiler assigns an index per slot", () => {
    const compiled = (parityCompiled.config as RecipeConfig)
      ._layouts as CompiledRecipe;
    const indices = Object.values(compiled.slotIds);
    expect(indices.length).toBe(3);
    expect(new Set(indices).size).toBe(3);
  });

  test("an id is the slot index and the instance", () => {
    expect(__slotId({ root: 7 }, "root", 3)).toBe("7-3");
  });

  test("an uncompiled recipe yields no id rather than inventing one", () => {
    // An id whose shape depended on whether the compiler ran would break
    // aria-controls in exactly the builds nobody tests.
    expect(__slotId(undefined, "root", 0)).toBeUndefined();
    expect(__slotId({ root: 1 }, "missing", 0)).toBeUndefined();
  });

  test("instances are distinct and monotonic", () => {
    const a = __nextInstance();
    const b = __nextInstance();
    expect(b).toBe(a + 1);
  });
});

describe("slot ids through a component", () => {
  const button = recipe({
    component: "button",
    slots: { root: { base: "btn" } },
  });
  // Hand-written to stand in for a compiled table, since this recipe is
  // declared in a test file the Rust compiler never sees.
  (button.config as RecipeConfig)._layouts = {
    slots: { root: { base: "btn", axes: {} } },
    stateKeys: [],
    slotIds: { root: 4 },
  };

  test("two instances of one component get different ids", () => {
    const seen: (string | undefined)[] = [];
    const Button = defineComponent({
      recipe: button,
      layout: ((_stable: unknown, p: Record<string, unknown>) => {
        seen.push((p.slotId as (s: string) => string | undefined)("root"));
        return null;
      }) as never,
    });

    createRoot((dispose) => {
      Button({});
      Button({});
      dispose();
    });

    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
    expect(seen[0]?.startsWith("4-")).toBe(true);
  });

  test("the logic can reach an id too", () => {
    // An accordion item hands its trigger's id to `aria-controls` on the
    // panel, which is behavioural rather than presentational.
    let fromSetup: string | undefined;
    const Button = defineComponent({
      recipe: button,
      setup: (behaviour) => {
        fromSetup = (behaviour.slotId as (s: string) => string | undefined)(
          "root",
        );
        return {};
      },
      layout: (() => null) as never,
    });

    createRoot((dispose) => {
      Button({});
      dispose();
    });

    expect(fromSetup?.startsWith("4-")).toBe(true);
  });
});
