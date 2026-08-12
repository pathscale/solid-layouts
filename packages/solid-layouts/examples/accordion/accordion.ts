import { createContext, createSignal, createUniqueId, useContext } from "solid-js";

/**
 * Accordion's behaviour. No JSX, no presentation props, no class names.
 *
 * This file is the test of whether the split survives a component that is
 * actually hard: compound parts, two contexts, a controlled value, and
 * keyboard navigation across siblings.
 */

export type SelectionMode = "single" | "multiple";

type RootContext = {
  isExpanded: (value: string) => boolean;
  toggle: (value: string) => void;
  disabled: () => boolean;
};

type ItemContext = {
  value: () => string;
  expanded: () => boolean;
  disabled: () => boolean;
  toggle: () => void;
};

export const AccordionContext = createContext<RootContext>();
export const AccordionItemContext = createContext<ItemContext>();

export const useAccordion = () => useContext(AccordionContext);
export const useAccordionItem = () => useContext(AccordionItemContext);

/** Everything crossing this boundary is normalised, so a controlled value and
 * the internal signal cannot disagree about shape. */
function normalise(
  value: string | string[] | undefined,
  mode: SelectionMode,
): string[] {
  if (value === undefined) return [];
  const raw = Array.isArray(value) ? value : [value];
  const unique = Array.from(new Set(raw));
  return mode === "single" ? unique.slice(0, 1) : unique;
}

export type RootBehaviour = {
  selectionMode?: SelectionMode;
  value?: string | string[];
  defaultValue?: string | string[];
  onValueChange?: (value: string[]) => void;
  disabled?: boolean;
};

export function createAccordion(p: RootBehaviour) {
  const mode = () => p.selectionMode ?? "single";
  const [internal, setInternal] = createSignal<string[]>(
    normalise(p.defaultValue, p.selectionMode ?? "single"),
  );

  // Read per call, never cached: control can be handed over at any time, and a
  // component that decided once would ignore it.
  const selected = () =>
    p.value !== undefined ? normalise(p.value, mode()) : internal();

  const setSelected = (next: string[]) => {
    const normalised = normalise(next, mode());
    if (p.value === undefined) setInternal(normalised);
    // Fires either way. A controlled parent has to hear about the change it is
    // expected to apply.
    p.onValueChange?.(normalised);
  };

  const isExpanded = (value: string) => selected().includes(value);

  const toggle = (value: string) => {
    if (p.disabled) return;
    const current = selected();
    const open = current.includes(value);

    if (mode() === "single") {
      setSelected(open ? [] : [value]);
      return;
    }
    setSelected(
      open ? current.filter((v) => v !== value) : [...current, value],
    );
  };

  const disabled = () => Boolean(p.disabled);

  return {
    // A `state` key of the recipe, so it reaches the class map by name.
    disabled,
    selected,
    context: { isExpanded, toggle, disabled } satisfies RootContext,
  };
}

export type ItemBehaviour = { value?: string; disabled?: boolean };

export function createAccordionItem(p: ItemBehaviour) {
  const accordion = useAccordion();
  const id = createUniqueId();
  const value = () => p.value ?? id;

  const expanded = () => accordion?.isExpanded(value()) ?? false;
  const disabled = () => Boolean(p.disabled) || Boolean(accordion?.disabled());
  const toggle = () => {
    if (disabled()) return;
    accordion?.toggle(value());
  };

  return {
    expanded,
    disabled,
    context: { value, expanded, disabled, toggle } satisfies ItemContext,
  };
}

export function createAccordionTrigger() {
  const item = useAccordionItem();

  return {
    expanded: () => Boolean(item?.expanded()),
    disabled: () => Boolean(item?.disabled()),
    onClick: () => item?.toggle(),
  };
}
