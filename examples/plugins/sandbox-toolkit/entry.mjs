/** @typedef {import("@translunar/plugin-sdk").SandboxPluginV1} SandboxPluginV1 */
import { deterministicEcho } from "./lib/echo.mjs";

/** @type {SandboxPluginV1} */
const plugin = Object.freeze({
  async activate(context) {
    if (context.protocolVersion !== 1) throw new Error("unsupported protocol");
  },
  async invoke(request, host) {
    if (
      request.operation !== "filter.validate" &&
      request.operation !== "ai.action.invoke" &&
      request.operation !== "echo"
    ) {
      return {
        protocolVersion: 1,
        ok: false,
        error: {
          code: "plugin_sandbox_failed",
          message: "Unsupported operation.",
          retryable: false,
        },
      };
    }
    if (request.operation === "filter.validate") {
      const summary = host.call({
        protocolVersion: 1,
        requestId: "diagnostics-summary",
        method: "diagnostics.summary",
        params: { category: "summary" },
      });
      return {
        protocolVersion: 1,
        ok: true,
        output: {
          valid:
            summary.status === "ready" &&
            summary.contributionId === request.contributionId &&
            summary.operation === request.operation,
          findings: [],
        },
      };
    }
    if (request.operation === "ai.action.invoke") {
      const invocation = request.input;
      const selected = invocation.context.selectionText ?? "";
      const rewritten = selected
        .replaceAll("colour", "color")
        .replaceAll("organisation", "organization");
      return {
        protocolVersion: 1,
        ok: true,
        output: {
          protocolVersion: 1,
          invocationId: invocation.invocationId,
          proposal: { kind: "replaceSelection", text: rewritten },
          usage: {
            inputBytes: selected.length,
            outputBytes: rewritten.length,
            durationMs: 0,
          },
        },
      };
    }
    return {
      protocolVersion: 1,
      ok: true,
      output: deterministicEcho(request.input),
    };
  },
  async deactivate() {},
});

export default plugin;
