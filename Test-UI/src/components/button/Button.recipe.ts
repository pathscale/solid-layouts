import { recipe } from "solid-layouts";

export const button = recipe({
  component: "button",
  element: "button",
  slots: {
    root: { base: "button" },
    spinner: { base: "button__spinner" },
    startIcon: { base: "button__icon button__icon--start" },
    endIcon: { base: "button__icon button__icon--end" },
  },
  props: {
    variant: {
      primary: "button--primary",
      secondary: "button--secondary",
      tertiary: "button--tertiary",
      outline: "button--outline",
      ghost: "button--ghost",
      danger: "button--danger",
      "danger-soft": "button--danger-soft",
    },
    size: {
      xs: "button--xs",
      sm: "button--sm",
      md: "button--md",
      lg: "button--lg",
    },
    justify: {
      start: "button--justify-start",
      center: "button--justify-center",
      between: "button--justify-between",
    },
    radius: {
      none: "button--radius-none",
      sm: "button--radius-sm",
      md: "button--radius-md",
      full: "button--radius-full",
    },
    isIconOnly: { true: "button--icon-only" },
    squareSize: {},
    fillHeight: { true: "button--fill-height" },
    fullWidth: { true: "button--full-width" },
    isSelected: { true: "button--selected" },
    isDisabled: {},
    isPending: {},
    startIcon: {},
    endIcon: {},
  },
  defaults: {
    variant: "primary",
    size: "md",
    justify: "center",
    radius: "full",
  },
});
