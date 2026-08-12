import { describe, expect, test } from "bun:test";
import { cx } from "./cx";
import { recipe } from "./recipe";

const accordionItem = recipe({
  component: "accordion-item",
  element: "div",
  slots: { root: { base: "accordion__item" } },
  props: {
    tone: {
      neutral: "accordion__item--neutral",
      primary: "accordion__item--primary",
    },
    hideSeparator: { true: "accordion__item--hide-separator" },
  },
  state: {
    expanded: { true: "accordion__item--expanded" },
    disabled: { true: "accordion__item--disabled" },
  },
});

const accordionTrigger = recipe({
  component: "accordion-trigger",
  slots: {
    root: { base: "accordion__trigger" },
    indicator: { base: "accordion__indicator" },
  },
  state: {
    // The case a bare string cannot express: one state, two slots.
    expanded: {
      true: {
        root: "accordion__trigger--expanded",
        indicator: "accordion__indicator--expanded",
      },
    },
  },
});

describe("cx", () => {
  test("joins truthy values and skips the rest", () => {
    expect(cx("a", false, undefined, "b", null, "")).toBe("a b");
  });

  test("returns an empty string rather than a stray space", () => {
    expect(cx(undefined, false)).toBe("");
  });
});

describe("recipe", () => {
  test("a bare slot resolves to its base class and identity", () => {
    const { root } = accordionItem.resolve({});
    expect(root.class).toBe("accordion__item");
    expect(root["data-slot"]).toBe("accordion-item");
  });

  test("props contribute classes but no data attribute", () => {
    const { root } = accordionItem.resolve({ tone: "primary" });
    expect(root.class).toBe("accordion__item accordion__item--primary");
    expect(root["data-tone"]).toBeUndefined();
  });

  test("state contributes both a class and a data attribute", () => {
    const { root } = accordionItem.resolve({ expanded: true });
    expect(root.class).toBe("accordion__item accordion__item--expanded");
    expect(root["data-expanded"]).toBe("true");
  });

  test("a false state still reports itself, so CSS can select on it", () => {
    const { root } = accordionItem.resolve({ expanded: false });
    expect(root.class).toBe("accordion__item");
    expect(root["data-expanded"]).toBe("false");
  });

  test("boolean props select nothing when false", () => {
    const on = accordionItem.resolve({ hideSeparator: true }).root;
    const off = accordionItem.resolve({ hideSeparator: false }).root;
    expect(on.class).toContain("--hide-separator");
    expect(off.class).not.toContain("--hide-separator");
  });

  test("the consumer override merges last, into the root only", () => {
    const resolved = accordionTrigger.resolve({}, "my-app-thing");
    expect(resolved.root.class.endsWith("my-app-thing")).toBe(true);
    expect(resolved.indicator!.class).not.toContain("my-app-thing");
  });

  test("a non-root slot qualifies the component name", () => {
    const indicatorSlot = accordionTrigger.resolve({}).indicator;
    expect(indicatorSlot!["data-slot"]).toBe("accordion-trigger-indicator");
  });

  test("one state can reach several slots", () => {
    const { root, indicator: indicatorSlot } = accordionTrigger.resolve({ expanded: true });
    expect(root.class).toBe("accordion__trigger accordion__trigger--expanded");
    expect(indicatorSlot!.class).toBe(
      "accordion__indicator accordion__indicator--expanded",
    );
  });

  test("a bare string variant does not leak onto non-root slots", () => {
    // `accordionItem`'s classes are strings, so a second slot would get none.
    const twoSlot = recipe({
      component: "x",
      slots: { root: { base: "x" }, tail: { base: "x__tail" } },
      state: { on: { true: "x--on" } },
    });
    const { root, tail: tailSlot } = twoSlot.resolve({ on: true });
    expect(root.class).toBe("x x--on");
    expect(tailSlot!.class).toBe("x__tail");
  });

  test("a name declared as both a prop and state is rejected at build time", () => {
    expect(() =>
      recipe({
        component: "bad",
        slots: { root: {} },
        props: { open: { true: "a" } },
        state: { open: { true: "b" } },
      }),
    ).toThrow(/cannot be both/);
  });
});

describe("recipe.extend", () => {
  const dangerItem = accordionItem.extend({
    component: "danger-item",
    props: { tone: { danger: "accordion__item--danger" } },
  });

  test("inherits slots and existing variant values", () => {
    expect(dangerItem.resolve({ tone: "primary" }).root.class).toContain(
      "accordion__item--primary",
    );
  });

  test("adds new values to an inherited axis", () => {
    expect(dangerItem.resolve({ tone: "danger" }).root.class).toContain(
      "accordion__item--danger",
    );
  });

  test("takes its own identity", () => {
    expect(dangerItem.resolve({}).root["data-slot"]).toBe("danger-item");
  });

  test("refuses to share an identity with its parent", () => {
    expect(() => accordionItem.extend({ props: {} })).toThrow(/needs its own/);
  });
});
