import "./Button.css";
import { Show, type JSX } from "solid-js";
import type { Layout } from "solid-layouts";
import { button } from "./Button.recipe";

export type ButtonVariant = keyof typeof button.config.props.variant;
export type ButtonSize = keyof typeof button.config.props.size;

type ButtonProps = Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  justify?: "start" | "center" | "between";
  radius?: "none" | "sm" | "md" | "full";
  isIconOnly?: boolean;
  squareSize?: number;
  fillHeight?: boolean;
  fullWidth?: boolean;
  isSelected?: boolean;
  isDisabled?: boolean;
  isPending?: boolean;
  startIcon?: JSX.Element;
  endIcon?: JSX.Element;
  className?: string;
};

const Button: Layout<typeof button, ButtonProps> = (_stable, p) => {
  const disabled = Boolean(p.isDisabled) || Boolean(p.isPending);

  return (
    <button
      type="button"
      {..._stable.slot.root}
      data-pending={p.isPending ? "true" : "false"}
      data-selected={p.isSelected ? "true" : "false"}
      disabled={disabled}
      aria-disabled={disabled ? "true" : "false"}
      style={{
        ...(typeof p.style === "object" ? p.style : {}),
        width: p.squareSize ? `${p.squareSize}px` : undefined,
        height: p.squareSize ? `${p.squareSize}px` : undefined,
        "min-height": p.squareSize ? "0" : undefined,
        "padding-inline": p.squareSize ? "0" : undefined,
        "border-radius": p.squareSize ? `${p.squareSize / 2}px` : undefined,
        "flex-shrink": p.squareSize ? "0" : undefined,
      }}
    >
      <Show when={p.isPending}>
        <span {..._stable.slot.spinner} aria-hidden="true" />
      </Show>
      <Show when={p.startIcon}>
        <span {..._stable.slot.startIcon}>{p.startIcon}</span>
      </Show>
      {_stable.children}
      <Show when={p.endIcon}>
        <span {..._stable.slot.endIcon}>{p.endIcon}</span>
      </Show>
    </button>
  );
};

export const ButtonLayout = Button;
export default Button;

export type { ButtonProps };
