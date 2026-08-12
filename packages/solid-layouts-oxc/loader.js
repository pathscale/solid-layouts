"use strict";

const { transform } = require("./index.js");

/**
 * The application Layouts pass, as a webpack/rspack loader.
 *
 * It has to run *before* the Solid JSX transform. By the time that has run
 * there is no `<Accordion.Trigger>` left to match against a Layout — only
 * `_$createComponent` calls — so a loader placed after it can neither check
 * references nor find the recipes to compile. In an rspack `use` array that
 * means listing it last, since those apply right to left.
 *
 * Errors are reported rather than thrown: the callback's error path aborts
 * this module, but pushing to `this.errors` lets the build collect every
 * unmatched Layout in one run instead of stopping at the first file.
 */
module.exports = function layoutsLoader(source) {
  const callback = this.async();
  const filename = this.resourcePath;

  // Whatever the rspack rule set on the loader. A repository that vendors the
  // library rather than installing it has to name the path it keeps it under,
  // or every component import looks like the user's own code and is allowed
  // through unchecked.
  const options =
    typeof this.getOptions === "function" ? this.getOptions() || {} : {};

  let result;
  try {
    result = transform(source, filename, {
      mode: options.mode,
      layoutSources: options.layoutSources,
      parseOnly: options.parseOnly,
    });
  } catch (error) {
    // A panic in the pass is a bug in the pass, not in the user's code. Say so,
    // rather than reporting it against whatever file happened to be in flight.
    callback(
      new Error(
        `solid-layouts-oxc failed on ${filename}: ${error && error.message ? error.message : error}`,
      ),
    );
    return;
  }

  for (const diagnostic of result.diagnostics) {
    const at = `${filename}:${diagnostic.line}:${diagnostic.column}`;
    const problem = new Error(`${at}  ${diagnostic.message}`);
    problem.name =
      diagnostic.severity === "error" ? "LayoutsError" : "LayoutsWarning";
    if (diagnostic.severity === "error") this.emitError(problem);
    else this.emitWarning(problem);
  }

  // The source is returned untouched when nothing matched, so a file with no
  // Layouts in it costs a parse and nothing else — no re-print, and no source
  // map invalidated for a file that did not change.
  callback(null, result.changed ? result.code : source);
};
