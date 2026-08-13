use std::collections::{HashMap, HashSet};
use std::fs::canonicalize;
use std::path::{Path, PathBuf};

use layouts_common::Diagnostic;
use oxc_allocator::Allocator;
use oxc_ast::ast::{
    BindingPattern, Declaration, Expression, ImportDeclarationSpecifier, JSXAttribute,
    JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXElementName,
    JSXMemberExpressionObject, JSXOpeningElement, MemberExpression, Program, Statement,
    VariableDeclaration,
};
use oxc_ast_visit::Visit;
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType, Span};

use crate::compile_recipe::{self, Recipe, VariantClasses};
use crate::find_layouts;

pub struct ProjectFile {
    pub filename: String,
    pub source: String,
}

pub struct ProjectDiagnostic {
    pub filename: String,
    pub source: String,
    pub rule: &'static str,
    pub diagnostic: Diagnostic,
}

pub struct ApplicationSource {
    pub module: String,
    pub exports: HashSet<String>,
}

struct NamedRecipe {
    name: String,
    recipe: Recipe,
    span: Span,
}

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

fn named_recipes(program: &Program<'_>) -> (Vec<NamedRecipe>, Vec<Diagnostic>) {
    let mut recipes = Vec::new();
    let mut diagnostics = Vec::new();
    for statement in &program.body {
        let Some(declaration) = variable_declaration(statement) else {
            continue;
        };
        for declarator in &declaration.declarations {
            let BindingPattern::BindingIdentifier(binding) = &declarator.id else {
                continue;
            };
            let Some(Expression::CallExpression(call)) = declarator.init.as_ref() else {
                continue;
            };
            let Expression::Identifier(callee) = &call.callee else {
                continue;
            };
            if callee.name != "recipe" {
                continue;
            }
            match compile_recipe::read(call) {
                Some(recipe) => recipes.push(NamedRecipe {
                    name: binding.name.to_string(),
                    recipe,
                    span: declarator.span,
                }),
                None => diagnostics.push(Diagnostic::error(
                    format!(
                        "recipe `{}` must use a statically analyzable object literal",
                        binding.name
                    ),
                    declarator.span,
                )),
            }
        }
    }
    (recipes, diagnostics)
}

fn lint_recipe(named: &NamedRecipe) -> Vec<(&'static str, Diagnostic)> {
    let recipe = &named.recipe;
    let mut diagnostics = Vec::new();
    let mut slots = HashSet::new();
    for (slot, _) in &recipe.slots {
        if !slots.insert(slot.as_str()) {
            diagnostics.push((
                "slot-duplicate",
                Diagnostic::error(
                    format!(
                        "recipe `{}` declares slot `{slot}` more than once",
                        named.name
                    ),
                    named.span,
                ),
            ));
        }
    }
    if !slots.contains("root") {
        diagnostics.push((
            "slot-root",
            Diagnostic::error(
                format!("recipe `{}` must declare a `root` slot", named.name),
                named.span,
            ),
        ));
    }

    let props: HashSet<_> = recipe.props.iter().map(|axis| axis.name.as_str()).collect();
    for axis in &recipe.state {
        if props.contains(axis.name.as_str()) {
            diagnostics.push((
                "axis-separation",
                Diagnostic::error(
                    format!(
                        "recipe `{}` declares `{}` as both presentation and state",
                        named.name, axis.name
                    ),
                    named.span,
                ),
            ));
        }
    }

    for axis in recipe.props.iter().chain(&recipe.state) {
        for (_, classes) in &axis.values {
            let VariantClasses::PerSlot(targets) = classes else {
                continue;
            };
            for (slot, _) in targets {
                if !slots.contains(slot.as_str()) {
                    diagnostics.push((
                        "slot-target",
                        Diagnostic::error(
                            format!(
                                "recipe `{}` axis `{}` targets undeclared slot `{slot}`",
                                named.name, axis.name
                            ),
                            named.span,
                        ),
                    ));
                }
            }
        }
    }
    diagnostics
}

#[derive(Default)]
struct Usage {
    slots: Vec<RenderedSlot>,
    computed_slots: Vec<Span>,
    manual_classes: Vec<Span>,
}

struct RenderedSlot {
    name: String,
    span: Span,
    slot_api: bool,
}

