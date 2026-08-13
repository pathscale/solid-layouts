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
    /// Anything else. Parsed for component references and otherwise left alone.
    #[default]
    Other,
}

/// Which half of the two-stage pipeline is invoking the shared transform.
///
/// A host must select this explicitly. Inferring it from a filename or from
/// the presence of a manifest is ambiguous in a monorepo that builds both a
/// component library and an application.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CompilerMode {
    Library,
    Application,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LibraryOutput {
    /// A two-parameter Layout consumed by a compiler-generated package entry.
    #[default]
    Layout,
    /// A Solid component wrapper adjacent to a migrated source module.
    Component,
}

/// One resolved Layout package available to an application build.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutSource {
    /// The module specifier as application code imports it.
    pub module: String,
    /// Public component exports proven by that package's Layout manifest.
    pub exports: Vec<String>,
    /// Absolute public entry resolved and validated by the application host.
    /// Application mode rewrites the package import to this file before the
    /// normal bundler resolver runs.
    #[serde(default)]
    pub resolved: Option<String>,
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

/// Where Layouts are read from.
///
/// Configuration with a default, never hardcoded. The audience is people
/// building their own component libraries, and a compiler that understands one
/// library is useless to them. Entries are resolved through the import graph:
/// `import { Button } from "@pathscale/ui"` looks Button up in that package's
/// set, `from "./ui"` looks in the local one.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutsConfig {
    pub sources: Vec<LayoutSource>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformOptions {
    pub filename: String,
    pub mode: CompilerMode,
    #[serde(default)]
    pub library_output: LibraryOutput,
    #[serde(default)]
    pub config: LayoutsConfig,
    /// Off by default. With it set the pass parses and returns the source
    /// unchanged, which is how a host proves the pipeline is wired before any
    /// rewriting is trusted.
    #[serde(default)]
    pub parse_only: bool,
}

impl TransformOptions {
    pub fn new(filename: impl Into<String>, mode: CompilerMode) -> Self {
        Self {
            filename: filename.into(),
            mode,
            library_output: LibraryOutput::default(),
            config: LayoutsConfig::default(),
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

/// A 1-based position in the source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Position {
    pub line: u32,
    pub column: u32,
}

/// Converts byte offsets into line and column.
///
/// Built once per file and reused. Doing it per diagnostic would rescan the
/// source for each one, which is quadratic on a file that produces many.
pub struct LineIndex {
    /// Byte offset of the first character of each line.
    starts: Vec<u32>,
}

impl LineIndex {
    pub fn new(source: &str) -> Self {
        let mut starts = vec![0u32];
        for (offset, byte) in source.bytes().enumerate() {
            if byte == b'\n' {
                starts.push(offset as u32 + 1);
            }
        }
        Self { starts }
    }

    /// Column counts UTF-8 *characters*, not bytes, so a line containing an
    /// emoji or an accent does not report a column past where the caret
    /// visibly sits.
    pub fn position(&self, source: &str, offset: u32) -> Position {
        let line = match self.starts.binary_search(&offset) {
            Ok(index) => index,
            Err(index) => index - 1,
        };
        let start = self.starts[line] as usize;
        let end = (offset as usize).min(source.len());
        let column = source
            .get(start..end)
            .map(|text| text.chars().count())
            .unwrap_or(0);

        Position {
            line: line as u32 + 1,
            column: column as u32 + 1,
        }
    }
}

/// A problem found in the source, carrying enough to point at it.
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

    /// `path/to/file.tsx:12:5: message`, the form an editor can jump from.
    pub fn render(&self, filename: &str, source: &str, index: &LineIndex) -> String {
        let at = index.position(source, self.start);
        let label = match self.severity {
            Severity::Error => "error",
            Severity::Warning => "warning",
        };
        format!(
            "{filename}:{}:{}: {label}: {}",
            at.line, at.column, self.message
        )
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

impl TransformResult {
    pub fn has_errors(&self) -> bool {
        self.diagnostics
            .iter()
            .any(|d| d.severity == Severity::Error)
    }
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

    #[test]
    fn layout_sources_are_explicit_and_not_hardcoded() {
        assert!(LayoutsConfig::default().sources.is_empty());
        let mine = LayoutsConfig {
            sources: vec![LayoutSource {
                module: "my-design-system".to_owned(),
                exports: vec!["Button".to_owned()],
                resolved: Some("/packages/my-design-system/index.ts".to_owned()),
            }],
        };
        assert_eq!(mine.sources.len(), 1);
        assert_eq!(mine.sources[0].exports, vec!["Button"]);
    }

    #[test]
    fn positions_are_one_based() {
        let source = "first\nsecond\nthird";
        let index = LineIndex::new(source);

        assert_eq!(index.position(source, 0), Position { line: 1, column: 1 });
        // 'second' starts at byte 6
        assert_eq!(index.position(source, 6), Position { line: 2, column: 1 });
        assert_eq!(index.position(source, 8), Position { line: 2, column: 3 });
    }

    #[test]
    fn a_column_counts_characters_rather_than_bytes() {
        // Four bytes, one character. A byte count would report column 5.
        let source = "let x = \"🦀\";";
        let index = LineIndex::new(source);
        let offset = source.find(';').unwrap() as u32;
        assert_eq!(index.position(source, offset).column, 12);
    }

    #[test]
    fn a_rendered_diagnostic_is_jumpable() {
        let source = "one\ntwo\nthree";
        let index = LineIndex::new(source);
        let d = Diagnostic::error("no Layout named `Button`", Span::new(4, 7));

        assert_eq!(
            d.render("src/App.tsx", source, &index),
            "src/App.tsx:2:1: error: no Layout named `Button`"
        );
    }
}
