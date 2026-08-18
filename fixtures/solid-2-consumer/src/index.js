/*
 * Import the Solid 2 entry and reach the code path that differs between
 * majors, so the bundler has to resolve it for real.
 *
 * `defineComponent` is the public surface; internally it splits props with the
 * helper that broke. That helper used to be chosen by reading the module
 * object at load, so a bundler saw both `omit` and `splitProps` and failed to
 * link whichever does not exist in the installed Solid. Importing the public
 * entry is the honest test: it is what a consumer writes.
 */
import { cx, defineComponent } from "solid-layouts/solid-2";

if (typeof defineComponent !== "function") {
  throw new Error("defineComponent is not callable from the Solid 2 entry");
}
if (cx("a", false, "b") !== "a b") {
  throw new Error("cx did not compose classes");
}

// Referenced so the bundler cannot treat the imports as dead code.
globalThis.__solid2Entry = { defineComponent, cx };
