export function createAccordionItem(p: ItemBehaviour) {
  const accordion = useAccordion();
  const id = createUniqueId();
  return {
    expanded: () => accordion?.isExpanded(p.value ?? id) ?? false,
    toggle: () => accordion?.toggle(p.value ?? id),
  };
}
