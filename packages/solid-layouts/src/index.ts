import { cx } from "./cx";
import { configureUI, resetUIConfig } from "./defaults";
import { UIDefaults, compound, defineComponent } from "./component";
import { recipe } from "./recipe";

export { UIDefaults, compound, configureUI, cx, defineComponent, recipe, resetUIConfig };
// `./ids` is deliberately not re-exported. Instance numbering is the runtime's
// own bookkeeping: nothing outside it should mint an id, and exporting the
// counter invites someone to reset it in the middle of a render.
export type { Recipe } from "./recipe";
export type { ComponentDefaults, UIConfig } from "./defaults";
export type { ComponentProps, DefineComponentConfig, Layout, LayoutStable } from "./component";
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
