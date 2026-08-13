//! The Layouts pre-pass.
//!
//! Runs before Solid's JSX transform, because that transform lowers JSX to
//! `template()` and `spread()` calls and the prop information this pass needs
//! is gone afterwards.
//!
//! The same transform core serves two hosts. The library host turns authored
//! Layout template syntax into valid package TSX; the application host later
//! matches those package call sites against application code before Solid's
//! JSX lowering.
//!
//! The library pass is load-bearing: its input is authoring syntax and its
//! output is the valid TSX that a Layout UI package carries forward.

pub mod compile_recipe;
pub mod linter;
pub mod match_layouts;

use layouts_common::{
    CompilerMode, Diagnostic, FileKind, Severity, TransformOptions, TransformResult,
};
use oxc_allocator::Allocator;
use oxc_ast::ast::{
    BindingPattern, Declaration, Expression, Program, Statement, TSType, TSTypeName,
    VariableDeclaration, VariableDeclarator,
};
use oxc_codegen::Codegen;
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::{GetSpan, SourceType, Span};

/// A layout the pass found: the binding it is assigned to, and the recipe its
/// type annotation names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FoundLayout {
    pub binding: String,
    /// The identifier inside `Layout<typeof HERE>`. Absent when the annotation
    /// is `Layout<...>` with something the pass does not recognise, which is
    /// reported rather than guessed at.
    pub recipe: Option<String>,
    pub span: Span,
    pub parameters: usize,
    pub parameters_span: Option<Span>,
    pub body_span: Option<Span>,
}

/// Runs the pass over one file.
pub fn transform(source: &str, options: &TransformOptions) -> TransformResult {
    let allocator = Allocator::default();
    let source_type =
        SourceType::from_path(&options.filename).unwrap_or_else(|_| SourceType::tsx());
    let parsed = Parser::new(&allocator, source, source_type).parse();

    let mut diagnostics: Vec<Diagnostic> = parsed
        .diagnostics
        .iter()
        .map(|error| Diagnostic::error(error.to_string(), Span::new(0, 0)))
        .collect();

    // A file that did not parse is returned exactly as it arrived. Emitting a
    // best-effort rewrite of a broken file turns one error into two.
    if parsed.panicked || !diagnostics.is_empty() {
        return TransformResult {
            code: source.to_owned(),
            diagnostics,
            changed: false,
        };
    }

    // Every component the user wrote must resolve to a Layout. An unmatched
    // one is a hard error rather than a fall-through, because emitting a
    // component whose presentation nobody declared is the outcome the design
    // exists to prevent.
    if options.mode == CompilerMode::Application {
        diagnostics.extend(match_layouts::check(&parsed.program, &options.config));
    }

    let layouts = find_layouts(&parsed.program);

    if options.file_kind() == FileKind::Layout && layouts.is_empty() {
        diagnostics.push(Diagnostic::warning(
            "no layout found: a .layout.tsx file should export at least one \
             binding annotated `Layout<typeof someRecipe>`",
            Span::new(0, 0),
        ));
    }

    for layout in &layouts {
        if layout.recipe.is_none() {
            diagnostics.push(Diagnostic::error(
                format!(
                    "`{}` is annotated `Layout<...>` but the parameter is not \
                     `typeof <recipe>`, so the pass cannot tell which recipe types it",
                    layout.binding
                ),
                layout.span,
            ));
        }
        if layout.parameters != 0 && layout.parameters != 2 {
            diagnostics.push(Diagnostic::error(
                format!(
                    "`{}` must use either the Layout template syntax `() =>` or the compiled `({{ slot, children }}, p) =>` signature",
                    layout.binding
                ),
                layout.span,
            ));
        }
    }

    if options.parse_only || diagnostics.iter().any(|d| d.severity == Severity::Error) {
        // A file with errors is returned as it arrived. Emitting a partial
        // rewrite of source the author has to fix anyway turns one problem
        // into two.
        return TransformResult {
            code: source.to_owned(),
            diagnostics,
            changed: false,
        };
    }

    let code = match options.mode {
        CompilerMode::Library => compile_library_source(source, &parsed.program, &layouts),
        CompilerMode::Application => compile_application_source(source, &parsed.program, options),
    };
    let changed = code != source;

    TransformResult {
        code,
        diagnostics,
        changed,
    }
}

/// Splices each recipe's precomputed lookup table into its declaration.
///
/// Text splicing rather than regenerating from the AST: the code generator
/// would reformat the whole file, which turns a one-line semantic change into
/// an unreviewable diff and breaks every fixture that asserts an untouched
/// file comes back byte-identical.
enum SourceEdit {
    Insert {
        at: usize,
        text: String,
    },
    Replace {
        start: usize,
        end: usize,
        text: String,
    },
}

