import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

/**
 * Neither build may mention the other major's spelling of `rest`.
 *
 * `props` minus `keys` is `splitProps(props, keys)[1]` in 1.9 and `omit` in
 * 2.0, and the two are not both present in either. This used to be settled at
 * load by reading the module object, which is right when it runs and cannot be
 * bundled: a bundler resolves both arms of the conditional against the
 * installed `solid-js`, so a 2.0 consumer failed to link on the 1.9 arm's
 * `splitProps` before any of it executed.
 *
 * The choice therefore lives in `renderer.ts`, the one file the build already
 * swaps per major, and this asserts the swap left no trace of the other arm.
 * Emitted output rather than source, because the source is shared and only the
 * build can be wrong here.
 */
describe("per-major props shim", () => {
  const emitted = (path: string) => readFileSync(join(ROOT, path), "utf8");
  // Comments keep discussing both names, which is fine; only code matters.
  const code = (text: string) =>
    text
      .split("\n")
      .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("/*"))
      .join("\n");

  it("uses omit in the 2.0 build and never splitProps", () => {
    const renderer = code(emitted("dist/solid-2/renderer.js"));
    expect(renderer).toContain("omit(");
    expect(renderer).not.toContain("splitProps");
  });

  it("uses splitProps in the 1.9 build and never omit", () => {
    const renderer = code(emitted("dist/renderer.js"));
    expect(renderer).toContain("splitProps");
    expect(renderer).not.toContain("omit(");
  });

  it("leaves no conditional between the two in either component build", () => {
    for (const path of ["dist/component.js", "dist/solid-2/component.js"]) {
      const component = code(emitted(path));
      // The shim is imported from the renderer now, so neither name is read here.
      expect(component).not.toContain("in solid");
    }
  });
});
