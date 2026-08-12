import { recipe } from "../../src";

export const accordionRoot = recipe({
  component: "accordion",
  element: "div",
  slots: { root: { base: "accordion" } },
  props: {
    variant: { default: "accordion--default", surface: "accordion--surface" },
  },
  state: {
    disabled: { true: "accordion--disabled" },
  },
});

export const accordionItem = recipe({
  component: "accordion-item",
  element: "div",
  slots: { root: { base: "accordion__item" } },
  props: {
    hideSeparator: { true: "accordion__item--hide-separator" },
  },
  state: {
    expanded: { true: "accordion__item--expanded" },
    disabled: { true: "accordion__item--disabled" },
  },
});

export const accordionTrigger = recipe({
  component: "accordion-trigger",
  element: "button",
  slots: {
    root: { base: "accordion__trigger" },
    indicator: { base: "accordion__indicator" },
  },
  state: {
    // The case a bare string cannot express, and the reason slot-keyed
    // variants exist: one state reaching two elements.
    expanded: {
      true: {
        root: "accordion__trigger--expanded",
        indicator: "accordion__indicator--expanded",
      },
    },
    disabled: { true: "accordion__trigger--disabled" },
  },
});
