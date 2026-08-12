/**
 * Joins class strings, skipping falsy ones.
 *
 * The merge used everywhere a recipe emits BEM, which is nearly everywhere.
 * Deliberately not a `flat().filter().join()`: that allocates two arrays per
 * call, and this runs on every component instance whenever its state changes.
 *
 * Measured under Bun, per call over 200k iterations, on a representative
 * four-argument merge:
 *
 *                                    repeated input   varying input
 *     twMerge (has an LRU cache)          131 ns          994 ns
 *     flat().filter().join()              104 ns          132 ns
 *     cx                                   38 ns           53 ns
 *
 * Measure under the engine that runs the code. The same benchmark under Node
 * puts cached `twMerge` ahead of the array version, which is the opposite
 * ordering and a V8 artifact. For the chuzz shell the target is Boa, with no
 * JIT at all.
 */
export function cx(
  ...values: (string | false | null | undefined)[]
): string {
  let out = "";
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (!value) continue;
    out = out ? `${out} ${value}` : value;
  }
  return out;
}
