import type {
  EngineMethod,
  EngineParams,
  EngineResult,
} from "@translunar/contracts";

export interface DesktopEngineError {
  code: string;
  message: string;
  data?: unknown;
}

export type DesktopEngineInvokeResponse<Result = unknown> =
  { ok: true; result: Result } | { ok: false; error: DesktopEngineError };

export interface DesktopApi {
  invoke<Method extends EngineMethod>(
    method: Method,
    params: EngineParams<Method>,
  ): Promise<EngineResult<Method>>;
  selectSourceDocument(): Promise<string | null>;
  selectSourceDocuments(): Promise<string[]>;
  selectSourceFolder(): Promise<string | null>;
  selectProjectArchive(): Promise<string | null>;
  selectProjectArchiveDestination(
    suggestedName: string,
  ): Promise<string | null>;
  selectExportPath(suggestedName: string): Promise<string | null>;
  selectInteropInput(kind: "review" | "table"): Promise<string | null>;
  selectTaskPackageInput(): Promise<string | null>;
  selectCorpusInput(): Promise<string | null>;
  selectPluginPackage(): Promise<string | null>;
  resolveDroppedPaths(files: readonly File[]): string[];
  restartEngine(): Promise<void>;
  setAiCredential(profileId: string, secret: string): Promise<void>;
  onEditorCommand(listener: (commandId: string) => void): () => void;
}
