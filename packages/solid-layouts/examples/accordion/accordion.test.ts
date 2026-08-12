import { describe, expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { accordionItem, accordionTrigger } from "./Accordion.recipe";
import { createAccordion } from "./accordion";

/**
 * Exercises the design against the component it was designed from.
 *
 * Accordion is the hard case: compound parts, two contexts, a controlled
 * value, and state that has to reach two slots. If the split survives here it
 * survives generally.
 *
 * The logic is tested directly rather than through a rendered tree, which is
 * the property the split buys: `accordion.ts` imports no JSX, so it needs no
 * DOM and no JSX transform to exercise.
 */

describe("accordion logic, uncontrolled", () => {
  test("single mode keeps at most one item open", () => {
    createRoot((dispose) => {
      const a = createAccordion({ defaultValue: "one" });
      expect(a.selected()).toEqual(["one"]);

      a.context.toggle("two");
      expect(a.selected()).toEqual(["two"]);

      dispose();
    });
  });

  test("toggling the open item closes it", () => {
    createRoot((dispose) => {
      const a = createAccordion({ defaultValue: "one" });
      a.context.toggle("one");
      expect(a.selected()).toEqual([]);
      dispose();
    });
  });

  test("multiple mode accumulates", () => {
    createRoot((dispose) => {
      const a = createAccordion({ selectionMode: "multiple" });
      a.context.toggle("one");
      a.context.toggle("two");
      expect(a.selected()).toEqual(["one", "two"]);

      a.context.toggle("one");
      expect(a.selected()).toEqual(["two"]);
      dispose();
    });
  });

  test("a defaultValue array is truncated in single mode", () => {
    createRoot((dispose) => {
      const a = createAccordion({ defaultValue: ["one", "two"] });
      expect(a.selected()).toEqual(["one"]);
      dispose();
    });
  });
});

describe("accordion logic, controlled", () => {
  test("a controlled value is not changed internally", () => {
    createRoot((dispose) => {
      const changes: string[][] = [];
      const a = createAccordion({
        value: "one",
        onValueChange: (v) => changes.push(v),
      });

      a.context.toggle("two");

      // The parent owns the value; the component only reports what it would be.
      expect(a.selected()).toEqual(["one"]);
      expect(changes).toEqual([["two"]]);
      dispose();
    });
  });

  test("onValueChange fires on the uncontrolled path too", () => {
    createRoot((dispose) => {
      const changes: string[][] = [];
      const a = createAccordion({ onValueChange: (v) => changes.push(v) });
      a.context.toggle("one");
      expect(changes).toEqual([["one"]]);
      dispose();
    });
  });

  test("a disabled accordion ignores toggles", () => {
    createRoot((dispose) => {
      const a = createAccordion({ defaultValue: "one", disabled: true });
      a.context.toggle("two");
      expect(a.selected()).toEqual(["one"]);
      dispose();
    });
  });
});

describe("accordion recipes", () => {
  test("an item reflects its state in both class and data", () => {
    const { root } = accordionItem.resolve({ expanded: true, disabled: false });
    expect(root.class).toBe("accordion__item accordion__item--expanded");
    expect(root["data-expanded"]).toBe("true");
    expect(root["data-disabled"]).toBe("false");
    expect(root["data-slot"]).toBe("accordion-item");
  });

  test("one state reaches both of the trigger's slots", () => {
    const resolved = accordionTrigger.resolve({ expanded: true });
    expect(resolved.root.class).toContain("accordion__trigger--expanded");
    expect(resolved.indicator!.class).toContain("accordion__indicator--expanded");
    // Both carry the attribute, so a rule can match the indicator directly
    // instead of through a descendant selector.
    expect(resolved.indicator!["data-expanded"]).toBe("true");
  });

  test("the two slots are separately addressable", () => {
    const resolved = accordionTrigger.resolve({});
    expect(resolved.root["data-slot"]).toBe("accordion-trigger");
    expect(resolved.indicator!["data-slot"]).toBe("accordion-trigger-indicator");
  });
});
