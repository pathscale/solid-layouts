import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/*
 * Rspack on purpose, not a lighter bundler.
 *
 * The failure this fixture exists to catch is a *link* error, and Rspack is
 * the linker that produced it in the consumer that reported it:
 *
 *   ESModulesLinkingError: export 'splitProps' (imported as 'solid') was not
 *   found in 'solid-js'
 *
 * A runtime-only check cannot see that: the conditional it came from picked
 * the correct arm at runtime and would have executed fine. Only a bundler
 * resolving both arms against an installed Solid 2 fails, which is what this
 * job reproduces.
 */
export default {
  mode: "production",
  entry: resolve(here, "src/index.js"),
  output: { path: resolve(here, "dist"), filename: "bundle.js" },
  resolve: {
    // The workspace copy, so this tests the tree being changed rather than
    // whatever is published.
    // Solid 2 ships its browser entry behind this condition; without it the
    // server build resolves and the assertions below prove nothing.
    conditionNames: ["solid", "browser", "import", "module", "default"],
    /*
     * Solid resolves from *this* fixture, not from the package under test.
     *
     * `packages/solid-layouts` develops against an installed 1.9, so without
     * this the bundler walks up from the package's own `node_modules` and
     * links `@solidjs/web` 2.0 against `solid-js` 1.9 - which fails on a dozen
     * exports that only exist in one of them, and says nothing about the code
     * being tested.
     */
    alias: {
      // The built Solid 2 entry, by path. Aliasing the package root does not
      // work: an alias replaces the whole specifier, so the `/solid-2`
      // subpath export is never consulted.
      "solid-layouts/solid-2": resolve(
        here,
        "../../packages/solid-layouts/dist/solid-2/index.js",
      ),
      "solid-js": resolve(here, "node_modules/solid-js"),
      "@solidjs/web": resolve(here, "node_modules/@solidjs/web"),
    },
  },
  // A missing export must fail the build rather than warn.
  optimization: { minimize: false },
  stats: { errorDetails: true },
  experiments: { outputModule: true },
  externalsType: "module",
};
