import { recipe } from "../recipe";

/**
 * One recipe exercising every shape the compiler has to handle: a bare-string
 * variant, a slot-keyed one, several slots, both a prop and a state axis, and
 * a slot with no base class.
 */
export const parity = recipe({
  component: "parity",
  element: "div",
  slots: {
    root: { base: "p" },
    icon: { base: "p__icon" },
    bare: {},
  },
  props: {
    tone: { neutral: "p--neutral", loud: "p--loud" },
    flush: { true: "p--flush" },
  },
  state: {
    open: { true: { root: "p--open", icon: "p__icon--open" } },
    busy: { true: "p--busy" },
  },
});
