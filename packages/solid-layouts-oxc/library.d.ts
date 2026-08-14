export type SolidLayoutsLibraryOptions = {
  root?: string;
  config?: string;
  source?: string;
  output?: string;
  check?: boolean;
  updateBaseline?: boolean;
  /**
   * Which major of Solid the emitted boundary import targets. Defaults to 1,
   * or to `solid` in `layouts.library.json`. Prefer
   * `pluginSolid2LayoutsLibrary`, which sets it.
   */
  solid?: 1 | 2;
};

export type LibraryDiagnostic = {
  filename: string;
  rule: string;
  severity: "warning" | "error";
  message: string;
  line: number;
  column: number;
  baseline?: boolean;
};

export type LayoutManifest = {
  format: "solid-layouts-library-v2";
  package: string;
  version: string;
  components: Record<string, {
    kind: "generated" | "embedded";
    entry?: string;
    recipe?: string;
    recipeExport?: string;
    layout?: string;
    layoutExport?: string;
  }>;
};

export declare const FORMAT: "solid-layouts-library-v2";
export declare function emitSourceManifest(
  options?: SolidLayoutsLibraryOptions,
): {
  root: string;
  outputRoot: string;
  manifest: LayoutManifest;
};
export declare function compileLibrary(
  options?: SolidLayoutsLibraryOptions,
): {
  root: string;
  sourceRoot: string;
  outputRoot: string;
  manifest: LayoutManifest;
};
export declare function generateLibrarySource(
  options?: SolidLayoutsLibraryOptions,
): {
  root: string;
  sourceRoot: string;
  diagnostics: LibraryDiagnostic[];
  failed: boolean;
  changed: number;
};
export declare function lintLibrary(
  options?: SolidLayoutsLibraryOptions,
): {
  root: string;
  sourceRoot: string;
  diagnostics: LibraryDiagnostic[];
  failed: boolean;
};
export declare function pluginSolidLayoutsLibrary(
  options?: SolidLayoutsLibraryOptions,
): { name: string; setup(api: unknown): void };
export declare function pluginSolid2LayoutsLibrary(
  options?: Omit<SolidLayoutsLibraryOptions, "solid">,
): { name: string; setup(api: unknown): void };
