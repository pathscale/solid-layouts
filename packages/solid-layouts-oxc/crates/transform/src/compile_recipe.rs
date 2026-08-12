//! Compiling a recipe's configuration into a lookup table.
//!
//! This is the emit stage, and the part that makes the model A + B = C real
//! rather than aspirational. A recipe declaration is entirely static: the
//! component name, its slots, and which class each variant value contributes
//! are all known when the file is compiled. Working that out again on every
//! render, per component instance, is the cost the runtime pays today.
//!
//! What is compiled in is data. What stays shared is the behaviour that reads
//! it. Specialising the behaviour per component would emit one copy of the
//! resolver for each of them, which is the duplication this exists to remove.

use oxc_ast::ast::{
    Argument, CallExpression, Expression, ObjectPropertyKind, Program, PropertyKey,
};
use oxc_ast_visit::Visit;
use oxc_span::Span;

/// The classes one variant value contributes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VariantClasses {
    /// A bare string. Applies to the root slot only; applying it everywhere
    /// would put a component's own modifier class on its internals.
    Root(String),
    /// Slot name to class, for a state that has to reach more than one
    /// element. An accordion trigger's `expanded` reaches both the button and
    /// its indicator.
    PerSlot(Vec<(String, String)>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Axis {
    pub name: String,
    /// Value to classes, in declaration order so the emitted table is stable
    /// and two builds of the same source produce the same bytes.
    pub values: Vec<(String, VariantClasses)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Recipe {
    pub component: String,
    pub element: Option<String>,
    /// Slot name to its base class. `root` is required by the runtime.
    pub slots: Vec<(String, Option<String>)>,
    pub props: Vec<Axis>,
    pub state: Vec<Axis>,
    pub tailwind: bool,
    /// The span of the object literal, so the emitted table can be spliced in
    /// without reformatting anything else in the file.
    pub argument_span: Span,
}

/// Reads a static string, or nothing if the expression is not one.
///
/// A computed value is not an error here: it means this recipe cannot be
/// compiled and is left for the runtime, which is the honest outcome. Guessing
/// would bake in whatever the expression happened to look like.
fn string_of(expression: &Expression<'_>) -> Option<String> {
    match expression {
        Expression::StringLiteral(literal) => Some(literal.value.to_string()),
        _ => None,
    }
}

fn key_of(key: &PropertyKey<'_>) -> Option<String> {
    match key {
        PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.to_string()),
        PropertyKey::StringLiteral(literal) => Some(literal.value.to_string()),
        _ => None,
    }
}

fn object_entries<'a, 'b>(
    expression: &'b Expression<'a>,
) -> Option<Vec<(String, &'b Expression<'a>)>> {
    let Expression::ObjectExpression(object) = expression else {
        return None;
    };
    let mut entries = Vec::new();
    for property in &object.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            // A spread means the shape is not statically known. Bail rather
            // than compile half of it.
            return None;
        };
        let key = key_of(&property.key)?;
        entries.push((key, &property.value));
    }
    Some(entries)
}

fn variant_classes(expression: &Expression<'_>) -> Option<VariantClasses> {
    if let Some(text) = string_of(expression) {
        return Some(VariantClasses::Root(text));
    }
    let entries = object_entries(expression)?;
    let mut per_slot = Vec::new();
    for (slot, value) in entries {
        per_slot.push((slot, string_of(value)?));
    }
    Some(VariantClasses::PerSlot(per_slot))
}

fn axes(expression: &Expression<'_>) -> Option<Vec<Axis>> {
    let entries = object_entries(expression)?;
    let mut out = Vec::new();
    for (name, variants) in entries {
        let values = object_entries(variants)?;
        let mut resolved = Vec::new();
        for (value, classes) in values {
            resolved.push((value, variant_classes(classes)?));
        }
        out.push(Axis {
            name,
            values: resolved,
        });
    }
    Some(out)
}

