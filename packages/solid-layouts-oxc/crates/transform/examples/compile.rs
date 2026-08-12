//! Compiles one file and prints the result, so the emitted output can be fed
//! straight back to the runtime it targets.
use layouts_common::{CompilerMode, TransformOptions};
use layouts_transform::transform;
use std::{env, fs};

fn main() {
    let args: Vec<String> = env::args().collect();
    let source = fs::read_to_string(&args[1]).expect("readable input");
    let out = transform(
        &source,
        &TransformOptions::new(&args[1], CompilerMode::Library),
    );
    for d in &out.diagnostics {
        eprintln!("{}: {}", args[1], d.message);
    }
    print!("{}", out.code);
}
