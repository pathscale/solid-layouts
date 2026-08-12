# Porting a Vue app to Solid, with Layouts

This guide covers component design and migration decisions. For compiler setup and the required A+B→C, C+D+E→F build pipeline, read [Getting started](./getting-started.md) first.

For someone with a working Vue application deciding whether the port is
affordable. It is written around the two things that make it cheaper than it
looks: your component files keep their shape, and most of your components
already exist in `@pathscale/ui`.

## What transfers unchanged

The mental model. A Vue single-file component is a script block and a template
block, kept apart by the compiler. Layouts is the same division held by file
boundary instead:

```
Accordion.vue                    accordion/
  <script setup>   logic    →      accordion.ts           logic, no JSX
  <template>       markup   →      Accordion.layout.tsx    markup, no logic
                                   Accordion.recipe.ts     the class map
```

What does not transfer is Vue's reactivity being invisible. Solid's is
explicit, and that is the one genuinely new thing to learn. Everything else in
this document is renaming.

## The concept map

| Vue | Layouts | Note |
| --- | --- | --- |
| `<script setup>` | `foo.ts`, exporting `createFoo` | Returns accessors, not values |
| `<template>` | `Foo.layout.tsx` | Markup only. The build rejects state primitives in it |
| `defineProps<{...}>()` | `props` in the recipe | Presentation only. Behaviour props are the setup function's argument |
| `withDefaults(...)` | `Foo.defaults.ts` | Same shape an app writes in `configureUI` |
| `:class="{ 'is-x': x }"` | `state` / `props` in the recipe | Declared once instead of at each use |
| `<slot />` | `{children}` | |
| `<slot name="header" />` | a prop holding JSX | No machinery; a named slot is just a prop |
| `v-if` | `<Show when={}>` | |
| `v-for` | `<For each={}>` | |
| `@click` | `onClick` | |
| `ref` / `reactive` | `createSignal` / `createStore` | Read with `()` |
| `computed` | `createMemo` | |
| `watchEffect` | `createEffect` | |
| `provide` / `inject` | `createContext` / `useContext` | `provide:` in `defineComponent` does the wrapping |
| app-level component defaults | `configureUI({...})` | Plus `<UIDefaults>` for a subtree, which Vue has no equivalent for |

## A component, ported

Here is a real `vue3-ui` button, and the same component in Layouts.

### Before

```vue
<script setup lang="ts">
const props = withDefaults(defineProps<{
  type?: "is-primary" | "is-danger" | "is-light" | string
  size?: "is-small" | "is-medium" | "is-large"
  rounded?: boolean
  loading?: boolean
  outlined?: boolean
}>(), { type: "is-primary" })
</script>

<template>
  <component :is="computedTag" class="button"
    :class="[size, type, {
      'is-rounded':  rounded,
      'is-loading':  loading,
      'is-outlined': outlined,
    }]">
    <span v-if="label">{{ label }}</span>
    <slot />
  </component>
</template>
```

### After

Two files, and one of them is generated.

```ts
// Button.recipe.ts
import { recipe } from "solid-layouts";

export const button = recipe({
  component: "button",
  element: "button",
  slots: { root: { base: "button" } },
  props: {
    color: { primary: "is-primary", danger: "is-danger", light: "is-light" },
    size: { small: "is-small", medium: "is-medium", large: "is-large" },
    rounded: { true: "is-rounded" },
    outlined: { true: "is-outlined" },
  },
  state: { loading: { true: "is-loading" } },
});
```

```ts
// Button.defaults.ts
export default { Button: { color: "primary" } };
```

No layout file: the markup is one element, so the shared layout renders it from
`element`. No `index.ts` either; the generator writes it.

Three differences worth noticing, because they are the reasons to do this
rather than translate line by line.

**The union survives.** Vue's `type?: "is-primary" | ... | string` has a
`| string` escape hatch, so the moment anyone passes a computed string the
autocomplete and the checking are gone. `PropsOf<typeof button>` gives you
`color?: "primary" | "danger" | "light"` with no way out, and `class` remains
available for the genuine escape.

**`loading` moved from props to state.** In Vue it is a prop the caller sets.
Here it is computed by the logic, because a button that manages its own
pending state should not require its parent to track it. If yours really is
caller-set, leave it in `props`; the split is by where the value comes from,
not by what it looks like.

**The class map is not in the template.** That is the change people push back
on, and it is a real trade. Vue keeps the state-to-class binding visible where
it is used; this makes it declarative and reusable but one file away. The gain
is that `expanded` is stated once rather than at every element that reflects
it, and that the class and its `data-expanded` mirror cannot drift apart.

## Most of your components already exist

The port that matters is not component by component. Before writing a recipe,
check whether `@pathscale/ui` already has the thing.

Measured on `nofilter.io`, a SolidJS app already built on that library: of 1,579
`class="…"` literals, **half are exact duplicates of another**, and 830 sit on
raw `div`/`span`/`button` elements rather than on components. `class="my-6 h-px
bg-base-content/10"` appears ten times, which is `Separator`, re-implemented by
hand ten times. `class="flex items-center gap-2"` appears twenty-three times.

The lesson for a port: a Vue component that renders a styled box with a title
and a count is not a component you need to rewrite. It is `Card` plus `Chip`.
Roughly fifty recipes absorb a third of every styling decision in a real app of
that size, and most of the rest was never yours to write.

## What has no equivalent

Stated plainly so you can price it.

**No `<template>` block.** A layout is a function returning JSX. Destructuring
gets it close, but `<Show when={...}>` is not `v-if` and never will be.

**No scoped styles.** Vue's `<style scoped>` has no counterpart. Styling is a
sibling `.css` file with hand-written BEM, addressed through the `data-slot`
attributes every component emits.

**Reactivity is explicit.** `props.count` in a Vue template is a value; here
`p.count` is a value only because the runtime builds getters for you, and
anything you write yourself returns an accessor you call. Destructuring a
reactive value pins it, which is the single most common porting bug. The
two-parameter layout signature exists to make the safe half safe to
destructure and leave the rest visibly behind `p`.

**No `v-model`.** Controlled values are a `value` prop and an `onValueChange`
callback, which is more typing and less magic.

## A suggested order

1. Stand up the app shell and routing first. Get one page rendering.
2. Replace whole components with `@pathscale/ui` equivalents before writing any
   recipe. This is where most of the work disappears.
3. Port your genuinely custom components: recipe first, then logic, then a
   layout only if the markup is more than one element.
4. Set `configureUI` once, at the end, when you can see which defaults you have
   been repeating at call sites.

Wire the compiler with the first component, before moving application imports.
Authored `.layout.tsx` is template syntax and cannot be published or consumed
without the library pass; the generated package also requires the application
pass. Keeping that boundary working one component at a time prevents a large
port from accumulating hand-written generated code that later has to be removed.
