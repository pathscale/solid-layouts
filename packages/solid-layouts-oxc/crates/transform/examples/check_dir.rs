//! Runs the checker over a directory of real source, so the pass is exercised
//! against code nobody wrote for it.
use layouts_common::{
    CompilerMode, LayoutSource, LayoutsConfig, LineIndex, Severity, TransformOptions,
};
use layouts_transform::transform;
use std::{env, fs, path::Path};

fn walk(dir: &Path, out: &mut Vec<std::path::PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if path.file_name().is_some_and(|n| n == "node_modules") {
                continue;
            }
            walk(&path, out);
        } else if path.extension().is_some_and(|e| e == "tsx" || e == "ts") {
            out.push(path);
        }
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let root = Path::new(&args[1]);
    let layouts: Vec<String> = args[2..].to_vec();
    let config = if layouts.is_empty() {
        LayoutsConfig::default()
    } else {
        LayoutsConfig {
            sources: layouts
                .into_iter()
                .map(|module| LayoutSource {
                    module,
                    exports: Vec::new(),
                })
                .collect(),
        }
    };

    let mut files = Vec::new();
    walk(root, &mut files);
    files.sort();

    let (mut errors, mut checked) = (0usize, 0usize);
    for file in &files {
        let Ok(source) = fs::read_to_string(file) else {
            continue;
        };
        let mut options = TransformOptions::new(file.to_string_lossy(), CompilerMode::Application);
        options.config = config.clone();
        let result = transform(&source, &options);
        checked += 1;
        let index = LineIndex::new(&source);
        for d in &result.diagnostics {
            if d.severity == Severity::Error {
                errors += 1;
            }
            println!("{}", d.render(&file.to_string_lossy(), &source, &index));
        }
    }
    println!("\n{checked} files checked, {errors} errors");
}
