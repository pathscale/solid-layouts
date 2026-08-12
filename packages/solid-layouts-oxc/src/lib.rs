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

    /// One problem, positioned well enough for a bundler to print it.
    ///
    /// Line and column rather than byte offsets: a loader reports to a human,
    /// and every host expects `file:line:column`. Resolving it here means the
    /// JS side never has to hold the source to work out where an offset fell.
    #[napi(object)]
    pub struct JsDiagnostic {
        pub severity: String,
        pub message: String,
        pub line: u32,
        pub column: u32,
    }

    /// Mirrors [`layouts_common::TransformResult`] across the boundary.
    ///
    /// A separate type rather than a serde derive on the original: napi wants
    /// its own representation, and coupling the internal type to the wire
    /// format would mean a refactor of one is a breaking change to the other.
    #[napi(object)]
    pub struct JsTransformResult {
        pub code: String,
        pub diagnostics: Vec<JsDiagnostic>,
        pub changed: bool,
        /// True when any diagnostic is an error, so a loader can fail the
        /// build without re-inspecting the list.
        pub failed: bool,
    }

    /// What a host can configure.
    ///
    /// `layouts` names the modules a component may be imported from. It
    /// defaults to `["@pathscale/ui"]`, which is right for an app installing
    /// the library and wrong for a repository that vendors it: a relative or
    /// aliased import is treated as the user's own code and allowed through
    /// unchecked, so a bundled UI silently gets no checking at all. Such a
    /// repository sets this to the path it keeps the library under.
    #[napi(object)]
    pub struct JsOptions {
        pub layouts: Option<Vec<String>>,
        pub parse_only: Option<bool>,
    }

    #[napi]
    pub fn transform(
        source: String,
        filename: String,
        options: Option<JsOptions>,
    ) -> JsTransformResult {
        let mut options_inner = layouts_common::TransformOptions::new(filename);
        if let Some(given) = options {
            if let Some(layouts) = given.layouts {
                options_inner.config.layouts = layouts;
            }
            if let Some(parse_only) = given.parse_only {
                options_inner.parse_only = parse_only;
            }
        }
        let options = options_inner;
        let result = layouts_transform::transform(&source, &options);
        let lines = layouts_common::LineIndex::new(&source);

        let diagnostics: Vec<JsDiagnostic> = result
            .diagnostics
            .iter()
            .map(|d| {
                let at = lines.position(&source, d.start);
                JsDiagnostic {
                    severity: format!("{:?}", d.severity).to_lowercase(),
                    message: d.message.clone(),
                    line: at.line,
                    column: at.column,
                }
            })
            .collect();

        JsTransformResult {
            code: result.code,
            failed: diagnostics.iter().any(|d| d.severity == "error"),
            diagnostics,
            changed: result.changed,
        }
    }
}
