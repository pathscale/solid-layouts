import { recipe } from "solid-layouts";

export const CLASSES = {
  base: "icon",
} as const;

export const icon = recipe({
  component: "icon",
  element: "span",
  slots: { root: { base: "icon" } },
  props: { name: {}, width: {}, height: {} },
_layouts:{slots:{"root":{base:"icon",axes:{}}},stateKeys:[],slotIds:{"root":0}}});
