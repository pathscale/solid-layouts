import { defineComponent as __defineLayoutComponent } from "solid-layouts/application-boundary";
import { IconLayout } from "./components/icon/Icon.generated";
import { icon } from "./components/icon/Icon.recipe";
export const Icon = __defineLayoutComponent({ recipe: icon, layout: IconLayout });
export type { IconProps } from "./components/icon/Icon.generated";
import { ButtonLayout } from "./components/button/Button.generated";
import { button } from "./components/button/Button.recipe";
export const Button = __defineLayoutComponent({ recipe: button, layout: ButtonLayout });
export type { ButtonProps, ButtonVariant, ButtonSize } from "./components/button/Button.generated";
