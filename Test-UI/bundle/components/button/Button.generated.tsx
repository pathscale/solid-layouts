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

const Button: Layout<typeof button, ButtonProps> = ({ slot, children }, p) => {
  const disabled = Boolean(p.isDisabled) || Boolean(p.isPending);

  return (
    <button
      type="button"
      {...slot.root}
      data-pending={p.isPending ? "true" : "false"}
      disabled={disabled}
      aria-disabled={disabled ? "true" : "false"}
    >
      <Show when={p.isPending}>
        <span {...slot.spinner} aria-hidden="true" />
      </Show>
      <Show when={p.startIcon}>
        <span {...slot.startIcon}>{p.startIcon}</span>
      </Show>
      {children}
      <Show when={p.endIcon}>
        <span {...slot.endIcon}>{p.endIcon}</span>
      </Show>
    </button>
  );
};

export const ButtonLayout = Button;
export default Button;
