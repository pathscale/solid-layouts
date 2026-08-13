import { recipe } from "solid-layouts";

export const flex = recipe({
  component: "flex",
  element: "div",
  slots: { root: { base: "flex-layout" } },
  props: {
    as: {},
    direction: {
      row: "flex-row",
      col: "flex-col",
      "row-reverse": "flex-row-reverse",
      "col-reverse": "flex-col-reverse",
    },
    justify: {
      start: "justify-start",
      center: "justify-center",
      end: "justify-end",
      between: "justify-between",
      around: "justify-around",
      evenly: "justify-evenly",
    },
    align: {
      start: "items-start",
      center: "items-center",
      end: "items-end",
      stretch: "items-stretch",
      baseline: "items-baseline",
    },
    wrap: {
      wrap: "flex-wrap",
      nowrap: "flex-nowrap",
      "wrap-reverse": "flex-wrap-reverse",
    },
    gap: {
      none: "gap-0",
      xs: "gap-1.5",
      sm: "gap-2",
      base: "gap-3",
      md: "gap-4",
      lg: "gap-6",
      xl: "gap-8",
    },
    paddingInline: {
      none: "px-0",
      sm: "px-2",
      md: "px-3.5",
      lg: "px-4",
    },
    paddingBlock: {
      none: "py-0",
      sm: "py-2",
      md: "py-3",
      lg: "py-4",
    },
    grow: { true: "flex-grow", false: "flex-grow-0" },
    shrink: { true: "flex-shrink", false: "flex-shrink-0" },
  },
  defaults: {
    as: "div",
    direction: "row",
    wrap: "nowrap",
  },
_layouts:{slots:{"root":{base:"flex-layout",axes:{"direction":{"row":"flex-row","col":"flex-col","row-reverse":"flex-row-reverse","col-reverse":"flex-col-reverse"},"justify":{"start":"justify-start","center":"justify-center","end":"justify-end","between":"justify-between","around":"justify-around","evenly":"justify-evenly"},"align":{"start":"items-start","center":"items-center","end":"items-end","stretch":"items-stretch","baseline":"items-baseline"},"wrap":{"wrap":"flex-wrap","nowrap":"flex-nowrap","wrap-reverse":"flex-wrap-reverse"},"gap":{"none":"gap-0","xs":"gap-1.5","sm":"gap-2","base":"gap-3","md":"gap-4","lg":"gap-6","xl":"gap-8"},"paddingInline":{"none":"px-0","sm":"px-2","md":"px-3.5","lg":"px-4"},"paddingBlock":{"none":"py-0","sm":"py-2","md":"py-3","lg":"py-4"},"grow":{"true":"flex-grow","false":"flex-grow-0"},"shrink":{"true":"flex-shrink","false":"flex-shrink-0"}}}},stateKeys:[],slotIds:{"root":0}}});
