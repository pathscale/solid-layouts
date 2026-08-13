import "./Chip.css";
import { Show, type JSX } from "solid-js";
import type { Layout } from "solid-layouts";
import { chip } from "./Chip.recipe";

export type ChipVariant = keyof typeof chip.config.props.variant;
export type ChipColor = keyof typeof chip.config.props.color;
export type ChipSize = keyof typeof chip.config.props.size;

export type ChipProps = Omit<JSX.HTMLAttributes<HTMLSpanElement>, "color"> & {
  variant?: ChipVariant;
  color?: ChipColor;
  size?: ChipSize;
  startIcon?: JSX.Element;
  endIcon?: JSX.Element;
  onRemove?: () => void;
  removeButtonLabel?: string;
  isDisabled?: boolean;
  className?: string;
};

const Chip: Layout<typeof chip, ChipProps> = ({ slot, children }, p) => (
  <span
    {...slot.root}
    data-disabled={p.isDisabled ? "true" : "false"}
    data-removable={p.onRemove ? "true" : "false"}
  >
    <Show when={p.startIcon}>
      <span {...slot.startIcon}>{p.startIcon}</span>
    </Show>
    <span {...slot.label}>{children}</span>
    <Show when={p.onRemove && p.endIcon}>
      <button
        type="button"
        {...slot.remove}
        aria-label={p.removeButtonLabel ?? "Remove"}
        disabled={Boolean(p.isDisabled)}
        onClick={(event) => {
          event.stopPropagation();
          p.onRemove?.();
        }}
      >
        <span {...slot.removeIcon}>{p.endIcon}</span>
      </button>
    </Show>
    <Show when={!p.onRemove && p.endIcon}>
      <span {...slot.endIcon}>{p.endIcon}</span>
    </Show>
  </span>
);

export const ChipLayout = Chip;
export default Chip;
