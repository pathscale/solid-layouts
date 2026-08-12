import type { Layout } from "solid-layouts";
import { accordionTrigger } from "./Accordion.recipe";

export const AccordionTriggerLayout: Layout<typeof accordionTrigger> =
  ({ slot, children }, p) => (
    <button {...slot.root} type="button">
      {children}
      <span {...slot.indicator} />
    </button>
  );