/// The properties of an object literal, by key, in declaration order.
fn entries_of<'a, 'b>(
    object: &'b oxc_ast::ast::ObjectExpression<'a>,
) -> Option<Vec<(String, &'b Expression<'a>)>> {
    let mut entries = Vec::new();
    for property in &object.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        entries.push((key_of(&property.key)?, &property.value));
    }
    Some(entries)
}

/// Reads a `recipe({...})` call into its static configuration.
///
/// Returns nothing when any part of the declaration is not a literal. That is
/// not a failure: it means this recipe cannot be compiled and the runtime
/// resolves it as before. Guessing at a computed value would bake in whatever
/// the expression happened to look like at compile time.
pub fn read(call: &CallExpression<'_>) -> Option<Recipe> {
    let Expression::Identifier(callee) = &call.callee else {
        return None;
    };
    if callee.name != "recipe" {
        return None;
    }
    let [Argument::ObjectExpression(object)] = call.arguments.as_slice() else {
        return None;
    };

    let mut component = None;
    let mut element = None;
    let mut slots = Vec::new();
    let mut props = Vec::new();
    let mut state = Vec::new();
    let mut tailwind = false;

    for (key, value) in entries_of(object)? {
        match key.as_str() {
            "component" => component = Some(string_of(value)?),
            "element" => element = Some(string_of(value)?),
            "slots" => {
                for (name, definition) in object_entries(value)? {
                    // A slot with no `base` is legal: it contributes only the
                    // classes its variants add.
                    let base = match object_entries(definition)?
                        .into_iter()
                        .find(|(k, _)| k == "base")
                    {
                        Some((_, value)) => Some(string_of(value)?),
                        None => None,
                    };
                    slots.push((name, base));
                }
            }
            "props" => props = axes(value)?,
            "state" => state = axes(value)?,
            "tailwind" => {
                let Expression::BooleanLiteral(literal) = value else {
                    return None;
                };
                tailwind = literal.value;
            }
            // An unrecognised key means this compiler is older than the recipe
            // it is reading. Compiling it would silently drop whatever the key
            // meant, so hand the whole thing to the runtime instead.
            _ => return None,
        }
    }

    Some(Recipe {
        component: component?,
        element,
        slots,
        props,
        state,
        tailwind,
        argument_span: object.span,
    })
}

/// Every declared slot, resolved to the classes each variant value adds to it.
///
/// This is the whole point: the runtime receives a table it can index, instead
/// of a configuration it has to walk and classify on every resolve.
pub fn table(recipe: &Recipe) -> String {
    let mut out = String::from("{");

    for (index, (slot, base)) in recipe.slots.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        let is_root = slot == "root";
        out.push_str(&format!("{}:{{base:", json_string(slot)));
        out.push_str(&json_string(base.as_deref().unwrap_or("")));

        out.push_str(",axes:{");
        let mut first = true;
        for axis in recipe.props.iter().chain(recipe.state.iter()) {
            let mut values = String::new();
            let mut any = false;
            for (value, classes) in &axis.values {
                let class = match classes {
                    VariantClasses::Root(text) if is_root => Some(text.as_str()),
                    VariantClasses::Root(_) => None,
                    VariantClasses::PerSlot(pairs) => pairs
                        .iter()
                        .find(|(name, _)| name == slot)
                        .map(|(_, class)| class.as_str()),
                };
                let Some(class) = class else { continue };
                if any {
                    values.push(',');
                }
                values.push_str(&format!("{}:{}", json_string(value), json_string(class)));
                any = true;
            }
            // A slot no variant touches contributes nothing, and emitting an
            // empty object per axis per slot would triple the table for the
            // common single-slot case.
            if !any {
                continue;
            }
            if !first {
                out.push(',');
            }
            out.push_str(&format!("{}:{{{}}}", json_string(&axis.name), values));
            first = false;
        }
        out.push_str("}}");
    }

    out.push('}');
    out
}

