//! Resolving a component reference to the Layout that defines it.
//!
//! The compiler takes Layouts (A) and user code (B) and emits what the runtime
//! consumes (C). This module is the join: for every component the user writes,
//! find the Layout it came from. A reference that resolves to nothing is a hard
//! error, because falling through would mean emitting a component whose
//! presentation nobody declared.

use std::collections::HashMap;

use layouts_common::{Diagnostic, LayoutSource, LayoutsConfig};
use oxc_ast::ast::{
    BindingIdentifier, Declaration, ImportDeclarationSpecifier, JSXElementName,
    JSXMemberExpression, JSXMemberExpressionObject, Program, Statement,
};
use oxc_ast_visit::Visit;
use oxc_span::{GetSpan, Span};

/// A component the user wrote, and where it was written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reference {
    /// The binding as written. For `<Accordion.Item>` this is `Accordion`,
    /// because that is the name an import can bind.
    pub name: String,
    /// Member names after the bound import. For `<UI.Icon>` this is `Icon`;
    /// for `<Accordion.Item>` this is `Item`.
    pub members: Vec<String>,
    pub span: Span,
}

/// Where a name came from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Origin {
    /// A named or default import from a module specifier.
    Import { source: String, imported: String },
    /// A namespace import. The first JSX member is the public export.
    NamespaceImport(String),
    /// Declared in this file. Not a Layout, and not an error either: a local
    /// helper component is ordinary code.
    Local,
    /// Neither imported nor declared here. Either a global or a mistake, and
    /// the compiler cannot tell which.
    Unknown,
}

/// Collects the components referenced in JSX.
///
/// Lowercase names are intrinsic elements (`div`, `span`) and are skipped: they
/// are not components and have no Layout. This follows the JSX convention
/// rather than a list, so a custom element with a dash is also left alone.
struct ReferenceCollector {
    found: Vec<Reference>,
    seen: Vec<String>,
}

fn member_parts(member: &JSXMemberExpression<'_>) -> (String, Vec<String>, Span) {
    let mut members = vec![member.property.name.to_string()];
    let mut object = &member.object;
    loop {
        match object {
            JSXMemberExpressionObject::MemberExpression(inner) => {
                members.push(inner.property.name.to_string());
                object = &inner.object;
            }
            JSXMemberExpressionObject::IdentifierReference(identifier) => {
                members.reverse();
                return (identifier.name.to_string(), members, identifier.span);
            }
            JSXMemberExpressionObject::ThisExpression(_) => {
                return ("this".to_owned(), Vec::new(), member.span);
            }
        }
    }
}

impl<'a> Visit<'a> for ReferenceCollector {
    fn visit_jsx_element_name(&mut self, name: &JSXElementName<'a>) {
        let (binding, members, span) = match name {
            JSXElementName::IdentifierReference(identifier) => {
                (identifier.name.to_string(), Vec::new(), identifier.span)
            }
            // `<Accordion.Item>`: the import binds `Accordion`, so that is what
            // has to resolve. Whether `Item` exists on it is the Layout's
            // business, not the resolver's.
            JSXElementName::MemberExpression(member) => member_parts(member),
            _ => return,
        };

        if !binding.starts_with(char::is_uppercase) {
            return;
        }
        // Reported once per component, not once per use. Twenty `<Button>`s
        // with no Layout is one problem, and twenty copies of it is noise that
        // buries the other nineteen problems.
        if self.seen.contains(&binding) {
            return;
        }
        self.seen.push(binding.clone());
        self.found.push(Reference {
            name: binding,
            members,
            span,
        });
    }
}

pub fn find_references(program: &Program<'_>) -> Vec<Reference> {
    let mut collector = ReferenceCollector {
        found: Vec::new(),
        seen: Vec::new(),
    };
    collector.visit_program(program);
    collector.found
}

