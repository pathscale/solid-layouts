export { cx } from "./cx";
// `./ids` is deliberately not re-exported. Instance numbering is the runtime's
// own bookkeeping: nothing outside it should mint an id, and exporting the
// counter invites someone to reset it in the middle of a render.
export { recipe, type Recipe } from "./recipe";
export {
  configureUI,
  resetUIConfig,
  type ComponentDefaults,
  type UIConfig,
} from "./defaults";
export {
  UIDefaults,
  compound,
  defineComponent,
  type ComponentProps,
  type DefineComponentConfig,
  type Layout,
  type LayoutStable,
} from "./component";
export type {
  PropsOf,
  RecipeConfig,
  SlotAttrs,
  SlotDefinition,
  SlotsOf,
  StateOf,
  Variant,
  VariantClasses,
} from "./types";
