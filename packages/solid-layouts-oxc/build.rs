fn main() {
    // Only runs the napi setup when the binding is actually being built. A
    // plain `cargo build` or `cargo test` does nothing here, which is what
    // lets the crate be developed without Node installed.
    #[cfg(feature = "napi")]
    napi_build::setup();
}
