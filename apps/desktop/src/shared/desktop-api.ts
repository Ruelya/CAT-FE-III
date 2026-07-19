import type {
  EngineMethod,
  EngineParams,
  EngineResult,
} from "@translunar/contracts";

export interface DesktopApi {
  invoke<Method extends EngineMethod>(
    method: Method,
    params: EngineParams<Method>,
  ): Promise<EngineResult<Method>>;
  selectSourceDocument(): Promise<string | null>;
  selectExportPath(suggestedName: string): Promise<string | null>;
  restartEngine(): Promise<void>;
}
