//! The Layouts pre-pass.
//!
//! Runs before Solid's JSX transform, because that transform lowers JSX to
//! `template()` and `spread()` calls and the prop information this pass needs
//! is gone afterwards.
//!
//! What it will eventually do, in the order the phases land:
//!
//! 1. fold statically known `configureUI` defaults into call sites
//! 2. erase the generated `defineComponent` wiring and inline the layout call
//! 3. resolve bare identifiers in a layout against its model
//! 4. place `@once` where a prop is provably read once
//!
//! Deleting this pass must always leave working code. If removing it changes
//! behaviour rather than size, the design is wrong and the phase does not ship.

use layouts_common::{Diagnostic, FileKind, TransformOptions, TransformResult};
use oxc_allocator::Allocator;
use oxc_ast::ast::{
    BindingPattern, Declaration, Program, Statement, TSType, TSTypeName, VariableDeclaration,
    VariableDeclarator,
};
use oxc_codegen::Codegen;
use oxc_parser::Parser;
use oxc_span::{SourceType, Span};

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
    }

    // Nothing is rewritten yet. Round-tripping through the code generator would
    // reformat every file for no benefit, so `parse_only` and the not-yet-
    // implemented phases both return the original text untouched.
    TransformResult {
        code: source.to_owned(),
        diagnostics,
        changed: false,
    }
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

    Some(FoundLayout {
        binding: binding.name.to_string(),
        recipe,
        span: declarator.span,
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
        let result = transform(broken, &TransformOptions::new("Broken.layout.tsx"));
        assert_eq!(result.code, broken);
        assert!(!result.changed);
        assert!(!result.diagnostics.is_empty());
    }

    #[test]
    fn a_layout_file_with_no_layout_is_a_warning() {
        let result = transform(
            "export const x = 1;",
            &TransformOptions::new("Empty.layout.tsx"),
        );
        assert_eq!(result.diagnostics.len(), 1);
    }

    #[test]
    fn an_ordinary_file_with_no_layout_is_silent() {
        let result = transform("export const x = 1;", &TransformOptions::new("plain.ts"));
        assert!(result.diagnostics.is_empty());
        assert!(!result.changed);
    }
}
