import { Show } from "solid-js";
import type { Layout } from "../../src";
import { accordionTrigger } from "./Accordion.recipe";

/**
 * Accordion's markup, and nothing else.
 *
 * Only the trigger needs a layout file. The root and the item each render a
 * single element, so `element` in their recipe is enough and the shared layout
 * renders them.
 *
 * The rule that keeps this readable: nothing here may compute. Every value has
 * already been decided by `accordion.ts` or by the recipe.
 */
export const AccordionTriggerLayout: Layout<typeof accordionTrigger> = (
  { slot, children },
  p,
) => (
  <button
    {...slot.root}
    type="button"
    aria-expanded={p.expanded ? "true" : "false"}
    disabled={p.disabled as boolean}
    onClick={p.onClick as () => void}
  >
    {children}
    <Show when={p.showIndicator !== false}>
      <span {...slot.indicator} aria-hidden="true" />
    </Show>
  </button>
);
