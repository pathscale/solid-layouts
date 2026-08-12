//! The host binding.
//!
//! Everything here is behind the `napi` feature. The transform itself lives in
//! `layouts-transform` and has no idea a JS runtime exists, which is what lets
//! `cargo test` run the whole pass with no Node, no Bun and no bundler.

pub use layouts_common::{
    CompilerMode, Diagnostic, FileKind, LayoutSource, Severity, TransformOptions, TransformResult,
};
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
    /// Mode is mandatory. Application hosts additionally provide the exact
    /// package/export index they resolved from Layout manifests.
    #[napi(object)]
    pub struct JsOptions {
        pub mode: String,
        pub layout_sources: Option<Vec<JsLayoutSource>>,
        pub parse_only: Option<bool>,
    }

    #[napi(object)]
    pub struct JsLayoutSource {
        pub module: String,
        pub exports: Vec<String>,
    }

    #[napi]
    pub fn transform(
        source: String,
        filename: String,
        options: Option<JsOptions>,
    ) -> JsTransformResult {
        let given = options.expect("solid-layouts-oxc requires an explicit compiler mode");
        let mode = match given.mode.as_str() {
            "library" => layouts_common::CompilerMode::Library,
            "application" => layouts_common::CompilerMode::Application,
            other => panic!("unknown solid-layouts compiler mode: {other}"),
        };
        let mut options_inner = layouts_common::TransformOptions::new(filename, mode);
        if let Some(layout_sources) = given.layout_sources {
            options_inner.config.sources = layout_sources
                .into_iter()
                .map(|source| layouts_common::LayoutSource {
                    module: source.module,
                    exports: source.exports,
                })
                .collect();
        }
        options_inner.parse_only = given.parse_only.unwrap_or(false);
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
