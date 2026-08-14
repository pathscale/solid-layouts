/**
 * Emits the runtime twice: once for Solid 1.9, once for Solid 2.0.
 *
 * The two builds share every source file but one. `renderer.ts` is the only
 * module a major of Solid can move rather than rename - 1.9 serves `Dynamic`
 * and `createComponent` from `solid-js/web`, 2.0 from `@solidjs/web` and drops
 * the old subpath - so the 2.0 build is the same tree with `renderer.ts`
 * replaced by `renderer.solid-2.ts`.
 *
 * Copying the tree rather than pointing a second tsconfig at a different file
 * is deliberate: TypeScript's `paths` does not remap relative specifiers, and
 * `component.ts` imports `./renderer.js` relatively because at runtime it must.
 *
 * `dist/` keeps its path and a 1.9 consumer importing `solid-layouts` gets a
 * build that imports no 2.0 package: `renderer.solid-2.ts` is excluded from
 * this pass rather than merely unused by it, so nothing resolves `@solidjs/web`
 * in a tree that has no reason to have installed it.
 */
import { execFileSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Not dot-prefixed: TypeScript skips hidden directories when resolving
// `include`, so a `.solid-2` staging tree compiles to "no inputs were found".
const staging = resolve(root, "solid-2-staging");
const tsc = resolve(root, "node_modules/.bin/tsc");

const run = (...args) =>
  execFileSync(tsc, args, { cwd: root, stdio: "inherit" });

rmSync(resolve(root, "dist"), { recursive: true, force: true });
rmSync(staging, { recursive: true, force: true });

run("-p", "tsconfig.build.json");

try {
  cpSync(resolve(root, "src"), staging, { recursive: true });
  cpSync(resolve(staging, "renderer.solid-2.ts"), resolve(staging, "renderer.ts"));
  rmSync(resolve(staging, "renderer.solid-2.ts"));
  run("-p", "tsconfig.solid-2.json");
} finally {
  rmSync(staging, { recursive: true, force: true });
}
