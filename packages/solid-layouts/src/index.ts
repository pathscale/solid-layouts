import { cx } from "./cx.js";
import { configureUI, resetUIConfig } from "./defaults.js";
import { UIDefaults, compound, defineComponent } from "./component.js";
import { recipe } from "./recipe.js";

export { UIDefaults, compound, configureUI, cx, defineComponent, recipe, resetUIConfig };
// `./ids` is deliberately not re-exported. Instance numbering is the runtime's
// own bookkeeping: nothing outside it should mint an id, and exporting the
// counter invites someone to reset it in the middle of a render.
export type { Recipe } from "./recipe.js";
export type { ComponentDefaults, UIConfig } from "./defaults.js";
export type { ComponentProps, DefineComponentConfig, Layout, LayoutStable } from "./component.js";
export type {
  PropsOf,
  RecipeConfig,
  SlotAttrs,
  SlotDefinition,
  SlotsOf,
  StateOf,
  Variant,
  VariantClasses,
} from "./types.js";