impl<'a> Visit<'a> for Usage {
    fn visit_member_expression(&mut self, member: &MemberExpression<'a>) {
        if let Expression::Identifier(object) = member.object()
            && object.name == "slot"
        {
            match member.static_property_info() {
                Some((span, name)) => self.slots.push(RenderedSlot {
                    name: name.to_string(),
                    span,
                    slot_api: true,
                }),
                None => self.computed_slots.push(member.span()),
            }
        }
        oxc_ast_visit::walk::walk_member_expression(self, member);
    }

    fn visit_jsx_attribute(&mut self, attribute: &JSXAttribute<'a>) {
        let JSXAttributeName::Identifier(name) = &attribute.name else {
            oxc_ast_visit::walk::walk_jsx_attribute(self, attribute);
            return;
        };
        if name.name == "data-slot" {
            if let Some(JSXAttributeValue::StringLiteral(value)) = &attribute.value {
                self.slots.push(RenderedSlot {
                    name: value.value.to_string(),
                    span: value.span,
                    slot_api: false,
                });
            } else {
                self.computed_slots.push(attribute.span);
            }
        }
        if name.name == "class" || name.name == "className" {
            self.manual_classes.push(attribute.span);
        }
        oxc_ast_visit::walk::walk_jsx_attribute(self, attribute);
    }

    fn visit_call_expression(&mut self, call: &oxc_ast::ast::CallExpression<'a>) {
        if let Expression::Identifier(callee) = &call.callee
            && (callee.name == "twMerge" || callee.name == "clsx")
        {
            self.manual_classes.push(call.span);
        }
        oxc_ast_visit::walk::walk_call_expression(self, call);
    }
}

fn imports(program: &Program<'_>) -> HashMap<String, (String, String)> {
    let mut imports = HashMap::new();
    for statement in &program.body {
        let Statement::ImportDeclaration(import) = statement else {
            continue;
        };
        for specifier in import.specifiers.iter().flatten() {
            let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier else {
                continue;
            };
            imports.insert(
                specifier.local.name.to_string(),
                (
                    import.source.value.to_string(),
                    specifier.imported.name().to_string(),
                ),
            );
        }
    }
    imports
}

fn canonical(path: &Path) -> String {
    canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .into_owned()
}

fn resolve_import(filename: &str, specifier: &str, files: &HashSet<String>) -> Option<String> {
    if !specifier.starts_with('.') {
        return None;
    }
    let base = Path::new(filename).parent()?.join(specifier);
    let candidates = [
        base.clone(),
        PathBuf::from(format!("{}.ts", base.display())),
        PathBuf::from(format!("{}.tsx", base.display())),
        PathBuf::from(format!("{}.js", base.display())),
        PathBuf::from(format!("{}.jsx", base.display())),
    ];
    candidates
        .iter()
        .map(|candidate| canonical(candidate))
        .find(|candidate| files.contains(candidate))
}

