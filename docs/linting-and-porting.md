# Layout linting and porting

`solid-layouts-lint` uses the same Rust/OXC parser and recipe model as the compiler. JavaScript only discovers files, resolves package manifests, and formats diagnostics.

## Library contract mode

Run from a Layout library whose root contains `layouts.library.json`:

```sh
solid-layouts-lint
```

Initial rules:

| Rule | Default severity |
| --- | --- |
| Recipe import, source, and export resolution | error |
| Static recipe shape | error |
| Required, unique, statically addressable slots | error |
| Rendered and declared slot sets must agree | error |
| Variant axes may target only declared slots | error |
| A name cannot be both a presentation prop and computed state | error |
| Legacy component-shaped Layout template | warning |
| Manual `class`, `className`, `twMerge`, or `clsx` in a Layout | warning |

There is no fallback for an error. The library compiler runs the same checks before generating source.

### Existing migrations

A repository with known debt can use a ratcheting baseline:

```json
{
  "mode": "source",
  "source": "src",
  "exports": ["Button"],
  "lint": {
    "baseline": "layouts.lint-baseline.json",
    "warningsAsErrors": false
  }
}
```

Create the baseline once:

```sh
solid-layouts-lint --update-baseline
```

Baseline diagnostics remain recorded but do not fail the command. A new diagnostic fails normally. Removing debt also makes the baseline stale and fails until it is regenerated, preventing removed patterns from silently returning.

## Application porting mode

Porting mode is advisory:

```sh
solid-layouts-lint --porting --layouts @pathscale/ui
```

It resolves the package's `solidLayouts` manifest and warns when application code passes `class` or `className` to an imported Layout component. Intrinsic HTML and components from unconfigured packages are not flagged. Aliases and compound calls such as `Card.Body` resolve through their imported public export.

The report is a migration inventory: each warning points to presentation that should become an existing semantic recipe parameter or motivate a new parameter. It never fails the application build.

Any number of Layout libraries can participate:

```sh
solid-layouts-lint --porting \
  --layouts @pathscale/ui \
  --layouts @acme/product-ui
```

No rule contains knowledge of `@pathscale/ui`. Package names and exact public Layout exports come from each package manifest.

## Biome integration

Biome continues to lint ordinary TypeScript. Run the two tools beside one another:

```json
{
  "scripts": {
    "lint:code": "biome lint --write",
    "lint:layouts": "solid-layouts-lint",
    "lint": "bun run lint:code && bun run lint:layouts"
  }
}
```

An application can initially expose porting advice separately:

```json
{
  "scripts": {
    "lint:layouts:porting": "solid-layouts-lint --porting --layouts @pathscale/ui"
  }
}
```

## User-owned recipes

The compiler is package-neutral. A user publishes their own recipes and Layouts with the same library config:

```json
{
  "mode": "source",
  "source": "src",
  "output": "dist",
  "exports": ["ProductCard", "CheckoutButton"]
}
```

Their application then configures both packages:

```ts
pluginSolidLayoutsApplication({
  layouts: ["@pathscale/ui", "@acme/product-ui"],
});
```

Each package supplies its own recipes, executable output, and manifest. The application compiler requires an exact match from the module import to that module's manifest.
