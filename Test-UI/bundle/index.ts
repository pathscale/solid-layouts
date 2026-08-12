import { defineComponent as __defineLayoutComponent } from "solid-layouts/application-boundary";
import { IconLayout } from "./components/icon/Icon.generated";
import { icon } from "./components/icon/Icon.recipe";
export const Icon = __defineLayoutComponent({ recipe: icon, layout: IconLayout });
import { ButtonLayout } from "./components/button/Button.generated";
import { button } from "./components/button/Button.recipe";
export const Button = __defineLayoutComponent({ recipe: button, layout: ButtonLayout });