impl SourceEdit {
    fn start(&self) -> usize {
        match self {
            Self::Insert { at, .. } => *at,
            Self::Replace { start, .. } => *start,
        }
    }
}

fn apply_edits(source: &str, mut edits: Vec<SourceEdit>) -> String {
    edits.sort_by_key(|edit| std::cmp::Reverse(edit.start()));

    let mut out = source.to_owned();
    for edit in edits {
        match edit {
            SourceEdit::Insert { at, text } if at <= out.len() => out.insert_str(at, &text),
            SourceEdit::Replace { start, end, text } if start <= end && end <= out.len() => {
                out.replace_range(start..end, &text);
            }
            _ => {}
        }
    }
    out
}

fn compile_application_source(
    source: &str,
    program: &Program<'_>,
    options: &TransformOptions,
) -> String {
    let mut edits = Vec::new();
    for statement in &program.body {
        let Statement::ImportDeclaration(import) = statement else {
            continue;
        };
        let Some(layout_source) = options
            .config
            .sources
            .iter()
            .find(|candidate| import.source.value == candidate.module)
        else {
            continue;
        };
        let Some(resolved) = &layout_source.resolved else {
            continue;
        };
        edits.push(SourceEdit::Replace {
            start: import.source.span.start as usize,
            end: import.source.span.end as usize,
            text: serde_json::to_string(resolved).expect("a resolved module path is serializable"),
        });
    }
    apply_edits(source, edits)
}

fn compile_library_source(source: &str, program: &Program<'_>, layouts: &[FoundLayout]) -> String {
    let recipes = compile_recipe::find_recipes(program);
    let index = compile_recipe::SlotIndex::build(&recipes);

    let mut edits: Vec<SourceEdit> = recipes
        .iter()
        .map(|recipe| {
            // Just inside the object's closing brace.
            let at = (recipe.argument_span.end as usize) - 1;

            // A trailing comma is idiomatic and extremely common, and blindly
            // prefixing another produces `,,` which does not parse. An empty
            // object needs no separator either. Found by feeding the emitted
            // file back to the parser rather than by reading the code.
            let previous = source[..at].trim_end().chars().last();
            let separator = match previous {
                Some(',') | Some('{') | None => "",
                _ => ",",
            };

            let addition = format!(
                "{separator}_layouts:{{slots:{},stateKeys:{},slotIds:{}}}",
                compile_recipe::table(recipe),
                compile_recipe::state_keys(recipe),
                compile_recipe::slot_ids(recipe, &index),
            );
            SourceEdit::Insert { at, text: addition }
        })
        .collect();

    let semantic = SemanticBuilder::new()
        .with_build_nodes(true)
        .build(program)
        .semantic;
    let unresolved = semantic.scoping().root_unresolved_references();

    for layout in layouts.iter().filter(|layout| layout.parameters == 0) {
        let Some(parameters_span) = layout.parameters_span else {
            continue;
        };
        let Some(body_span) = layout.body_span else {
            continue;
        };

        let uses_slots = unresolved.get("slot").is_some_and(|references| {
            references.iter().any(|reference_id| {
                let reference = semantic.scoping().get_reference(*reference_id);
                let span = semantic.reference_span(reference);
                reference.is_value() && span.start >= body_span.start && span.end <= body_span.end
            })
        });

        edits.push(SourceEdit::Replace {
            start: parameters_span.start as usize,
            end: parameters_span.end as usize,
            text: if uses_slots {
                "({ slot, children }, p)".to_owned()
            } else {
                "p".to_owned()
            },
        });

        for (name, references) in unresolved {
            for reference_id in references {
                let reference = semantic.scoping().get_reference(*reference_id);
                if reference.is_type() && !reference.is_value() {
                    continue;
                }
                let span = semantic.reference_span(reference);
                if span.start < body_span.start || span.end > body_span.end {
                    continue;
                }

                let replacement = match (uses_slots, name.as_str()) {
                    (_, "local" | "props" | "rawProps") => "p".to_owned(),
                    (false, _) => continue,
                    (true, "slot" | "children" | "p") => continue,
                    (true, name) if is_runtime_global(name) => continue,
                    (true, name) => format!("p.{name}"),
                };
                edits.push(SourceEdit::Replace {
                    start: span.start as usize,
                    end: span.end as usize,
                    text: replacement,
                });
            }
        }
    }

    apply_edits(source, edits)
}

fn is_runtime_global(name: &str) -> bool {
    matches!(
        name,
        "Array"
            | "Boolean"
            | "Date"
            | "Error"
            | "Infinity"
            | "JSON"
            | "Map"
            | "Math"
            | "NaN"
            | "Number"
            | "Object"
            | "Promise"
            | "Record"
            | "RegExp"
            | "Set"
            | "String"
            | "Symbol"
            | "URL"
            | "console"
            | "document"
            | "globalThis"
            | "undefined"
            | "window"
    )
}

