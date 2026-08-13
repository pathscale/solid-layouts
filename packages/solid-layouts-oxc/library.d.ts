export type SolidLayoutsLibraryOptions = {
  root?: string;
  config?: string;
};

export type LayoutManifest = {
  format: "solid-layouts-library-v1";
  package: string;
  version: string;
  components: Record<string, {
    entry: string;
    recipe: string;
    recipeExport: string;
    layout: string;
    layoutExport: string;
  }>;
};

export declare const FORMAT: "solid-layouts-library-v1";
export declare function compileLibrary(
  options?: SolidLayoutsLibraryOptions,
): {
  root: string;
  sourceRoot: string;
  outputRoot: string;
  manifest: LayoutManifest;
};
export declare function pluginSolidLayoutsLibrary(
  options?: SolidLayoutsLibraryOptions,
): { name: string; setup(api: unknown): void };
