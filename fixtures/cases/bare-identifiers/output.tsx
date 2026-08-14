import type { Layout } from "solid-layouts";
import { Show } from "solid-js";
import { accordionTrigger } from "./Accordion.recipe";

export const AccordionTriggerLayout: Layout<typeof accordionTrigger> = (_stable, p) => (
  <button {..._stable.slot.root} type="button">
    {_stable.children}
    <Show when={p.showIndicator}>
      <span {..._stable.slot.indicator} />
    </Show>
  </button>
);