/// The state keys that mirror to `data-*`, in declaration order.
pub fn state_keys(recipe: &Recipe) -> String {
    let names: Vec<String> = recipe.state.iter().map(|a| json_string(&a.name)).collect();
    format!("[{}]", names.join(","))
}

/// Escapes a string for embedding in the emitted source.
///
/// Class names and slot names are author-controlled, so a quote or a backslash
/// in one would otherwise produce source that does not parse.
fn json_string(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for character in text.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Finds every compilable `recipe({...})` call in a file.
pub struct RecipeCollector {
    pub found: Vec<Recipe>,
}

impl<'a> Visit<'a> for RecipeCollector {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if let Some(recipe) = read(call) {
            self.found.push(recipe);
        }
        oxc_ast_visit::walk::walk_call_expression(self, call);
    }
}

pub fn find_recipes(program: &Program<'_>) -> Vec<Recipe> {
    let mut collector = RecipeCollector { found: Vec::new() };
    collector.visit_program(program);
    collector.found
}

#[cfg(test)]
mod tests {
    use super::*;
    use layouts_common::TransformOptions;
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    fn compile(source: &str) -> String {
        crate::transform(source, &TransformOptions::new("Badge.recipe.ts")).code
    }

    fn read_one(source: &str) -> Option<Recipe> {
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, source, SourceType::tsx()).parse();
        assert!(parsed.diagnostics.is_empty(), "{:?}", parsed.diagnostics);
        find_recipes(&parsed.program).into_iter().next()
    }

    const BADGE: &str = r#"