pub fn lint_project(files: &[ProjectFile]) -> Vec<ProjectDiagnostic> {
    let filenames: HashSet<_> = files
        .iter()
        .map(|file| canonical(Path::new(&file.filename)))
        .collect();
    let mut recipes: HashMap<(String, String), Recipe> = HashMap::new();
    let mut diagnostics = Vec::new();

    for file in files {
        let allocator = Allocator::default();
        let source_type =
            SourceType::from_path(&file.filename).unwrap_or_else(|_| SourceType::tsx());
        let parsed = Parser::new(&allocator, &file.source, source_type).parse();
        if parsed.panicked || !parsed.diagnostics.is_empty() {
            diagnostics.extend(parsed.diagnostics.iter().map(|error| ProjectDiagnostic {
                filename: file.filename.clone(),
                source: file.source.clone(),
                rule: "syntax",
                diagnostic: Diagnostic::error(error.to_string(), Span::new(0, 0)),
            }));
            continue;
        }
        let (found, recipe_diagnostics) = named_recipes(&parsed.program);
        diagnostics.extend(
            recipe_diagnostics
                .into_iter()
                .map(|diagnostic| ProjectDiagnostic {
                    filename: file.filename.clone(),
                    source: file.source.clone(),
                    rule: "recipe-static",
                    diagnostic,
                }),
        );
        for named in found {
            diagnostics.extend(lint_recipe(&named).into_iter().map(|(rule, diagnostic)| {
                ProjectDiagnostic {
                    filename: file.filename.clone(),
                    source: file.source.clone(),
                    rule,
                    diagnostic,
                }
            }));
            recipes.insert(
                (canonical(Path::new(&file.filename)), named.name),
                named.recipe,
            );
        }
    }

    for file in files.iter().filter(|file| {
        file.filename.ends_with(".layout.tsx") || file.filename.ends_with(".layout.jsx")
    }) {
        let allocator = Allocator::default();
        let source_type =
            SourceType::from_path(&file.filename).unwrap_or_else(|_| SourceType::tsx());
        let parsed = Parser::new(&allocator, &file.source, source_type).parse();
        if parsed.panicked || !parsed.diagnostics.is_empty() {
            continue;
        }
        let layouts = find_layouts(&parsed.program);
        let imports = imports(&parsed.program);
        let mut usage = Usage::default();
        usage.visit_program(&parsed.program);

        for layout in layouts {
            let Some(recipe_name) = layout.recipe.as_ref() else {
                continue;
            };
            let Some((module, export_name)) = imports.get(recipe_name) else {
                diagnostics.push(ProjectDiagnostic {
                    filename: file.filename.clone(),
                    source: file.source.clone(),
                    rule: "recipe-import",
                    diagnostic: Diagnostic::error(
                        format!("recipe `{recipe_name}` is not imported"),
                        layout.span,
                    ),
                });
                continue;
            };
            let Some(recipe_file) = resolve_import(&file.filename, module, &filenames) else {
                diagnostics.push(ProjectDiagnostic {
                    filename: file.filename.clone(),
                    source: file.source.clone(),
                    rule: "recipe-source",
                    diagnostic: Diagnostic::error(
                        format!("recipe source `{module}` cannot be resolved"),
                        layout.span,
                    ),
                });
                continue;
            };
            let Some(recipe) = recipes.get(&(recipe_file, export_name.clone())) else {
                diagnostics.push(ProjectDiagnostic {
                    filename: file.filename.clone(),
                    source: file.source.clone(),
                    rule: "recipe-export",
                    diagnostic: Diagnostic::error(
                        format!("`{module}` does not export a static recipe named `{export_name}`"),
                        layout.span,
                    ),
                });
                continue;
            };
            let body = layout.body_span.unwrap_or(layout.span);
            let rendered: Vec<_> = usage
                .slots
                .iter()
                .filter(|slot| slot.span.start >= body.start && slot.span.end <= body.end)
                .collect();
            let rendered_names: HashSet<_> =
                rendered.iter().map(|slot| slot.name.as_str()).collect();
            let declared_names: HashSet<_> =
                recipe.slots.iter().map(|(name, _)| name.as_str()).collect();

            for span in usage
                .computed_slots
                .iter()
                .filter(|span| span.start >= body.start && span.end <= body.end)
            {
                diagnostics.push(ProjectDiagnostic {
                    filename: file.filename.clone(),
                    source: file.source.clone(),
                    rule: "slot-computed",
                    diagnostic: Diagnostic::error(
                        "computed slot access cannot be validated statically",
                        *span,
                    ),
                });
            }
            for slot in &rendered {
                if !declared_names.contains(slot.name.as_str()) {
                    diagnostics.push(ProjectDiagnostic {
                        filename: file.filename.clone(),
                        source: file.source.clone(),
                        rule: "slot-undeclared",
                        diagnostic: Diagnostic::error(
                            format!(
                                "rendered slot `{}` is not declared by `{recipe_name}`",
                                slot.name
                            ),
                            slot.span,
                        ),
                    });
                }
            }
            for (slot, _) in &recipe.slots {
                if !rendered_names.contains(slot.as_str()) {
                    diagnostics.push(ProjectDiagnostic {
                        filename: file.filename.clone(),
                        source: file.source.clone(),
                        rule: "slot-unused",
                        diagnostic: Diagnostic::error(
                            format!("declared slot `{slot}` is not rendered by `{recipe_name}`"),
                            layout.span,
                        ),
                    });
                }
            }
            let uses_slot_api = rendered.iter().any(|slot| slot.slot_api);
            if !uses_slot_api {
                diagnostics.push(ProjectDiagnostic {
                    filename: file.filename.clone(),
                    source: file.source.clone(),
                    rule: "legacy-template",
                    diagnostic: Diagnostic::warning(
                        "legacy component-shaped Layout keeps presentation in component code",
                        layout.span,
                    ),
                });
            }
            if let Some(span) = usage
                .manual_classes
                .iter()
                .find(|span| span.start >= body.start && span.end <= body.end)
            {
                diagnostics.push(ProjectDiagnostic {
                    filename: file.filename.clone(),
                    source: file.source.clone(),
                    rule: "manual-classes",
                    diagnostic: Diagnostic::warning(
                        "manual class composition belongs in the recipe",
                        *span,
                    ),
                });
            }
        }
    }

    diagnostics
}

