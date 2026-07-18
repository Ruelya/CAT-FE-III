export * from "./protocol.generated.js";

import type {
  RpcError as GeneratedRpcError,
  RpcMethodCatalog,
} from "./protocol.generated.js";

export type EngineMethod = keyof RpcMethodCatalog;
export type EngineParams<Method extends EngineMethod> =
  RpcMethodCatalog[Method]["params"];
export type EngineResult<Method extends EngineMethod> =
  RpcMethodCatalog[Method]["result"];

export interface RpcRequest<Method extends EngineMethod = EngineMethod> {
  jsonrpc: "2.0";
  id: number;
  method: Method;
  params: EngineParams<Method>;
}

export interface RpcFailure {
  jsonrpc: "2.0";
  id: number | null;
  error: GeneratedRpcError;
}

export interface RpcSuccess<Result = unknown> {
  jsonrpc: "2.0";
  id: number;
  result: Result;
}

export type RpcResponse<Result = unknown> = RpcSuccess<Result> | RpcFailure;

export const PROTOCOL_VERSION = 1;

export const ENGINE_METHODS = [
  "engine.initialize",
  "project.create",
  "project.get",
  "project.list",
  "project.update",
  "project.setLifecycle",
  "document.list",
  "document.get",
  "document.import",
  "document.importDocx",
  "segment.list",
  "segment.updateTarget",
  "segment.confirm",
  "tm.lookupExact",
  "tm.library.list",
  "tm.library.create",
  "tm.library.mount",
  "tm.library.unmount",
  "tm.search",
  "tm.concordance",
  "tm.import",
  "tm.export",
  "termbase.list",
  "termbase.create",
  "termbase.mount",
  "termbase.unmount",
  "term.search",
  "term.upsert",
  "termbase.import",
  "termbase.export",
  "qa.runDocument",
  "qa.list",
  "document.exportDocx",
  "document.export",
  "filter.list",
  "history.list",
  "data.checkHealth",
  "data.createBackup",
  "pipeline.step.list",
  "pipeline.create",
  "pipeline.list",
  "pipeline.get",
  "pipeline.validate",
  "pipeline.run",
  "pipeline.run.list",
  "pipeline.run.get",
  "pipeline.run.cancel",
  "pipeline.run.resume",
] as const satisfies readonly EngineMethod[];

type MissingEngineMethod = Exclude<
  EngineMethod,
  (typeof ENGINE_METHODS)[number]
>;
const allMethodsCovered: MissingEngineMethod extends never ? true : false =
  true;
void allMethodsCovered;