/// Finds `const X: Layout<typeof recipe> = ...` declarations.
///
/// Top level only, and deliberately: a layout is a module's export, and
/// recursing into every nested scope to find one would accept code that the
/// generated wiring could never import anyway.
pub fn find_layouts(program: &Program<'_>) -> Vec<FoundLayout> {
    let mut found = Vec::new();

    for statement in &program.body {
        let Some(declaration) = variable_declaration(statement) else {
            continue;
        };

        for declarator in &declaration.declarations {
            if let Some(layout) = as_layout(declarator) {
                found.push(layout);
            }
        }
    }

    found
}

/// The declaration behind a statement, whether or not it is exported.
///
/// oxc gives `export const x = 1` its own `Statement::ExportDeclaration`
/// wrapping the declaration, while `ExportNamedDeclaration` covers only the
/// `export { x }` form and carries no declaration at all. Matching just
/// `Statement::VariableDeclaration` therefore misses every exported layout,
/// which is all of them in practice.
fn variable_declaration<'a, 'b>(
    statement: &'b Statement<'a>,
) -> Option<&'b VariableDeclaration<'a>> {
    match statement {
        Statement::VariableDeclaration(declaration) => Some(declaration),
        Statement::ExportDeclaration(export) => match &export.declaration {
            Declaration::VariableDeclaration(declaration) => Some(declaration),
            _ => None,
        },
        _ => None,
    }
}

fn as_layout(declarator: &VariableDeclarator<'_>) -> Option<FoundLayout> {
    let BindingPattern::BindingIdentifier(binding) = &declarator.id else {
        return None;
    };
    let annotation = declarator.type_annotation.as_ref()?;

    let TSType::TSTypeReference(reference) = &annotation.type_annotation else {
        return None;
    };
    if type_name(&reference.type_name)? != "Layout" {
        return None;
    }

    // `Layout` with no parameter is still a layout, just an unusable one. It is
    // reported by the caller rather than skipped here, so the author gets told
    // why nothing happened.
    let recipe = reference
        .type_arguments
        .as_ref()
        .and_then(|arguments| arguments.params.first())
        .and_then(|first| match first {
            TSType::TSTypeQuery(query) => match &query.expr_name {
                oxc_ast::ast::TSTypeQueryExprName::IdentifierReference(identifier) => {
                    Some(identifier.name.to_string())
                }
                _ => None,
            },
            _ => None,
        });

    let (parameters, parameters_span, body_span) = match declarator.init.as_ref() {
        Some(Expression::ArrowFunctionExpression(arrow)) => (
            arrow.params.items.len() + usize::from(arrow.params.rest.is_some()),
            Some(arrow.params.span),
            Some(arrow.body.span()),
        ),
        _ => (usize::MAX, None, None),
    };

    Some(FoundLayout {
        binding: binding.name.to_string(),
        recipe,
        span: declarator.span,
        parameters,
        parameters_span,
        body_span,
    })
}

fn type_name(name: &TSTypeName<'_>) -> Option<String> {
    match name {
        TSTypeName::IdentifierReference(identifier) => Some(identifier.name.to_string()),
        _ => None,
    }
}

/// Parses and regenerates without transforming. Proves the pipeline end to end
/// before any rewriting is trusted to it.
pub fn print(source: &str, filename: &str) -> String {
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(filename).unwrap_or_else(|_| SourceType::tsx());
    let parsed = Parser::new(&allocator, source, source_type).parse();
    Codegen::new().build(&parsed.program).code
}

#[cfg(test)]
mod tests {
    use super::*;

    const LAYOUT: &str = r#"
import type { Layout } from "solid-layouts";
import { accordionTrigger } from "./Accordion.recipe";

export const AccordionTriggerLayout: Layout<typeof accordionTrigger> =
  ({ slot, children }, p) => (
    <button {...slot.root} type="button">
      {children}
    </button>
  );
"#;

