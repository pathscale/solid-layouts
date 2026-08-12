export type CompilerMode = "library" | "application";

export type LayoutSource = {
  module: string;
  exports: string[];
  resolved?: string;
};

export type TransformOptions = {
  mode: CompilerMode;
  layoutSources?: LayoutSource[];
  parseOnly?: boolean;
};

export type Diagnostic = {
  severity: "warning" | "error";
  message: string;
  line: number;
  column: number;
};

export type TransformResult = {
  code: string;
  diagnostics: Diagnostic[];
  changed: boolean;
  failed: boolean;
};

export declare function transform(
  source: string,
  filename: string,
  options: TransformOptions,
): TransformResult;
