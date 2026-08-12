import type { JSX } from "solid-js";

export type ComponentColor = string;

export type IComponentBaseProps = {
  class?: string;
  className?: string;
  style?: JSX.CSSProperties | string;
  dataTheme?: string;
};
