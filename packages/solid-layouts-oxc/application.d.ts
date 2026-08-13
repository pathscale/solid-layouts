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
export declare const FORMAT: "solid-layouts-library-v1";
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