/// Maps every name this module binds to where it came from.
pub fn find_origins(program: &Program<'_>) -> HashMap<String, Origin> {
    let mut origins = HashMap::new();

    for statement in &program.body {
        match statement {
            Statement::ImportDeclaration(import) => {
                // A type-only import cannot be a component. Treating it as one
                // would demand a Layout for `import type { Props }`.
                if import.import_kind.is_type() {
                    continue;
                }
                let source = import.source.value.to_string();
                let Some(specifiers) = &import.specifiers else {
                    continue;
                };
                for specifier in specifiers {
                    let local = specifier.local().name.to_string();
                    let origin = match specifier {
                        ImportDeclarationSpecifier::ImportSpecifier(specifier) => Origin::Import {
                            source: source.clone(),
                            imported: specifier.imported.name().to_string(),
                        },
                        ImportDeclarationSpecifier::ImportDefaultSpecifier(_) => Origin::Import {
                            source: source.clone(),
                            imported: "default".to_owned(),
                        },
                        ImportDeclarationSpecifier::ImportNamespaceSpecifier(_) => {
                            Origin::NamespaceImport(source.clone())
                        }
                    };
                    origins.insert(local, origin);
                }
            }
            Statement::ExportDeclaration(export) => {
                declared_name(&export.declaration, &mut origins);
            }
            _ => {
                if let Some(declaration) = statement.as_declaration() {
                    declared_name(declaration, &mut origins);
                }
            }
        }
    }

    let mut locals = LocalBindingCollector {
        origins: &mut origins,
    };
    locals.visit_program(program);

    origins
}

struct LocalBindingCollector<'map> {
    origins: &'map mut HashMap<String, Origin>,
}

impl<'a> Visit<'a> for LocalBindingCollector<'_> {
    fn visit_binding_identifier(&mut self, identifier: &BindingIdentifier<'a>) {
        self.origins
            .entry(identifier.name.to_string())
            .or_insert(Origin::Local);
    }
}

fn declared_name(declaration: &Declaration<'_>, origins: &mut HashMap<String, Origin>) {
    match declaration {
        Declaration::VariableDeclaration(variables) => {
            for declarator in &variables.declarations {
                if let Some(identifier) = declarator.id.get_binding_identifier() {
                    origins.insert(identifier.name.to_string(), Origin::Local);
                }
            }
        }
        Declaration::FunctionDeclaration(function) => {
            if let Some(identifier) = &function.id {
                origins.insert(identifier.name.to_string(), Origin::Local);
            }
        }
        Declaration::ClassDeclaration(class) => {
            if let Some(identifier) = &class.id {
                origins.insert(identifier.name.to_string(), Origin::Local);
            }
        }
        _ => {}
    }
}

/// Whether a module specifier points inside the project rather than at a
/// package.
///
/// This distinction is the whole rule. A component imported from your own
/// source is ordinary application code that the compiler also compiles, so it
/// needs no Layout. A component imported from a package is opaque, and the
/// compiler can only emit it if a Layout describes it.
///
/// Getting this wrong is not subtle: without it, `import { App } from "./App"`
/// demands a Layout for `App`, and no application with more than one file can
/// compile. It was found by running the checker over a real project rather
/// than by reasoning about it.
///
/// `@` is ambiguous and has to be handled by shape: `@pathscale/ui` is a
/// scoped package, `@/components` is an alias with an empty scope.
/// Solid's control-flow components.
///
/// They are components by every syntactic test and have no Layout, because
/// they render no markup of their own. Without this the compiler rejects every
/// real Solid file, since `<Show>` and `<For>` appear in almost all of them.
///
/// The list matches `babel-preset-solid`'s `builtIns`, which is the same set
/// the JSX transform special-cases, so the two agree about what a built-in is.
const SOLID_BUILTINS: &[&str] = &[
    "For",
    "Show",
    "Switch",
    "Match",
    "Suspense",
    "SuspenseList",
    "Portal",
    "Index",
    "Dynamic",
    "ErrorBoundary",
];

