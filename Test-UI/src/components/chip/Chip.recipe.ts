import { recipe } from "solid-layouts";

export const chip = recipe({
  component: "chip",
  element: "span",
  slots: {
    root: { base: "chip" },
    label: { base: "chip__label" },
    startIcon: { base: "chip__icon chip__icon--start" },
    endIcon: { base: "chip__icon chip__icon--end" },
    remove: { base: "chip__remove" },
    removeIcon: { base: "chip__remove-icon" },
  },
  props: {
    variant: {
      solid: "chip--solid",
      flat: "chip--flat",
      bordered: "chip--bordered",
    },
    color: {
      default: "chip--default",
      primary: "chip--primary",
      accent: "chip--accent",
      success: "chip--success",
      warning: "chip--warning",
      danger: "chip--danger",
    },
    size: {
      sm: "chip--sm",
      md: "chip--md",
      lg: "chip--lg",
    },
    startIcon: {},
    endIcon: {},
    onRemove: {},
    removeButtonLabel: {},
    isDisabled: {},
  },
  defaults: {
    variant: "solid",
    color: "default",
    size: "md",
  },
});
