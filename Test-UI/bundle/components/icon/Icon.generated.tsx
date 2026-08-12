import "./Icon.css";
import { createMemo } from "solid-js";
import { twMerge } from "tailwind-merge";
import type { Layout } from "solid-layouts";
import type { IComponentBaseProps, ComponentColor } from "../../types";
import { icon } from "./Icon.recipe";

export type IconProps = IComponentBaseProps & {
  width?: number;
  height?: number;
  color?: ComponentColor;
  name?: string;
};

const Icon: Layout<typeof icon, IconProps> = ({ slot, children }, p) => {
  const width = p.width ?? 24;
  const height = p.height ?? 24;

  const classes = createMemo(() =>
    twMerge(slot.root.class, p.name, p.class, p.className),
  );

  return (
    <span
      {...slot.root}
      {...{ class: classes() }}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        ...(typeof p.style === "object" ? p.style : {}),
      }}
      data-theme={p.dataTheme}
    />
  );
};

export const IconLayout = Icon;
export default Icon;
