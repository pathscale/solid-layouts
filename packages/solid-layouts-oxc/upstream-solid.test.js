"use strict";

const { expect, test } = require("bun:test");
const { existsSync, readFileSync, readdirSync } = require("node:fs");
const { join, relative } = require("node:path");
const { transform } = require("./index.js");

const fixtureRoot = process.env.DOM_EXPRESSIONS_FIXTURES;

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return filesBelow(path);
      return entry.name === "code.js" ? [path] : [];
    })
    .sort();
}

const knownParserGaps = new Map([
  ["__dom_fixtures__/insertChildren/code.js", "JSX expressions may not use the comma operator"],
  ["__dom_fixtures__/namespaceElements/code.js", "Identifiers in JSX cannot contain hyphens"],
  ["__dom_hydratable_fixtures__/insertChildren/code.js", "JSX expressions may not use the comma operator"],
  ["__dynamic_fixtures__/insertChildren/code.js", "JSX expressions may not use the comma operator"],
  ["__ssr_fixtures__/insertChildren/code.js", "JSX expressions may not use the comma operator"],
  ["__ssr_hydratable_fixtures__/attributeExpressions/code.js", "JSX expressions may not use the comma operator"],
  ["__ssr_hydratable_fixtures__/insertChildren/code.js", "JSX expressions may not use the comma operator"],
  ["__universal_fixtures__/insertChildren/code.js", "JSX expressions may not use the comma operator"],
]);

test.skipIf(!fixtureRoot || !existsSync(fixtureRoot))(
  "parses the pinned upstream Solid JSX transform corpus",
  () => {
    const files = filesBelow(fixtureRoot);
    const failures = new Map();

    expect(files).toHaveLength(74);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const result = transform(source, `${file}x`, {
        mode: "library",
        parseOnly: true,
      });
      const name = relative(fixtureRoot, file);
      if (result.failed) {
        failures.set(name, result.diagnostics.map(({ message }) => message));
        continue;
      }
      expect(result.changed).toBe(false);
      expect(result.code).toBe(source);
    }

    expect([...failures.keys()]).toEqual([...knownParserGaps.keys()].sort());
    for (const [name, message] of knownParserGaps) {
      expect(failures.get(name)).toEqual([message]);
    }
  },
);