    fn parse(source: &str) -> Vec<FoundLayout> {
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, source, SourceType::tsx()).parse();
        assert!(
            parsed.diagnostics.is_empty(),
            "fixture must parse: {:?}",
            parsed.diagnostics
        );
        find_layouts(&parsed.program)
    }

    #[test]
    fn finds_an_exported_layout_and_its_recipe() {
        let found = parse(LAYOUT);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].binding, "AccordionTriggerLayout");
        assert_eq!(found[0].recipe.as_deref(), Some("accordionTrigger"));
    }

    #[test]
    fn ignores_declarations_that_are_not_layouts() {
        let found = parse(
            r#"
            export const Badge = defineComponent({ recipe: badge });
            const helper: string = "not a layout";
            "#,
        );
        assert!(found.is_empty());
    }

    #[test]
    fn reports_a_layout_whose_recipe_cannot_be_resolved() {
        let found = parse("export const Broken: Layout<SomeType> = (s, p) => null;");
        assert_eq!(found.len(), 1);
        assert_eq!(
            found[0].recipe, None,
            "an unresolvable recipe must not be guessed at"
        );
    }

    #[test]
    fn a_file_that_does_not_parse_is_returned_untouched() {
        let broken = "export const = ;";
        let result = transform(
            broken,
            &TransformOptions::new("Broken.layout.tsx", CompilerMode::Library),
        );
        assert_eq!(result.code, broken);
        assert!(!result.changed);
        assert!(!result.diagnostics.is_empty());
    }

    #[test]
    fn a_layout_file_with_no_layout_is_a_warning() {
        let result = transform(
            "export const x = 1;",
            &TransformOptions::new("Empty.layout.tsx", CompilerMode::Library),
        );
        assert_eq!(result.diagnostics.len(), 1);
    }

    #[test]
    fn an_ordinary_file_with_no_layout_is_silent() {
        let result = transform(
            "export const x = 1;",
            &TransformOptions::new("plain.ts", CompilerMode::Library),
        );
        assert!(result.diagnostics.is_empty());
        assert!(!result.changed);
    }

    #[test]
    fn compiles_template_parameters_and_unbound_model_references() {
        let source = r#"import type { Layout } from "solid-layouts";
import { icon } from "./Icon.recipe";
const Icon: Layout<typeof icon, IconProps> = () => {
  const width = local.width ?? 24;
  return <span {...slot.root} style={style}>{children}{props.name}</span>;
};
"#;
        let result = transform(
            source,
            &TransformOptions::new("Icon.layout.tsx", CompilerMode::Library),
        );
        assert!(result.diagnostics.is_empty(), "{:?}", result.diagnostics);
        assert!(
            result.code.contains("({ slot, children }, p) =>"),
            "{}",
            result.code
        );
        assert!(result.code.contains("p.width"), "{}", result.code);
        assert!(result.code.contains("style={p.style}"), "{}", result.code);
        assert!(result.code.contains("{p.name}"), "{}", result.code);
        assert!(!result.code.contains("local.width"), "{}", result.code);

        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, &result.code, SourceType::tsx()).parse();
        assert!(
            parsed.diagnostics.is_empty(),
            "compiled Layout must be valid TSX: {:?}\n{}",
            parsed.diagnostics,
            result.code
        );
    }

    #[test]
    fn compiles_a_legacy_component_layout_with_one_props_parameter() {
        let source = r#"import type { Layout } from "solid-layouts";
import { button } from "./Button.recipe";
const Button: Layout<typeof button, ButtonProps> = () => {
  const disabled = Boolean(props.disabled);
  return <button disabled={disabled}>{props.children}</button>;
};
"#;
        let result = transform(
            source,
            &TransformOptions::new("Button.layout.tsx", CompilerMode::Library),
        );
        assert!(result.diagnostics.is_empty(), "{:?}", result.diagnostics);
        assert!(result.code.contains("= p =>"), "{}", result.code);
        assert!(
            result.code.contains("Boolean(p.disabled)"),
            "{}",
            result.code
        );
        assert!(result.code.contains("{p.children}"), "{}", result.code);
        assert!(
            !result.code.contains("{ slot, children }"),
            "{}",
            result.code
        );
    }

    #[test]
    fn application_mode_rewrites_a_validated_package_import_to_c() {
        let source = r#"import { Icon as StatusIcon } from "@pathscale/test-ui";
export const View = () => <StatusIcon />;
"#;
        let mut options = TransformOptions::new("View.tsx", CompilerMode::Application);
        options.config.sources.push(layouts_common::LayoutSource {
            module: "@pathscale/test-ui".to_owned(),
            exports: vec!["Icon".to_owned()],
            resolved: Some("/packages/test-ui/index.ts".to_owned()),
        });

        let result = transform(source, &options);
        assert!(result.diagnostics.is_empty(), "{:?}", result.diagnostics);
        assert!(result.changed);
        assert!(
            result.code.contains("from \"/packages/test-ui/index.ts\""),
            "{}",
            result.code
        );
        assert!(result.code.contains("<StatusIcon />"), "{}", result.code);
    }

    #[test]
    fn application_mode_leaves_unconfigured_imports_untouched() {
        let source = r#"import { Widget } from "some-other-library";
export const View = () => <Widget />;
"#;
        let options = TransformOptions::new("View.tsx", CompilerMode::Application);
        let result = transform(source, &options);
        assert!(result.diagnostics.is_empty(), "{:?}", result.diagnostics);
        assert!(!result.changed);
        assert_eq!(result.code, source);
    }
}
