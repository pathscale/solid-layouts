import "./Flex.css";
import type { JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { Layout } from "solid-layouts";
import { flex } from "./Flex.recipe";

export type FlexProps = Omit<JSX.HTMLAttributes<HTMLElement>, "ref"> & {
  as?: keyof JSX.IntrinsicElements;
  direction?: "row" | "col" | "row-reverse" | "col-reverse";
  justify?: "start" | "center" | "end" | "between" | "around" | "evenly";
  align?: "start" | "center" | "end" | "stretch" | "baseline";
  wrap?: "wrap" | "nowrap" | "wrap-reverse";
  gap?: "none" | "xs" | "sm" | "base" | "md" | "lg" | "xl";
  paddingInline?: "none" | "sm" | "md" | "lg";
  paddingBlock?: "none" | "sm" | "md" | "lg";
  grow?: boolean;
  shrink?: boolean;
  className?: string;
};

const Flex: Layout<typeof flex, FlexProps> = () => (
  <Dynamic component={local.as ?? "div"} {...slot.root}>
    {children}
  </Dynamic>
);

export const FlexLayout = Flex;
export default Flex;