fn jsx_root<'a>(name: &'a JSXElementName<'a>) -> Option<&'a str> {
    match name {
        JSXElementName::Identifier(identifier) => Some(identifier.name.as_str()),
        JSXElementName::IdentifierReference(identifier) => Some(identifier.name.as_str()),
        JSXElementName::MemberExpression(member) => match &member.object {
            JSXMemberExpressionObject::IdentifierReference(identifier) => {
                Some(identifier.name.as_str())
            }
            JSXMemberExpressionObject::MemberExpression(member) => match &member.object {
                JSXMemberExpressionObject::IdentifierReference(identifier) => {
                    Some(identifier.name.as_str())
                }
                _ => None,
            },
            _ => None,
        },
        _ => None,
    }
}

struct ApplicationClasses<'a> {
    layouts: &'a HashSet<String>,
    found: Vec<Span>,
}

impl<'a> Visit<'a> for ApplicationClasses<'a> {
    fn visit_jsx_opening_element(&mut self, element: &JSXOpeningElement<'a>) {
        if jsx_root(&element.name).is_some_and(|name| self.layouts.contains(name)) {
            for attribute in &element.attributes {
                let JSXAttributeItem::Attribute(attribute) = attribute else {
                    continue;
                };
                let JSXAttributeName::Identifier(name) = &attribute.name else {
                    continue;
                };
                if name.name == "class" || name.name == "className" {
                    self.found.push(attribute.span);
                }
            }
        }
        oxc_ast_visit::walk::walk_jsx_opening_element(self, element);
    }
}

pub fn lint_application(
    files: &[ProjectFile],
    sources: &[ApplicationSource],
) -> Vec<ProjectDiagnostic> {
    let source_index: HashMap<_, _> = sources
        .iter()
        .map(|source| (source.module.as_str(), &source.exports))
        .collect();
    let mut diagnostics = Vec::new();
    for file in files {
        let allocator = Allocator::default();
        let source_type =
            SourceType::from_path(&file.filename).unwrap_or_else(|_| SourceType::tsx());
        let parsed = Parser::new(&allocator, &file.source, source_type).parse();
        if parsed.panicked || !parsed.diagnostics.is_empty() {
            continue;
        }
        let mut layouts = HashSet::new();
        for statement in &parsed.program.body {
            let Statement::ImportDeclaration(import) = statement else {
                continue;
            };
            let Some(exports) = source_index.get(import.source.value.as_str()) else {
                continue;
            };
            for specifier in import.specifiers.iter().flatten() {
                let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier else {
                    continue;
                };
                if exports.contains(specifier.imported.name().as_str()) {
                    layouts.insert(specifier.local.name.to_string());
                }
            }
        }
        let mut visitor = ApplicationClasses {
            layouts: &layouts,
            found: Vec::new(),
        };
        visitor.visit_program(&parsed.program);
        diagnostics.extend(visitor.found.into_iter().map(|span| ProjectDiagnostic {
            filename: file.filename.clone(),
            source: file.source.clone(),
            rule: "application-manual-classes",
            diagnostic: Diagnostic::warning(
                "manual class override on a Layout component should be a semantic recipe parameter",
                span,
            ),
        }));
    }
    diagnostics
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{create_dir_all, remove_dir_all, write};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn lint(recipe: &str, layout: &str) -> Vec<ProjectDiagnostic> {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("solid-layouts-lint-{nonce}"));
        create_dir_all(&root).unwrap();
        let recipe_file = root.join("Button.recipe.ts");
        let layout_file = root.join("Button.layout.tsx");
        write(&recipe_file, recipe).unwrap();
        write(&layout_file, layout).unwrap();
        let result = lint_project(&[
            ProjectFile {
                filename: recipe_file.to_string_lossy().into_owned(),
                source: recipe.to_owned(),
            },
            ProjectFile {
                filename: layout_file.to_string_lossy().into_owned(),
                source: layout.to_owned(),
            },
        ]);
        remove_dir_all(root).unwrap();
        result
    }

    const RECIPE: &str = r#"import { recipe } from "solid-layouts";
