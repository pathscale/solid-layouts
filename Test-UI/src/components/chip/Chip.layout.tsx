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

const Chip: Layout<typeof chip, ChipProps> = () => (
  <span
    {...slot.root}
    data-disabled={local.isDisabled ? "true" : "false"}
    data-removable={local.onRemove ? "true" : "false"}
  >
    <Show when={local.startIcon}>
      <span {...slot.startIcon}>{local.startIcon}</span>
    </Show>
    <span {...slot.label}>{children}</span>
    <Show when={local.onRemove && local.endIcon}>
      <button
        type="button"
        {...slot.remove}
        aria-label={local.removeButtonLabel ?? "Remove"}
        disabled={Boolean(local.isDisabled)}
        onClick={(event) => {
          event.stopPropagation();
          local.onRemove?.();
        }}
      >
        <span {...slot.removeIcon}>{local.endIcon}</span>
      </button>
    </Show>
    <Show when={!local.onRemove && local.endIcon}>
      <span {...slot.endIcon}>{local.endIcon}</span>
    </Show>
  </span>
);

export const ChipLayout = Chip;
export default Chip;
