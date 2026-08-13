"use strict";

const { existsSync } = require("node:fs");
const { join } = require("node:path");

/**
 * Loads the native binding for whichever platform this is.
 *
 * Written by hand rather than generated so the package works from a plain
 * `cargo build`: napi's own loader expects the CLI's naming and its optional
 * per-platform dependencies, and requiring that toolchain to be present would
 * make the crate undevelopable without it. The lookup below tries the local
 * build first and the bundled npm binary second.
 */

const { platform, arch } = process;

const TARGETS = {
  "darwin-arm64": "darwin-arm64",
  "linux-x64": "linux-x64-gnu",
  "linux-arm64": "linux-arm64-gnu",
};

const key = `${platform}-${arch}`;
const target = TARGETS[key];

if (!target) {
  throw new Error(
    `solid-layouts-oxc has no build for ${key}. Supported: ${Object.keys(TARGETS).join(", ")}.`,
  );
}

const local = join(__dirname, `solid-layouts-oxc.${target}.node`);

if (!existsSync(local)) {
  throw new Error(
    `solid-layouts-oxc could not load its native binding for ${key}. ` +
      `Build it with \`cargo build --release --features napi\` and place the library at ${local}.`,
  );
}

module.exports = require(local);