/// Whether a name is a Solid built-in imported from Solid itself.
///
/// Both halves matter. A user's own component called `Show` imported from
/// their library still needs a Layout, and a built-in imported from anywhere
/// else is not the built-in.
fn is_solid_builtin(name: &str, source: &str) -> bool {
    SOLID_BUILTINS.contains(&name) && (source == "solid-js" || source == "solid-js/web")
}

/// Checks every component reference against the configured Layout sources.
///
/// Returns one diagnostic per unresolved component. Locally declared
/// components pass: a helper defined in the same file is ordinary code, not a
/// Layout, and demanding one would make the compiler reject every private
/// component anyone writes.
pub fn check(program: &Program<'_>, config: &LayoutsConfig) -> Vec<Diagnostic> {
    let origins = find_origins(program);
    let mut diagnostics = Vec::new();

    for reference in find_references(program) {
        match origins.get(&reference.name) {
            Some(Origin::Local) => {}
            Some(Origin::Import { source, imported }) => {
                if is_solid_builtin(&reference.name, source) {
                    continue;
                }
                let Some(layout_source) = source_config(config, source) else {
                    continue;
                };
                if !layout_source.exports.contains(imported) {
                    diagnostics.push(Diagnostic::error(
                        format!(
                            "no Layout found for public export `{}` imported from \"{}\" as `{}`",
                            imported, source, reference.name,
                        ),
                        reference.span,
                    ));
                }
            }
            Some(Origin::NamespaceImport(source)) => {
                let Some(layout_source) = source_config(config, source) else {
                    continue;
                };
                let Some(export) = reference.members.first() else {
                    diagnostics.push(Diagnostic::error(
                        format!(
                            "namespace import `{}` from \"{}\" must name a Layout export",
                            reference.name, source
                        ),
                        reference.span,
                    ));
                    continue;
                };
                if !layout_source.exports.contains(export) {
                    diagnostics.push(Diagnostic::error(
                        format!(
                            "no Layout found for public export `{}` referenced through namespace `{}` from \"{}\"",
                            export, reference.name, source
                        ),
                        reference.span,
                    ));
                }
            }
            Some(Origin::Unknown) | None => {
                diagnostics.push(Diagnostic::error(
                    format!(
                        "no Layout found for `{}`: it is neither imported nor declared in \
                         this file",
                        reference.name
                    ),
                    reference.span,
                ));
            }
        }
    }

    diagnostics
}

fn source_config<'a>(config: &'a LayoutsConfig, source: &str) -> Option<&'a LayoutSource> {
    config.sources.iter().find(|entry| entry.module == source)
}

