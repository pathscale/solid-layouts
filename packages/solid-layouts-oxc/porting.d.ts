import type { ApplicationLayoutSource } from "./application";
import type { ProjectDiagnostic } from ".";

export type PortingOptions = {
  root?: string;
  include?: string;
  layouts?: ApplicationLayoutSource[];
};

export declare function lintPorting(options?: PortingOptions): {
  root: string;
  include: string;
  diagnostics: ProjectDiagnostic[];
  failed: false;
};
