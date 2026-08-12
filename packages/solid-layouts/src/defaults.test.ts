import { afterEach, describe, expect, test } from "bun:test";
import { configureUI, globalDefaultsFor, resetUIConfig } from "./defaults";

afterEach(resetUIConfig);

describe("configureUI", () => {
  test("records defaults per component", () => {
    configureUI({ Button: { size: "lg" } });
    expect(globalDefaultsFor("Button")).toEqual({ size: "lg" });
  });

  test("two calls for different components do not clobber each other", () => {
    configureUI({ Button: { size: "lg" } });
    configureUI({ Accordion: { variant: "surface" } });
    expect(globalDefaultsFor("Button")).toEqual({ size: "lg" });
    expect(globalDefaultsFor("Accordion")).toEqual({ variant: "surface" });
  });

  test("a later call merges into the same component rather than replacing it", () => {
    configureUI({ Button: { size: "lg", color: "primary" } });
    configureUI({ Button: { size: "sm" } });
    expect(globalDefaultsFor("Button")).toEqual({
      size: "sm",
      color: "primary",
    });
  });

  test("an unconfigured component has no defaults", () => {
    expect(globalDefaultsFor("Nothing")).toBeUndefined();
  });
});