/// Unused today, kept because `GetSpan` is the trait the AST exposes spans
/// through and dropping the import would break the next thing that needs one.
#[allow(dead_code)]
fn span_of(declaration: &Declaration<'_>) -> Span {
    declaration.span()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    pub(crate) fn check_source(source: &str, layouts: &[(&str, &[&str])]) -> Vec<String> {
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, source, SourceType::tsx()).parse();
        assert!(
            parsed.diagnostics.is_empty(),
            "fixture must parse: {:?}",
            parsed.diagnostics
        );
        let config = LayoutsConfig {
            sources: layouts
                .iter()
                .map(|(module, exports)| LayoutSource {
                    module: (*module).to_owned(),
                    exports: exports.iter().map(|name| (*name).to_owned()).collect(),
                    resolved: None,
                })
                .collect(),
        };
        check(&parsed.program, &config)
            .into_iter()
            .map(|d| d.message)
            .collect()
    }

    #[test]
    fn a_component_from_a_configured_source_resolves() {
        let errors = check_source(
            r#"import { Button } from "@pathscale/ui";
               export const A = () => <Button>go</Button>;"#,
            &[("@pathscale/ui", &["Button"])],
        );
        assert!(errors.is_empty(), "{errors:?}");
    }

    #[test]
    fn a_users_own_library_resolves_identically() {
        // The whole point of not hardcoding: no special-casing for the
        // reference library.
        let errors = check_source(
            r#"import { Button } from "my-design-system";
               export const A = () => <Button>go</Button>;"#,
            &[("my-design-system", &["Button"])],
        );
        assert!(errors.is_empty(), "{errors:?}");
    }

    #[test]
    fn a_component_from_an_unconfigured_source_is_ordinary_solid() {
        let errors = check_source(
            r#"import { Button } from "some-other-lib";
               export const A = () => <Button>go</Button>;"#,
            &[("@pathscale/ui", &["Button"])],
        );
        assert!(errors.is_empty(), "{errors:?}");
    }

    #[test]
    fn a_missing_export_from_a_configured_source_is_an_error() {
        let errors = check_source(
            r#"import { Card } from "@pathscale/ui";
               export const A = () => <Card />;"#,
            &[("@pathscale/ui", &["Button"])],
        );
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("public export `Card`"), "{errors:?}");
    }

    #[test]
    fn an_undeclared_component_is_an_error() {
        let errors = check_source("export const A = () => <Mystery />;", &[]);
        assert_eq!(errors.len(), 1);
        assert!(
            errors[0].contains("neither imported nor declared"),
            "{errors:?}"
        );
    }

    #[test]
    fn a_locally_declared_component_is_not_a_layout_and_not_an_error() {
        // A private helper is ordinary code. Demanding a Layout for it would
        // reject every component anyone writes inside their own app.
        for source in [
            "function Helper() { return null; }\nexport const A = () => <Helper />;",
            "const Helper = () => null;\nexport const A = () => <Helper />;",
            "export const Helper = () => null;\nexport const A = () => <Helper />;",
            "class Helper {}\nexport const A = () => <Helper />;",
        ] {
            let errors = check_source(source, &[]);
            assert!(errors.is_empty(), "{source:?} -> {errors:?}");
        }
    }

    #[test]
    fn a_component_declared_inside_another_component_is_local() {
        for source in [
            "export const A = () => { const Helper = () => null; return <Helper />; };",
            "export const A = (Helper) => <Helper />;",
        ] {
            let errors = check_source(source, &[]);
            assert!(errors.is_empty(), "{source:?} -> {errors:?}");
        }
    }

    #[test]
    fn intrinsic_elements_are_not_components() {
        let errors = check_source(
            "export const A = () => <div><span /><my-widget /></div>;",
            &[],
        );
        assert!(errors.is_empty(), "{errors:?}");
    }

    #[test]
    fn a_compound_reference_resolves_through_its_base() {
        // `<Accordion.Item>` is bound by the import of `Accordion`. Whether
        // `Item` exists on it is the Layout's business, not the resolver's.
        let ok = check_source(
            r#"import { Accordion } from "@pathscale/ui";
               export const A = () => <Accordion.Item.Deep />;"#,
            &[("@pathscale/ui", &["Accordion"])],
        );
        assert!(ok.is_empty(), "{ok:?}");

        let bad = check_source(
            "export const A = () => <Accordion.Item />;",
            &[("@pathscale/ui", &["Accordion"])],
        );
        assert_eq!(bad.len(), 1);
        assert!(bad[0].contains("`Accordion`"), "{bad:?}");
    }

    #[test]
    fn a_type_only_import_does_not_demand_a_layout() {
        let errors = check_source(
            r#"import type { ButtonProps } from "@pathscale/ui";
               import { Button } from "@pathscale/ui";
               export const A = () => <Button />;"#,
            &[("@pathscale/ui", &["Button"])],
        );
        assert!(errors.is_empty(), "{errors:?}");
    }

    #[test]
    fn one_component_is_reported_once_however_often_it_is_used() {
        let errors = check_source(
            "export const A = () => <><Mystery /><Mystery /><Mystery /></>;",
            &[],
        );
        assert_eq!(
            errors.len(),
            1,
            "twenty copies would bury the real problems"
        );
    }

    #[test]
    fn several_configured_sources_all_resolve() {
        let errors = check_source(
            r#"import { Button } from "@pathscale/ui";
               import { Widget } from "./ui";
               export const A = () => <><Button /><Widget /></>;"#,
            &[("@pathscale/ui", &["Button"]), ("./ui", &["Widget"])],
        );
        assert!(errors.is_empty(), "{errors:?}");
    }

    #[test]
    fn an_alias_is_checked_by_its_public_export_name() {
        let errors = check_source(
            r#"import { Icon as StatusIcon } from "@pathscale/ui";
               export const A = () => <StatusIcon />;"#,
            &[("@pathscale/ui", &["Icon"])],
        );
        assert!(errors.is_empty(), "{errors:?}");
    }

    #[test]
    fn a_namespace_member_is_checked_by_its_public_export_name() {
        let errors = check_source(
            r#"import * as UI from "@pathscale/ui";
               export const A = () => <UI.Icon />;"#,
            &[("@pathscale/ui", &["Icon"])],
        );
        assert!(errors.is_empty(), "{errors:?}");
    }
}

