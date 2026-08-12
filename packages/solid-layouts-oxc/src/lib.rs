//! The host binding.
//!
//! Everything here is behind the `napi` feature. The transform itself lives in
//! `layouts-transform` and has no idea a JS runtime exists, which is what lets
//! `cargo test` run the whole pass with no Node, no Bun and no bundler.

pub use layouts_common::{Diagnostic, FileKind, Severity, TransformOptions, TransformResult};
pub use layouts_transform::{FoundLayout, find_layouts, print, transform};

#[cfg(feature = "napi")]
mod binding {
    use napi_derive::napi;

    /// Mirrors [`layouts_common::TransformResult`] across the boundary.
    ///
    /// A separate type rather than a serde derive on the original: napi wants
    /// its own representation, and coupling the internal type to the wire
    /// format would mean a refactor of one is a breaking change to the other.
    #[napi(object)]
    pub struct JsTransformResult {
        pub code: String,
        pub diagnostics: Vec<String>,
        pub changed: bool,
    }

    #[napi]
    pub fn transform(source: String, filename: String) -> JsTransformResult {
        let options = layouts_common::TransformOptions::new(filename);
        let result = layouts_transform::transform(&source, &options);

        JsTransformResult {
            code: result.code,
            diagnostics: result
                .diagnostics
                .iter()
                .map(|d| format!("{:?}: {} [{}..{}]", d.severity, d.message, d.start, d.end))
                .collect(),
            changed: result.changed,
        }
    }
}
