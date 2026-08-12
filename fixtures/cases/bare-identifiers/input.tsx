import type { Layout } from "solid-layouts";
import { accordionTrigger } from "./Accordion.recipe";

export const AccordionTriggerLayout: Layout<typeof accordionTrigger> = () => (
  <button {...slot.root} type="button">
    {children}
    <Show when={showIndicator}>
      <span {...slot.indicator} />
    </Show>
  </button>
);
