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
      sm: "button--sm",
      md: "button--md",
      lg: "button--lg",
    },
    isIconOnly: { true: "button--icon-only" },
    fullWidth: { true: "button--full-width" },
    isDisabled: {},
    isPending: {},
    startIcon: {},
    endIcon: {},
  },
  defaults: {
    variant: "primary",
    size: "md",
  },
_layouts:{slots:{"root":{base:"button",axes:{"variant":{"primary":"button--primary","secondary":"button--secondary","tertiary":"button--tertiary","outline":"button--outline","ghost":"button--ghost","danger":"button--danger","danger-soft":"button--danger-soft"},"size":{"sm":"button--sm","md":"button--md","lg":"button--lg"},"isIconOnly":{"true":"button--icon-only"},"fullWidth":{"true":"button--full-width"}}},"spinner":{base:"button__spinner",axes:{}},"startIcon":{base:"button__icon button__icon--start",axes:{}},"endIcon":{base:"button__icon button__icon--end",axes:{}}},stateKeys:[],slotIds:{"root":1,"spinner":2,"startIcon":3,"endIcon":0}}});
