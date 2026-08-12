#!/bin/sh
# Builds the native binding and names it the way index.js looks for it.
#
# Run on install, so the package works straight from a git dependency without
# anything having been published. Needs a Rust toolchain; a consumer without
# cargo gets a clear failure here rather than a missing-module error later.
set -e

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)  target=darwin-arm64;    lib=libsolid_layouts_oxc.dylib ;;
  Darwin-x86_64) target=darwin-x64;      lib=libsolid_layouts_oxc.dylib ;;
  Linux-x86_64)  target=linux-x64-gnu;   lib=libsolid_layouts_oxc.so ;;
  Linux-aarch64) target=linux-arm64-gnu; lib=libsolid_layouts_oxc.so ;;
  *) echo "solid-layouts-oxc: no build for $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

[ -f "solid-layouts-oxc.$target.node" ] && exit 0

command -v cargo >/dev/null 2>&1 || {
  echo "solid-layouts-oxc: cargo is required to build from source" >&2
  exit 1
}

cargo build --release --features napi
cp "target/release/$lib" "solid-layouts-oxc.$target.node"
