//! Options and diagnostics shared by the transform and its hosts.
//!
//! Deliberately free of `oxc_ast`: a host binding, a test harness or the
//! frozen Babel adapter's fixture runner can depend on these types without
//! pulling in a parser.

use oxc_span::Span;
use serde::{Deserialize, Serialize};

/// How a file should be treated. The pass only rewrites layout files; every
/// other file is parsed, found uninteresting, and returned untouched.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileKind {
    /// `*.layout.tsx`. Bare identifiers resolve against the layout's model.
    Layout,
    /// Anything else. Parsed for `configureUI` calls and otherwise left alone.
    #[default]
    Other,
}

impl FileKind {
    /// Classifies by filename rather than by content.
    ///
    /// Content sniffing would be more permissive and much worse: a file's
    /// meaning would depend on whether a heuristic fired, and adding an import
    /// could silently change how the file is compiled. The suffix is a
    /// declaration by the author.
    pub fn from_filename(filename: &str) -> Self {
        if filename.ends_with(".layout.tsx") || filename.ends_with(".layout.jsx") {
            Self::Layout
        } else {
            Self::Other
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformOptions {
    pub filename: String,
    /// Off by default. With it set the pass parses and returns the source
    /// unchanged, which is how a host proves the pipeline is wired before any
    /// rewriting is trusted.
    #[serde(default)]
    pub parse_only: bool,
}

impl TransformOptions {
    pub fn new(filename: impl Into<String>) -> Self {
        Self {
            filename: filename.into(),
            parse_only: false,
        }
    }

    pub fn file_kind(&self) -> FileKind {
        FileKind::from_filename(&self.filename)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Severity {
    Error,
    Warning,
}

/// A problem found in the source, carrying enough to point at it.
///
/// Byte offsets rather than line and column: the host renders them, and doing
/// the conversion here would mean carrying the source text around to produce a
/// message nobody may ever display.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub severity: Severity,
    pub message: String,
    pub start: u32,
    pub end: u32,
}

impl Diagnostic {
    pub fn error(message: impl Into<String>, span: Span) -> Self {
        Self {
            severity: Severity::Error,
            message: message.into(),
            start: span.start,
            end: span.end,
        }
    }

    pub fn warning(message: impl Into<String>, span: Span) -> Self {
        Self {
            severity: Severity::Warning,
            message: message.into(),
            start: span.start,
            end: span.end,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformResult {
    pub code: String,
    pub diagnostics: Vec<Diagnostic>,
    /// False when the pass found nothing to do. A host can skip writing the
    /// file, and a test can assert that an unrelated file was left alone
    /// rather than round-tripped through the code generator.
    pub changed: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_files_are_recognised_by_suffix() {
        assert_eq!(
            FileKind::from_filename("Accordion.layout.tsx"),
            FileKind::Layout
        );
        assert_eq!(
            FileKind::from_filename("src/ui/Accordion.layout.jsx"),
            FileKind::Layout
        );
    }

    #[test]
    fn everything_else_is_left_alone() {
        for name in [
            "Accordion.tsx",
            "accordion.ts",
            "Accordion.recipe.ts",
            "layout.tsx",
            "my.layout.tsx.bak",
        ] {
            assert_eq!(
                FileKind::from_filename(name),
                FileKind::Other,
                "{name} must not be treated as a layout"
            );
        }
    }
}