export const badge = recipe({
  component: "badge",
  element: "span",
  slots: { root: { base: "badge" } },
  props: { color: { primary: "badge--primary", danger: "badge--danger" } },
  state: { loading: { true: "badge--loading" } },
});
"#;

    #[test]
    fn reads_a_recipe_into_its_parts() {
        let recipe = read_one(BADGE).expect("badge must be readable");
        assert_eq!(recipe.component, "badge");
        assert_eq!(recipe.element.as_deref(), Some("span"));
        assert_eq!(recipe.slots.len(), 1);
        assert_eq!(recipe.props.len(), 1);
        assert_eq!(recipe.state.len(), 1);
    }

    #[test]
    fn the_table_indexes_slot_then_axis_then_value() {
        let recipe = read_one(BADGE).unwrap();
        let table = table(&recipe);
        assert!(table.contains(r#""root":{base:"badge""#), "{table}");
        assert!(
            table.contains(r#""color":{"primary":"badge--primary""#),
            "{table}"
        );
        assert!(
            table.contains(r#""loading":{"true":"badge--loading"}"#),
            "{table}"
        );
    }

    #[test]
    fn only_state_keys_mirror_to_data_attributes() {
        let recipe = read_one(BADGE).unwrap();
        assert_eq!(state_keys(&recipe), r#"["loading"]"#);
    }

    #[test]
    fn a_bare_string_variant_does_not_reach_a_non_root_slot() {
        // The rule the runtime enforces, now decided at compile time.
        let recipe = read_one(
            r#"const r = recipe({
                 component: "x",
                 slots: { root: { base: "x" }, tail: { base: "x__tail" } },
                 state: { on: { true: "x--on" } },
               });"#,
        )
        .unwrap();
        let table = table(&recipe);
        let tail = &table[table.find(r#""tail""#).unwrap()..];
        assert!(
            !tail.contains("x--on"),
            "a root-only class leaked onto tail: {table}"
        );
    }

    #[test]
    fn a_slot_keyed_variant_reaches_each_slot_it_names() {
        let recipe = read_one(
            r#"const r = recipe({
                 component: "accordion-trigger",
                 slots: { root: { base: "t" }, indicator: { base: "i" } },
                 state: { expanded: { true: { root: "t--open", indicator: "i--open" } } },
               });"#,
        )
        .unwrap();
        let table = table(&recipe);
        assert!(table.contains("t--open"), "{table}");
        assert!(table.contains("i--open"), "{table}");
    }

    #[test]
    fn a_computed_value_is_left_for_the_runtime() {
        // Not an error. Guessing at a computed value would bake in whatever
        // the expression happened to look like.
        for source in [
            r#"const r = recipe({ component: NAME, slots: { root: {} } });"#,
            r#"const r = recipe({ component: "x", slots: { root: { base: prefix + "y" } } });"#,
            r#"const r = recipe({ ...shared, component: "x", slots: { root: {} } });"#,
        ] {
            assert!(read_one(source).is_none(), "should not compile: {source}");
        }
    }

    #[test]
    fn an_unknown_key_is_handed_to_the_runtime_rather_than_dropped() {
        // A recipe written against a newer runtime than this compiler.
        let source =
            r#"const r = recipe({ component: "x", slots: { root: {} }, futureThing: 1 });"#;
        assert!(read_one(source).is_none());
    }

    #[test]
    fn a_class_containing_a_quote_survives_the_round_trip() {
        let out =
            compile(r#"const r = recipe({ component: "x", slots: { root: { base: "a\"b" } } });"#);
        // Emitted source has to parse. An unescaped quote would end the string.
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, &out, SourceType::tsx()).parse();
        assert!(
            parsed.diagnostics.is_empty(),
            "emitted source must parse: {out}"
        );
    }

    #[test]
    fn the_compiled_table_is_spliced_into_the_declaration() {
        let out = compile(BADGE);
        assert!(out.contains("__compiled:"), "{out}");
        // Everything else is byte-identical; only the insertion is new.
        assert!(out.contains(r#"component: "badge""#), "{out}");
        assert!(out.starts_with('\n'), "leading source must be untouched");
    }

    #[test]
    fn two_recipes_in_one_file_are_both_compiled() {
        let out = compile(
            r#"export const a = recipe({ component: "a", slots: { root: {} } });
               export const b = recipe({ component: "b", slots: { root: {} } });"#,
        );
        assert_eq!(out.matches("__compiled:").count(), 2, "{out}");
        // The second splice must not have shifted the first.
        assert!(
            out.contains(r#"component: "a""#) && out.contains(r#"component: "b""#),
            "{out}"
        );
    }

    #[test]
    fn a_file_with_no_recipe_comes_back_byte_identical() {
        let source = "export const x = 1;\n";
        assert_eq!(compile(source), source);
    }
}

#[cfg(test)]
mod emit_tests {
    use layouts_common::TransformOptions;
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    /// The emitted file must parse. Everything else about the transform is
    /// worthless if the output is not valid source.
    fn assert_emits_valid(source: &str) -> String {
        let out = crate::transform(source, &TransformOptions::new("R.recipe.ts")).code;
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, &out, SourceType::tsx()).parse();
        assert!(
            parsed.diagnostics.is_empty(),
            "emitted source does not parse:\n{out}\n{:?}",
            parsed.diagnostics
        );
        out
    }

    #[test]
    fn a_trailing_comma_does_not_produce_a_double_comma() {
        // The overwhelmingly common formatting, and the one that broke first.
        assert_emits_valid(
            "const r = recipe({\n  component: \"x\",\n  slots: { root: { base: \"x\" } },\n});",
        );
    }

    #[test]
    fn no_trailing_comma_still_gets_its_separator() {
        assert_emits_valid("const r = recipe({ component: \"x\", slots: { root: {} } });");
    }

    #[test]
    fn every_formatting_of_the_same_recipe_emits_valid_source() {
        for source in [
            "const r = recipe({component:\"x\",slots:{root:{}}});",
            "const r = recipe({\n component: \"x\",\n slots: { root: {} }\n});",
            "const r = recipe({\n\tcomponent: \"x\",\n\tslots: { root: {} },\n\n});",
        ] {
            assert_emits_valid(source);
        }
    }
}