#[cfg(test)]
mod builtin_tests {
    use super::tests::check_source;

    #[test]
    fn solid_control_flow_needs_no_layout() {
        let errors = check_source(
            r#"import { For, Show, Switch, Match, Index, ErrorBoundary, Suspense } from "solid-js";
               import { Portal, Dynamic } from "solid-js/web";
               export const A = () => (
                 <Show when={x}>
                   <For each={y}>{(i) => <Index each={i}><Dynamic component="div" /></Index>}</For>
                   <Switch><Match when={z}><Portal><Suspense><ErrorBoundary /></Suspense></Portal></Match></Switch>
                 </Show>
               );"#,
            &[],
        );
        assert!(errors.is_empty(), "{errors:?}");
    }

    #[test]
    fn a_component_merely_named_like_a_builtin_still_needs_a_layout() {
        // Both halves of the check matter: the name alone is not enough.
        let errors = check_source(
            r#"import { Show } from "some-other-lib";
               export const A = () => <Show />;"#,
            &[("some-other-lib", &[])],
        );
        assert_eq!(errors.len(), 1, "{errors:?}");
    }
}

#[cfg(test)]
mod locality_tests {
    use super::tests::check_source;

    #[test]
    fn project_imports_need_no_layout() {
        // Found by running the checker over chuzz: every one of these forms
        // appears in a real application, and demanding a Layout for them made
        // a multi-file project impossible to compile.
        for specifier in [
            "./App",
            "../features/panel",
            "~/features/status",
            "@/components/Card",
        ] {
            let errors = check_source(
                &format!(
                    "import {{ Thing }} from \"{specifier}\";\nexport const A = () => <Thing />;"
                ),
                &[],
            );
            assert!(errors.is_empty(), "{specifier} -> {errors:?}");
        }
    }

    #[test]
    fn a_scoped_layout_package_is_not_confused_with_an_alias() {
        // `@pathscale/ui` and `@/components` both start with `@`; only the
        // second is an alias.
        let errors = check_source(
            r#"import { Button } from "@some/other-lib";
               export const A = () => <Button />;"#,
            &[("@some/other-lib", &[])],
        );
        assert_eq!(
            errors.len(),
            1,
            "a scoped package must not be read as an alias"
        );
    }

    #[test]
    fn a_configured_package_component_still_needs_an_exact_layout() {
        let errors = check_source(
            r#"import { Button } from "some-ui-kit";
               export const A = () => <Button />;"#,
            &[("some-ui-kit", &[])],
        );
        assert_eq!(errors.len(), 1, "{errors:?}");
    }
}