export const button = recipe({
  component: "button",
  slots: { root: { base: "button" }, icon: { base: "button__icon" } },
  props: { tone: { primary: "button--primary" } },
  state: { pressed: { true: "button--pressed" } },
});
"#;

    #[test]
    fn a_recipe_and_layout_with_exact_slots_are_clean() {
        let diagnostics = lint(
            RECIPE,
            r#"import type { Layout } from "solid-layouts";
import { button } from "./Button.recipe";
export const Button: Layout<typeof button> = () => <button {...slot.root}><i {...slot.icon} /></button>;
"#,
        );
        assert!(
            diagnostics.is_empty(),
            "{}",
            diagnostics[0].diagnostic.message
        );
    }

    #[test]
    fn unresolved_recipes_and_slot_mismatches_are_errors() {
        let diagnostics = lint(
            RECIPE,
            r#"import type { Layout } from "solid-layouts";
import { button } from "./Missing.recipe";
export const Button: Layout<typeof button> = () => <button {...slot.missing} />;
"#,
        );
        assert!(diagnostics.iter().any(|item| {
            item.diagnostic.message.contains("recipe source")
                && item.diagnostic.severity == layouts_common::Severity::Error
        }));

        let diagnostics = lint(
            RECIPE,
            r#"import type { Layout } from "solid-layouts";
import { button } from "./Button.recipe";
export const Button: Layout<typeof button> = () => <button {...slot.missing} />;
"#,
        );
        assert!(
            diagnostics
                .iter()
                .any(|item| item.diagnostic.message.contains("rendered slot `missing`"))
        );
        assert!(
            diagnostics
                .iter()
                .any(|item| item.diagnostic.message.contains("declared slot `root`"))
        );
    }

    #[test]
    fn presentation_and_state_must_be_separate() {
        let diagnostics = lint(
            &RECIPE.replace(
                "state: { pressed: { true: \"button--pressed\" } }",
                "state: { tone: { primary: \"button--pressed\" } }",
            ),
            r#"import type { Layout } from "solid-layouts";
import { button } from "./Button.recipe";
export const Button: Layout<typeof button> = () => <button {...slot.root}><i {...slot.icon} /></button>;
"#,
        );
        assert!(diagnostics.iter().any(|item| {
            item.diagnostic
                .message
                .contains("both presentation and state")
        }));
    }

    #[test]
    fn legacy_templates_and_manual_classes_are_reported() {
        let diagnostics = lint(
            RECIPE,
            r#"import type { Layout } from "solid-layouts";
import { button } from "./Button.recipe";
export const Button: Layout<typeof button> = () => <button class={twMerge("button")} data-slot="root"><i data-slot="icon" /></button>;
"#,
        );
        assert!(
            diagnostics
                .iter()
                .any(|item| item.diagnostic.message.contains("legacy component-shaped"))
        );
        assert!(
            diagnostics
                .iter()
                .any(|item| item.diagnostic.message.contains("manual class composition"))
        );
    }

    #[test]
    fn porting_mode_only_warns_for_classes_on_configured_layout_imports() {
        let source = r#"import { Button, Icon as StatusIcon } from "@acme/ui";
import { Widget } from "elsewhere";
export const View = () => <div class="page"><Button class="w-full" /><StatusIcon className="red" /><Widget class="ok" /></div>;
"#;
        let diagnostics = lint_application(
            &[ProjectFile {
                filename: "/app/View.tsx".to_owned(),
                source: source.to_owned(),
            }],
            &[ApplicationSource {
                module: "@acme/ui".to_owned(),
                exports: ["Button".to_owned(), "Icon".to_owned()]
                    .into_iter()
                    .collect(),
            }],
        );
        assert_eq!(diagnostics.len(), 2);
        assert!(
            diagnostics
                .iter()
                .all(|item| item.rule == "application-manual-classes")
        );
    }
}
