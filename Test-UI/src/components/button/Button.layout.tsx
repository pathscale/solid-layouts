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
  isDisabled?: boolean;
  isPending?: boolean;
  startIcon?: JSX.Element;
  endIcon?: JSX.Element;
  className?: string;
};

const Button: Layout<typeof button, ButtonProps> = () => {
  const disabled = Boolean(local.isDisabled) || Boolean(local.isPending);

  return (
    <button
      type="button"
      {...slot.root}
      data-pending={local.isPending ? "true" : "false"}
      disabled={disabled}
      aria-disabled={disabled ? "true" : "false"}
      style={{
        ...(typeof local.style === "object" ? local.style : {}),
        width: local.squareSize ? `${local.squareSize}px` : undefined,
        height: local.squareSize ? `${local.squareSize}px` : undefined,
        "min-height": local.squareSize ? "0" : undefined,
        "padding-inline": local.squareSize ? "0" : undefined,
        "border-radius": local.squareSize ? `${local.squareSize / 2}px` : undefined,
        "flex-shrink": local.squareSize ? "0" : undefined,
      }}
    >
      <Show when={local.isPending}>
        <span {...slot.spinner} aria-hidden="true" />
      </Show>
      <Show when={local.startIcon}>
        <span {...slot.startIcon}>{local.startIcon}</span>
      </Show>
      {children}
      <Show when={local.endIcon}>
        <span {...slot.endIcon}>{local.endIcon}</span>
      </Show>
    </button>
  );
};

export const ButtonLayout = Button;
export default Button;

export type { ButtonProps };
