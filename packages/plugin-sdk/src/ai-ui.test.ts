import { describe, expect, it } from "vitest";

import {
  defineAiAction,
  defineUiPanel,
  validateAiActionDescriptor,
  validateAiActionInvocation,
  validateAiActionResult,
  validateUiPanelDescriptor,
  type AiActionInputFieldV1,
  type AiActionInvocationV1,
  type AiActionResultV1,
  type UiPanelBridgeMethodV1,
} from "./index.js";

const action = defineAiAction({
  id: "example.terminology",
  version: "1.0.0",
  displayName: "Terminology rewrite",
  label: "Rewrite terminology",
  placement: "editorSelection",
  input: { type: "object" },
  inputFields: ["selectionText", "sourceLocale", "targetLocale"],
  resultModes: ["replaceSelection"],
  configSchema: { schemaVersion: 1, fields: [] },
  limits: {
    maxInputBytes: 256 * 1024,
    maxOutputBytes: 256 * 1024,
    maxTags: 256,
    maxDeadlineMs: 10_000,
  },
});

const invocation: AiActionInvocationV1 = {
  protocolVersion: 1,
  invocationId: "invoke-1",
  contributionId: action.id,
  operation: "ai.action.invoke",
  context: {
    selectionText: "colour",
    segmentText: "colour",
    sourceText: "colour",
    sourceLocale: "en-GB",
    targetLocale: "en-US",
    tags: [],
  },
  configSchemaVersion: 1,
  config: {},
  deadlineMs: 1_000,
};

describe("public AI action and panel V1 contracts", () => {
  it("builds a closed Tier 2 action and validates its proposal", () => {
    expect(validateAiActionDescriptor(action, "sandbox")).toEqual([]);
    expect(validateAiActionInvocation(invocation, action)).toEqual([]);
    const result: AiActionResultV1 = {
      protocolVersion: 1,
      invocationId: invocation.invocationId,
      proposal: { kind: "replaceSelection", text: "color" },
      usage: { inputBytes: 6, outputBytes: 5, durationMs: 4 },
    };
    expect(validateAiActionResult(result, invocation, action)).toEqual([]);
    expect(
      validateAiActionResult(
        {
          ...result,
          proposal: { kind: "assistantContent", content: "color" },
        },
        invocation,
        action,
      ),
    ).toContain("proposal mode was not declared");
  });

  it("rejects duplicate fields, unsupported placements, and bounds", () => {
    expect(
      validateAiActionDescriptor(
        {
          ...action,
          inputFields: [
            "selectionText",
            "selectionText",
          ] as AiActionInputFieldV1[],
        },
        "sandbox",
      ),
    ).toContain("inputFields must be a non-empty closed set");
    expect(validateAiActionDescriptor(action, "process")).toContain(
      "AI actions require the sandbox tier",
    );
    expect(
      validateAiActionInvocation(
        {
          ...invocation,
          deadlineMs: action.limits.maxDeadlineMs + 1,
        },
        action,
      ),
    ).toContain("deadlineMs is outside descriptor limits");
    expect(
      validateAiActionDescriptor(
        { ...action, unexpected: true } as unknown as typeof action,
        "sandbox",
      ),
    ).toContain("AI action descriptor contains unknown field unexpected");
    expect(
      validateAiActionInvocation(
        {
          ...invocation,
          configSchemaVersion: 2,
        } as unknown as AiActionInvocationV1,
        action,
      ),
    ).toContain("invocation configSchemaVersion must be 1");
    expect(
      validateAiActionDescriptor(
        { ...action, promptTemplate: "bad\ncontrol" },
        "sandbox",
      ),
    ).toContain("promptTemplate is malformed or oversized");
  });

  it("rejects malformed action results before a proposal can be accepted", () => {
    expect(
      validateAiActionResult(
        {
          protocolVersion: 1,
          invocationId: invocation.invocationId,
          proposal: {
            kind: "replaceSelection",
            text: "color",
            extra: true,
          } as unknown as AiActionResultV1["proposal"],
          usage: { inputBytes: 6, outputBytes: 5, durationMs: 4 },
        },
        invocation,
        action,
      ),
    ).toContain("AI action proposal contains unknown field extra");
    expect(
      validateAiActionResult(
        {
          protocolVersion: 1,
          invocationId: invocation.invocationId,
          proposal: { kind: "replaceSelection", text: "color" },
          usage: {
            inputBytes: 6,
            outputBytes: 5,
            durationMs: action.limits.maxDeadlineMs + 1,
          },
        },
        invocation,
        action,
      ),
    ).toContain("usage.durationMs is outside descriptor limits");
  });

  it("defines a versioned panel with a closed bridge method set", () => {
    const panel = defineUiPanel({
      id: "example.panel",
      version: "1.0.0",
      displayName: "Terminology",
      label: "Terminology",
      placement: "editorSidebar",
      surface: "panel/index.html",
      methods: ["panelContext", "activeSelection"],
      order: 10,
    });
    expect(validateUiPanelDescriptor(panel, "sandbox")).toEqual([]);
    expect(
      validateUiPanelDescriptor(
        { ...panel, surface: "../index.html" },
        "sandbox",
      ),
    ).toContain("surface must be a package-relative HTML path");
    expect(
      validateUiPanelDescriptor(
        {
          ...panel,
          methods: ["activeSelection"] as UiPanelBridgeMethodV1[],
        },
        "sandbox",
      ),
    ).toContain("methods must include panelContext");
    expect(
      validateUiPanelDescriptor({ ...panel, order: -1 }, "sandbox"),
    ).toContain("order is invalid");
  });
});
