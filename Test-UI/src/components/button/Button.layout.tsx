import "./Button.css";
import { Show, type JSX } from "solid-js";
import type { Layout } from "solid-layouts";
import { button } from "./Button.recipe";

export type ButtonProps = Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> & {
  variant?: "primary" | "secondary" | "tertiary" | "outline" | "ghost" | "danger" | "danger-soft";
  size?: "sm" | "md" | "lg";
  isIconOnly?: boolean;
  fullWidth?: boolean;
  isDisabled?: boolean;
  isPending?: boolean;
  startIcon?: JSX.Element;
  endIcon?: JSX.Element;
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
