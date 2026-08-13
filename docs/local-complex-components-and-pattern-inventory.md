# Local complex components and the application inventory

The next migration work is driven by real application evidence, not by adding arbitrary presentation props to `@pathscale/ui`.

The first deep-review corpus is:

1. Chuzz, the first full Solid Layouts consumer and the smallest complete desktop chrome.
2. nofilter.io, the largest and most structurally complex UI in the corpus.
3. AgencyZero, especially its newly migrated Solid workspace, tabs, panels, and stateful controls.

Every application under `~/code` is product evidence. Chuzz, nofilter.io, and AgencyZero receive the deepest initial review because together they exercise desktop chrome, complex responsive UI, and a large newly migrated Solid workspace. The other applications remain first-class inputs: they can establish shared form, authentication, table, card, spacing, and typography contracts that the first three do not exercise, and a strong pattern in any one product can justify a local component or a candidate for validation elsewhere.

## Classification boundary

Every finding is assigned to one of three owners:

| Owner | Test | Examples |
| --- | --- | --- |
| Shared semantic parameter | The behavior is meaningful on the existing primitive and repeats across products | `Flex` min-width zero, grow/shrink, full width/height; `Text` weight/tone; semantic spacing |
| Shared complex recipe | Multiple products have the same named structure and slot relationship | application shell, panel section, toolbar group, icon-only action |
| Local complex component | The structure or geometry expresses one product's chrome and should remain reusable only inside that product | Chuzz traffic lights, browser tab close relationship, 320px inspector, color-wheel petals; nofilter session controls; AgencyZero workspace tabs |

“Local” does not mean manually composed Tailwind. A Local complex component is an authored Layout library A inside the application's workspace. The library compiler B produces a private package C. Application source D imports that package by its package name, and the application compiler E resolves it exactly like `@pathscale/ui`:

```text
local Layout source A + library compiler B -> private workspace package C
@pathscale/ui C + local C + application D + application compiler E -> executable F
```

The application must not import raw Layout source, use a source alias, or fall back to handwritten class composition. Missing packages, exports, recipes, slots, or exact component names are compiler failures.

## Current counts

The first inventory covers 15 Solid applications that depend on `@pathscale/ui`, using the published `@pathscale/ui` manifest rather than recognizing component names from a hard-coded list.

| Application | Diagnostics | Main signal |
| --- | ---: | --- |
| Chuzz | 45 | 44 manual classes on known Layout components; almost all are product chrome |
| nofilter.io | 339 | 179 state compositions, 67 repeated layout signatures, 41 repeated typography signatures, 34 styled native controls |
| AgencyZero GUI | 215 | 124 state compositions, 37 direct layout utilities, and repeated dense typography/layout patterns |
| Full 15-application corpus | 3,805 | 2,008 layout utilities, 651 state compositions, 375 repeated layout signatures, 197 repeated typography signatures |

Counts are migration indicators, not a target to game. One semantic recipe can legitimately remove many warnings. A one-off geometry warning can remain until its Local complex component is designed.

## Decisions supported by the priority corpus

| Evidence | Decision |
| --- | --- |
| `flex-1 min-w-0` appears 18 times across AgencyZero and nofilter.io; standalone `min-w-0` appears 16 more times | Add a semantic min-width-zero axis to `Flex`; use it in shell and retained-panel recipes |
| `shrink-0` appears 14 times across AgencyZero and nofilter.io | Keep shrink as a first-class semantic `Flex` parameter and use it instead of manual classes |
| `flex items-center gap-2` appears 39 times across AgencyZero and nofilter.io | Existing `Flex` alignment/gap parameters are the correct primitive; migrate callers rather than add a new component for every row |
| Both products repeatedly combine grow, min-height zero, min-width zero, header/footer shrink, and a retained main region | Design a shared application-shell recipe after validating its exact slots in both products |
| AgencyZero and nofilter.io repeat bordered, padded surface sections but use product-specific tokens | Add semantic Surface padding/border/radius axes only where tokens can remain theme-owned; evaluate a shared section recipe separately |
| Dense semibold labels recur in AgencyZero and Chuzz; ordinary small labels recur heavily in nofilter.io | Prefer named Text roles/parameters. Do not expose arbitrary fractional Tailwind sizes as public API |
| Chuzz's 96px traffic-light clearance, 320px side panel, tab-close hover relationship, status strip, and color-wheel petal positions have no cross-product match | Implement these as Chuzz Local complex components, not `@pathscale/ui` parameters |
| nofilter session/studio controls and AgencyZero workspace/tab state have rich, different state machines | Keep their compound recipes local initially; extract a shared recipe only after slot and state semantics match |

This deliberately avoids prematurely sharing components because they both happen to contain a row, border, or button. Reuse requires the same semantic contract, not visual resemblance.

## Regenerating a local tracker

The detailed tracker is local analysis data and is not committed. Generate it from this repository with the system Bun:

```sh
/opt/homebrew/bin/bun scripts/inventory-applications.js \
  --code-root /Users/revenge/code \
  --ui-root /Users/revenge/code/chuzz/apps/chuzz/frontend/node_modules/@pathscale/ui \
  --priority agencyzero/apps/gui/frontend \
  --priority chuzz/apps/chuzz/frontend \
  --priority nofilter.io \
  --compact \
  --output /tmp/solid-layouts-application-pattern-inventory.json
```

The compact tracker stores counts and normalized repeated signatures without every diagnostic. Omit `--compact` for a local, line-by-line report. Normalization sorts class tokens so equivalent static signatures group together, while the original file and line remain in the full report. Only the resulting counts, decisions, and migration outcomes are documented in this repository.

## Chuzz implementation order

1. Add only the proven missing shared primitive axes to PathScale UI, one component per commit.
2. Create Chuzz's private Local complex component source package and explicit library-compiler output package.
3. Register both `@pathscale/ui` and the private Chuzz package with the application compiler.
4. Move Chuzz chrome source into the local package with `git mv` whenever an existing file changes ownership.
5. Port one named chrome component per commit, retaining application state and behavior in Chuzz while moving presentation and slot relationships into recipes.
6. Regenerate the private C package and reduce the porting inventory after each component.
7. Do not compile the Chuzz application as verification; the UI remains a manual verification step.
