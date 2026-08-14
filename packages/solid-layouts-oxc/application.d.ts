import type { Diagnostic, LayoutSource, TransformResult } from "./index";

export type ApplicationLayoutSource = string | {
  module: string;
  root: string;
};

export type SolidLayoutsApplicationOptions = {
  root?: string;
  layouts?: ApplicationLayoutSource[];
  runtime?: string;
  include?: string;
  /**
   * Which major of Solid the build targets. Defaults to 1. Prefer
   * `pluginSolid2LayoutsApplication`, which sets it.
   */
  solid?: 1 | 2;
};

export type ResolvedLayoutSource = {
  module: string;
  exports: string[];
  resolved: string;
  publicEntry: string;
  packageRoot: string;
  packageJsonPath: string;
  manifestPath: string;
  manifest: unknown;
};

export type CompiledApplication = {
  root: string;
  sources: ResolvedLayoutSource[];
  layoutSources: LayoutSource[];
};

export declare const APPLICATION_BOUNDARY: "solid-layouts/application-boundary";
export declare const SOLID_2_APPLICATION_BOUNDARY: "solid-layouts/solid-2/application-boundary";
export declare function boundaryFor(solid?: 1 | 2): {
  specifier: string;
  subpath: "." | "./solid-2";
};
export declare const FORMAT: "solid-layouts-library-v2";
export declare function compileApplication(
  options?: SolidLayoutsApplicationOptions,
): CompiledApplication;
export declare function compileApplicationFile(
  source: string,
  filename: string,
  application: CompiledApplication,
): TransformResult & { diagnostics: Diagnostic[] };
export declare function resolveLayoutSource(
  root: string,
  configured: ApplicationLayoutSource,
): ResolvedLayoutSource;
export declare function pluginSolidLayoutsApplication(
  options?: SolidLayoutsApplicationOptions,
): { name: string; enforce: "post"; setup(api: unknown): void };
export declare function pluginSolid2LayoutsApplication(
  options?: Omit<SolidLayoutsApplicationOptions, "solid">,
): { name: string; enforce: "post"; setup(api: unknown): void };
