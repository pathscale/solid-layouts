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

export type ProjectFile = {
  filename: string;
  source: string;
};

export type ProjectDiagnostic = Diagnostic & {
  filename: string;
  rule: string;
  suggestion?: string;
};

export type ApplicationSource = {
  module: string;
  exports: string[];
};

export declare function transform(
  source: string,
  filename: string,
  options: TransformOptions,
): TransformResult;

export declare function lintProject(files: ProjectFile[]): ProjectDiagnostic[];
export declare function lintApplication(
  files: ProjectFile[],
  sources: ApplicationSource[],
): ProjectDiagnostic[];
