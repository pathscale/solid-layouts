//! Runs the conformance corpus in `fixtures/cases`.
//!
//! See `fixtures/README.md` for the format. The corpus is the specification of
//! what the pass does, and the thing that will establish the frozen Babel
//! on-ramp and the living oxc pass agreed at the moment the former shipped.

use std::fs;
use std::path::{Path, PathBuf};

use layouts_common::{CompilerMode, TransformOptions};
use layouts_transform::transform;

struct Case {
    name: String,
    filename: String,
    pending: bool,
    reason: Option<String>,
    input: String,
    expected: String,
}

fn corpus_dir() -> PathBuf {
    // From `crates/transform` up to the repository root.
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../../fixtures/cases")
        .canonicalize()
        .expect("the fixtures directory must exist next to the packages")
}

/// Reads one field out of a case's metadata.
///
/// Hand-rolled rather than pulling serde_json into this crate: the file has
/// three keys and a real parser would be the only dependency here that exists
/// solely for the test harness.
fn field<'a>(json: &'a str, key: &str) -> Option<&'a str> {
    let needle = format!("\"{key}\"");
    let start = json.find(&needle)? + needle.len();
    let rest = json[start..].trim_start().strip_prefix(':')?.trim_start();

    if let Some(quoted) = rest.strip_prefix('"') {
        let end = quoted.find('"')?;
        Some(&quoted[..end])
    } else {
        let end = rest.find([',', '}', '\n']).unwrap_or(rest.len());
        Some(rest[..end].trim())
    }
}

fn load_cases() -> Vec<Case> {
    let dir = corpus_dir();
    let mut cases: Vec<Case> = fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", dir.display()))
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_dir())
        .map(|entry| {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            let read = |file: &str| {
                fs::read_to_string(path.join(file)).unwrap_or_else(|e| panic!("{name}/{file}: {e}"))
            };

            let meta = read("case.json");
            Case {
                filename: field(&meta, "filename")
                    .unwrap_or_else(|| panic!("{name}/case.json needs a \"filename\""))
                    .to_owned(),
                pending: field(&meta, "pending") == Some("true"),
                reason: field(&meta, "reason").map(str::to_owned),
                input: read("input.tsx"),
                expected: read("output.tsx"),
                name,
            }
        })
        .collect();

    cases.sort_by(|a, b| a.name.cmp(&b.name));
    assert!(!cases.is_empty(), "the corpus must not be empty");
    cases
}

#[test]
fn every_case_behaves_as_its_metadata_claims() {
    let mut failures = Vec::new();

    for case in load_cases() {
        let result = transform(
            &case.input,
            &TransformOptions::new(&case.filename, CompilerMode::Library),
        );
        let matches = result.code == case.expected;

        match (case.pending, matches) {
            (false, false) => failures.push(format!(
                "{}: output did not match.\n--- expected ---\n{}\n--- actual ---\n{}",
                case.name, case.expected, result.code
            )),
            // A pending case that starts passing means either the phase landed
            // and nobody updated the metadata, or the expected output happened
            // to coincide with current behaviour. Both deserve a failing build,
            // which is why these are asserted rather than skipped.
            (true, true) => failures.push(format!(
                "{}: marked pending but now passes. Either the phase landed and \
                 `case.json` needs updating, or the expected output was wrong. \
                 Reason on file: {}",
                case.name,
                case.reason.as_deref().unwrap_or("(none given)")
            )),
            _ => {}
        }
    }

    assert!(failures.is_empty(), "\n\n{}\n", failures.join("\n\n"));
}

#[test]
fn a_layout_case_is_named_so_the_pass_treats_it_as_one() {
    // The pass classifies by filename. A case meaning to exercise layout
    // behaviour but named `Foo.tsx` would be handled as an ordinary file and
    // pass for the wrong reason.
    for case in load_cases() {
        if case.input.contains("Layout<typeof") {
            assert!(
                case.filename.ends_with(".layout.tsx"),
                "{}: contains a layout but `filename` is {:?}, so the pass will \
                 treat it as an ordinary file",
                case.name,
                case.filename
            );
        }
    }
}
