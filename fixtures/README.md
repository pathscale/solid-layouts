# Conformance corpus

Input to expected output, one directory per case. This is the specification of
what the pass does, written in the only form that cannot drift from the
implementation.

It exists for three reasons, in ascending order of how much they matter:

1. It is the regression suite for the oxc pass.
2. It is what makes a second host cheap rather than a rewrite. `solid-jsx-oxc`
   validates its own port the same way, by vendoring the original
   `babel-plugin-jsx-dom-expressions` and running its test suite against the
   Rust implementation.
3. It is the only thing that will establish that the frozen Babel on-ramp and
   the living oxc pass agreed at the moment the Babel one was published. That
   package is written once and never maintained, so there is exactly one
   opportunity to prove they matched.

## Format

```
fixtures/cases/<name>/
  case.json     metadata: the filename to compile as, and whether it is pending
  input.tsx     what the author wrote
  output.tsx    what the pass must produce
```

`case.json`:

```json
{
  "filename": "Accordion.layout.tsx",
  "pending": false,
  "reason": "why, when pending is true"
}
```

`filename` matters: the pass classifies a file by its name, so a case testing
layout behaviour must be named `*.layout.tsx` or it will be treated as an
ordinary file and left alone.

## Pending cases

A case with `"pending": true` describes a transform that is specified but not
yet implemented. The runner asserts that a pending case does **not** yet match
its expected output, and fails if one starts passing.

That direction is deliberate. A pending case that quietly begins to pass means
either the phase landed and the metadata was not updated, or the expected
output was wrong in a way that happened to coincide with current behaviour.
Both are worth a failing build. Skipping them instead would let the corpus
drift out of step with the pass without anyone noticing.

## Adding a case

Write `input.tsx` and `output.tsx` by hand. Do not generate `output.tsx` from
the current implementation: a corpus recorded from the thing it is meant to
check asserts only that the code has not changed, not that it is correct.
