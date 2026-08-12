import { compound, defineComponent } from "../../src";
import {
  AccordionContext,
  AccordionItemContext,
  createAccordion,
  createAccordionItem,
  createAccordionTrigger,
} from "./accordion";
import {
  accordionItem,
  accordionRoot,
  accordionTrigger,
} from "./Accordion.recipe";
import { AccordionTriggerLayout } from "./Accordion.layout";

/**
 * The wiring. This is what the generator writes; it is here by hand so the
 * example stands on its own.
 *
 * Note what is not here. No `splitProps`, no class merging, no `data-slot`
 * strings, no provider in the markup. `defineComponent` reads each recipe to
 * learn which prop names are presentation and routes the rest to `setup`.
 */

const AccordionRoot = defineComponent({
  recipe: accordionRoot,
  name: "Accordion",
  setup: createAccordion as never,
  provide: AccordionContext as never,
  defaults: { variant: "default" },
});

const AccordionItem = defineComponent({
  recipe: accordionItem,
  name: "AccordionItem",
  setup: createAccordionItem as never,
  provide: AccordionItemContext as never,
});

const AccordionTrigger = defineComponent({
  recipe: accordionTrigger,
  name: "AccordionTrigger",
  setup: createAccordionTrigger as never,
  layout: AccordionTriggerLayout as never,
});

export const Accordion = compound(AccordionRoot as never, {
  Item: AccordionItem,
  Trigger: AccordionTrigger,
});

export { AccordionItem, AccordionRoot, AccordionTrigger };
