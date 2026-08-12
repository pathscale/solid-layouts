/**
 * Per-instance identity.
 *
 * The static half is compiled in: the compiler enumerates every
 * `(component, slot)` pair it can see and assigns each a stable index. Only
 * the instance number is a runtime concern, and a counter is all it needs to
 * be.
 *
 * A registry would have been the alternative, with each component announcing
 * itself on first render so ids could be handed out. That costs a map write
 * per component type, makes ids depend on render order, and means nothing can
 * be resolved before the thing has rendered at least once.
 */

let counter = 0;

/** The next instance number. Monotonic for the life of the document. */
export function nextInstance(): number {
  return counter++;
}

/**
 * Drops the counter back to zero.
 *
 * Exists for tests. Ids that keep climbing across cases make a snapshot
 * depend on what ran before it.
 */
export function resetInstances(): void {
  counter = 0;
}

/**
 * `${slotIndex}-${instance}`, or nothing when the recipe was not compiled.
 *
 * Absent rather than invented: an id that changed shape depending on whether
 * the compiler ran would break `aria-controls` in exactly the builds nobody
 * tests.
 */
export function slotId(
  slotIds: Record<string, number> | undefined,
  slot: string,
  instance: number,
): string | undefined {
  const index = slotIds?.[slot];
  return index === undefined ? undefined : `${index}-${instance}`;
}
