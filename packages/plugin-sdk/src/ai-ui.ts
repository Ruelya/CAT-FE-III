import type { PublicConfigSchemaV1, PublicJsonValue } from "./qa-pipeline.js";
import {
  validatePublicConfig,
  validatePublicConfigSchema,
  validatePublicJson,
} from "./qa-pipeline.js";

export const AI_ACTION_OPERATION_PROTOCOL_VERSION = 1 as const;
export const AI_ACTION_CONFIG_SCHEMA_VERSION = 1 as const;
export const UI_PANEL_CONTRACT_VERSION = 1 as const;
export const UI_PANEL_BRIDGE_VERSION = 1 as const;
export const AI_ACTION_OPERATION_INVOKE = "ai.action.invoke" as const;

export const AI_ACTION_LIMITS = Object.freeze({
  inputBytes: 1024 * 1024,
  outputBytes: 1024 * 1024,
  tags: 1_024,
  deadlineMs: 120_000,
  methods: 16,
} as const);

export type AiActionPlacementV1 = "editorSelection" | "assistantSidebar";
export type AiActionInputFieldV1 =
  | "selectionText"
  | "segmentText"
  | "sourceText"
  | "sourceLocale"
  | "targetLocale"
  | "tags";
export type AiActionResultModeV1 =
  "replaceSelection" | "replaceTarget" | "assistantContent";

export interface AiActionLimitsV1 {
  maxInputBytes: number;
  maxOutputBytes: number;
  maxTags: number;
  maxDeadlineMs: number;
}

export interface LegacyAiActionContributionDescriptor {
  kind: "aiAction";
  descriptorVersion: 1;
  id: string;
  version: string;
  displayName: string;
  label: string;
  placement: string;
  input: Record<string, unknown>;
  promptTemplate?: string;
  operationProtocolVersion?: undefined;
}

export interface AiActionContributionDescriptorV1 {
  kind: "aiAction";
  descriptorVersion: 1;
  operationProtocolVersion: 1;
  id: string;
  version: string;
  displayName: string;
  label: string;
  placement: AiActionPlacementV1;
  input: PublicJsonValue;
  promptTemplate?: string;
  inputFields: AiActionInputFieldV1[];
  resultModes: AiActionResultModeV1[];
  configSchemaVersion: 1;
  configSchema: PublicConfigSchemaV1;
  limits: AiActionLimitsV1;
}

export type AiActionContributionDescriptor =
  LegacyAiActionContributionDescriptor | AiActionContributionDescriptorV1;

export interface AiActionTagV1 {
  id: string;
  kind: string;
  start: number;
  end: number;
}

export interface AiActionContextV1 {
  selectionText?: string;
  segmentText: string;
  sourceText: string;
  sourceLocale: string;
  targetLocale: string;
  tags: AiActionTagV1[];
}

export interface AiActionInvocationV1 {
  protocolVersion: 1;
  invocationId: string;
  contributionId: string;
  operation: typeof AI_ACTION_OPERATION_INVOKE;
  context: AiActionContextV1;
  configSchemaVersion: 1;
  config: PublicJsonValue;
  deadlineMs: number;
}

export type AiActionProposalV1 =
  | { kind: "replaceSelection"; text: string }
  | { kind: "replaceTarget"; text: string }
  | { kind: "assistantContent"; content: string };

export interface AiActionUsageV1 {
  inputBytes: number;
  outputBytes: number;
  durationMs: number;
}

export interface AiActionResultV1 {
  protocolVersion: 1;
  invocationId: string;
  proposal: AiActionProposalV1;
  usage: AiActionUsageV1;
}

export type AiActionFailureCodeV1 =
  | "invalid_request"
  | "permission_denied"
  | "timeout"
  | "cancelled"
  | "invalid_result"
  | "host_failed"
  | "stale_activation"
  | "protocol_error"
  | "resource_limit";

export interface AiActionFailureV1 {
  protocolVersion: 1;
  invocationId: string;
  code: AiActionFailureCodeV1;
  message: string;
  retryable: boolean;
}

export type UiPanelPlacementV1 =
  "editorSidebar" | "assistantSidebar" | "bottomPanel";
export type UiPanelBridgeMethodV1 =
  "panelContext" | "activeSelection" | "projectContext" | "proposeReplacement";

export interface LegacyUiPanelContributionDescriptor {
  kind: "uiPanel";
  descriptorVersion: 1;
  id: string;
  version: string;
  displayName: string;
  label: string;
  placement: string;
  surface: string;
  bridgeVersion: number;
  contractVersion?: undefined;
}

export interface UiPanelContributionDescriptorV1 {
  kind: "uiPanel";
  descriptorVersion: 1;
  contractVersion: 1;
  id: string;
  version: string;
  displayName: string;
  label: string;
  placement: UiPanelPlacementV1;
  surface: string;
  bridgeVersion: 1;
  methods: UiPanelBridgeMethodV1[];
  order?: number;
}

export type UiPanelContributionDescriptor =
  LegacyUiPanelContributionDescriptor | UiPanelContributionDescriptorV1;

export function defaultAiActionLimits(): AiActionLimitsV1 {
  return {
    maxInputBytes: 256 * 1024,
    maxOutputBytes: 256 * 1024,
    maxTags: 256,
    maxDeadlineMs: 10_000,
  };
}

export function defineAiAction(
  contribution: Omit<
    AiActionContributionDescriptorV1,
    | "kind"
    | "descriptorVersion"
    | "operationProtocolVersion"
    | "configSchemaVersion"
  >,
): AiActionContributionDescriptorV1 {
  return {
    kind: "aiAction",
    descriptorVersion: 1,
    operationProtocolVersion: 1,
    configSchemaVersion: 1,
    ...contribution,
  };
}

export function defineUiPanel(
  contribution: Omit<
    UiPanelContributionDescriptorV1,
    "kind" | "descriptorVersion" | "contractVersion" | "bridgeVersion"
  >,
): UiPanelContributionDescriptorV1 {
  return {
    kind: "uiPanel",
    descriptorVersion: 1,
    contractVersion: 1,
    bridgeVersion: 1,
    ...contribution,
  };
}

export function validateAiActionDescriptor(
  descriptor: AiActionContributionDescriptor,
  tier: "declarative" | "sandbox" | "process",
): string[] {
  const errors: string[] = [];
  const strict = closedObject(
    descriptor,
    [
      "kind",
      "descriptorVersion",
      "operationProtocolVersion",
      "id",
      "version",
      "displayName",
      "label",
      "placement",
      "input",
      "promptTemplate",
      "inputFields",
      "resultModes",
      "configSchemaVersion",
      "configSchema",
      "limits",
    ],
    "AI action descriptor",
    errors,
  ) as AiActionContributionDescriptorV1 | undefined;
  if (!strict) return errors;
  if (tier !== "sandbox") errors.push("AI actions require the sandbox tier");
  if (strict.kind !== "aiAction") errors.push("kind must be aiAction");
  if (strict.descriptorVersion !== 1)
    errors.push("descriptorVersion must be 1");
  if (strict.operationProtocolVersion !== 1)
    errors.push("operationProtocolVersion must be 1");
  if (strict.configSchemaVersion !== 1)
    errors.push("configSchemaVersion must be 1");
  validateDescriptorText(strict.id, "id", 128, errors);
  validateDescriptorText(strict.version, "version", 128, errors);
  validateDescriptorText(strict.displayName, "displayName", 512, errors);
  validateDescriptorText(strict.label, "label", 256, errors);
  if (
    strict.promptTemplate !== undefined &&
    !isBoundedText(strict.promptTemplate, 16 * 1024)
  ) {
    errors.push("promptTemplate is malformed or oversized");
  }
  if (
    !(["editorSelection", "assistantSidebar"] as string[]).includes(
      strict.placement,
    )
  )
    errors.push("placement is unsupported");
  if (!isUniqueClosedSet(strict.inputFields, AI_ACTION_INPUT_FIELDS, 16))
    errors.push("inputFields must be a non-empty closed set");
  if (!isUniqueClosedSet(strict.resultModes, AI_ACTION_RESULT_MODES, 3))
    errors.push("resultModes must be a non-empty closed set");
  errors.push(...validatePublicConfigSchema(strict.configSchema));
  if (!validLimits(strict.limits)) errors.push("limits are invalid");
  if (!validatePublicJson(strict.input, 64 * 1024))
    errors.push("input descriptor is invalid");
  return errors;
}

export function validateAiActionInvocation(
  invocation: AiActionInvocationV1,
  descriptor: AiActionContributionDescriptorV1,
): string[] {
  const errors = validateAiActionDescriptor(descriptor, "sandbox");
  const strict = closedObject(
    invocation,
    [
      "protocolVersion",
      "invocationId",
      "contributionId",
      "operation",
      "context",
      "configSchemaVersion",
      "config",
      "deadlineMs",
    ],
    "AI action invocation",
    errors,
  ) as AiActionInvocationV1 | undefined;
  if (!strict) return errors;
  if (
    strict.protocolVersion !== 1 ||
    strict.operation !== AI_ACTION_OPERATION_INVOKE
  )
    errors.push("invocation protocol is incompatible");
  if (strict.configSchemaVersion !== 1)
    errors.push("invocation configSchemaVersion must be 1");
  validateDescriptorText(strict.invocationId, "invocationId", 128, errors);
  if (strict.contributionId !== descriptor.id)
    errors.push("contributionId does not match the descriptor");
  if (
    !Number.isSafeInteger(strict.deadlineMs) ||
    strict.deadlineMs < 1 ||
    strict.deadlineMs > descriptor.limits.maxDeadlineMs
  )
    errors.push("deadlineMs is outside descriptor limits");
  validateAiActionContext(strict.context, descriptor.limits, errors);
  if (!validatePublicJson(strict.context, descriptor.limits.maxInputBytes))
    errors.push("context is invalid");
  errors.push(...validatePublicConfig(strict.config, descriptor.configSchema));
  return errors;
}

export function validateAiActionResult(
  result: AiActionResultV1,
  invocation: AiActionInvocationV1,
  descriptor: AiActionContributionDescriptorV1,
): string[] {
  const errors: string[] = [];
  const strict = closedObject(
    result,
    ["protocolVersion", "invocationId", "proposal", "usage"],
    "AI action result",
    errors,
  ) as AiActionResultV1 | undefined;
  if (!strict) return errors;
  if (
    strict.protocolVersion !== 1 ||
    strict.invocationId !== invocation.invocationId
  )
    errors.push("result protocol is incompatible");
  validateAiActionProposal(strict.proposal, errors);
  if (!descriptor.resultModes.includes(strict.proposal.kind))
    errors.push("proposal mode was not declared");
  validateAiActionUsage(strict.usage, descriptor.limits, errors);
  if (!validatePublicJson(strict, descriptor.limits.maxOutputBytes))
    errors.push("result is invalid or oversized");
  return errors;
}

export function validateUiPanelDescriptor(
  descriptor: UiPanelContributionDescriptor,
  tier: "declarative" | "sandbox" | "process",
): string[] {
  const errors: string[] = [];
  const strict = closedObject(
    descriptor,
    [
      "kind",
      "descriptorVersion",
      "contractVersion",
      "id",
      "version",
      "displayName",
      "label",
      "placement",
      "surface",
      "bridgeVersion",
      "methods",
      "order",
    ],
    "UI panel descriptor",
    errors,
  ) as UiPanelContributionDescriptorV1 | undefined;
  if (!strict) return errors;
  if (tier !== "sandbox") errors.push("UI panels require the sandbox tier");
  if (strict.kind !== "uiPanel") errors.push("kind must be uiPanel");
  if (strict.descriptorVersion !== 1)
    errors.push("descriptorVersion must be 1");
  if (strict.contractVersion !== 1) errors.push("contractVersion must be 1");
  if (strict.bridgeVersion !== 1) errors.push("bridgeVersion must be 1");
  validateDescriptorText(strict.id, "id", 128, errors);
  validateDescriptorText(strict.version, "version", 128, errors);
  validateDescriptorText(strict.displayName, "displayName", 512, errors);
  validateDescriptorText(strict.label, "label", 256, errors);
  if (
    !(
      ["editorSidebar", "assistantSidebar", "bottomPanel"] as string[]
    ).includes(strict.placement)
  )
    errors.push("placement is unsupported");
  if (
    !/^(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))(?![A-Za-z]:).+\.html$/u.test(
      strict.surface,
    )
  )
    errors.push("surface must be a package-relative HTML path");
  if (
    !isUniqueClosedSet(
      strict.methods,
      UI_PANEL_METHODS,
      AI_ACTION_LIMITS.methods,
    )
  )
    errors.push("methods must be a non-empty closed set");
  if (!strict.methods?.includes("panelContext"))
    errors.push("methods must include panelContext");
  if (
    strict.order !== undefined &&
    (!Number.isSafeInteger(strict.order) ||
      strict.order < 0 ||
      strict.order > 1_000_000)
  ) {
    errors.push("order is invalid");
  }
  return errors;
}

const AI_ACTION_INPUT_FIELDS: readonly AiActionInputFieldV1[] = [
  "selectionText",
  "segmentText",
  "sourceText",
  "sourceLocale",
  "targetLocale",
  "tags",
];
const AI_ACTION_RESULT_MODES: readonly AiActionResultModeV1[] = [
  "replaceSelection",
  "replaceTarget",
  "assistantContent",
];
const UI_PANEL_METHODS: readonly UiPanelBridgeMethodV1[] = [
  "panelContext",
  "activeSelection",
  "projectContext",
  "proposeReplacement",
];

function isUniqueClosedSet<T extends string>(
  values: readonly T[] | undefined,
  allowed: readonly T[],
  maximum: number,
): boolean {
  return (
    !!values?.length &&
    values.length <= maximum &&
    new Set(values).size === values.length &&
    values.every((value) => allowed.includes(value))
  );
}

function validLimits(limits: AiActionLimitsV1 | undefined): boolean {
  return (
    !!limits &&
    Number.isSafeInteger(limits.maxInputBytes) &&
    limits.maxInputBytes > 0 &&
    limits.maxInputBytes <= AI_ACTION_LIMITS.inputBytes &&
    Number.isSafeInteger(limits.maxOutputBytes) &&
    limits.maxOutputBytes > 0 &&
    limits.maxOutputBytes <= AI_ACTION_LIMITS.outputBytes &&
    Number.isSafeInteger(limits.maxTags) &&
    limits.maxTags >= 0 &&
    limits.maxTags <= AI_ACTION_LIMITS.tags &&
    Number.isSafeInteger(limits.maxDeadlineMs) &&
    limits.maxDeadlineMs > 0 &&
    limits.maxDeadlineMs <= AI_ACTION_LIMITS.deadlineMs
  );
}

function closedObject(
  value: unknown,
  keys: readonly string[],
  label: string,
  errors: string[],
): Record<string, unknown> | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    errors.push(`${label} must be a plain object`);
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key))
      errors.push(`${label} contains unknown field ${key}`);
  }
  return record;
}

function validateDescriptorText(
  value: unknown,
  label: string,
  maxLength: number,
  errors: string[],
): void {
  if (!isBoundedText(value, maxLength))
    errors.push(`${label} is malformed or oversized`);
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function validateAiActionContext(
  value: unknown,
  limits: AiActionLimitsV1,
  errors: string[],
): void {
  const context = closedObject(
    value,
    [
      "selectionText",
      "segmentText",
      "sourceText",
      "sourceLocale",
      "targetLocale",
      "tags",
    ],
    "AI action context",
    errors,
  );
  if (!context) return;
  for (const key of [
    "segmentText",
    "sourceText",
    "sourceLocale",
    "targetLocale",
  ] as const) {
    if (typeof context[key] !== "string")
      errors.push(`context.${key} must be text`);
  }
  if (
    context.selectionText !== undefined &&
    typeof context.selectionText !== "string"
  )
    errors.push("context.selectionText must be text");
  if (!Array.isArray(context.tags) || context.tags.length > limits.maxTags) {
    errors.push("context contains too many tags");
    return;
  }
  for (const tag of context.tags) {
    const strictTag = closedObject(
      tag,
      ["id", "kind", "start", "end"],
      "context tag",
      errors,
    );
    if (!strictTag) continue;
    validateDescriptorText(strictTag.id, "context tag id", 128, errors);
    validateDescriptorText(strictTag.kind, "context tag kind", 128, errors);
    if (
      !Number.isSafeInteger(strictTag.start) ||
      (strictTag.start as number) < 0 ||
      (strictTag.start as number) > 0xffff_ffff
    )
      errors.push("context tag start is invalid");
    if (
      !Number.isSafeInteger(strictTag.end) ||
      !Number.isSafeInteger(strictTag.start) ||
      (strictTag.end as number) < (strictTag.start as number) ||
      (strictTag.end as number) > 0xffff_ffff
    ) {
      errors.push("context tag end is invalid");
    }
  }
}

function validateAiActionProposal(value: unknown, errors: string[]): void {
  const proposal = closedObject(
    value,
    ["kind", "text", "content"],
    "AI action proposal",
    errors,
  );
  if (!proposal) return;
  if (
    proposal.kind === "replaceSelection" ||
    proposal.kind === "replaceTarget"
  ) {
    if (!isBoundedText(proposal.text, AI_ACTION_LIMITS.outputBytes))
      errors.push("text proposal is malformed or oversized");
    if (proposal.content !== undefined)
      errors.push("text proposal contains unknown content");
    return;
  }
  if (proposal.kind === "assistantContent") {
    if (!isBoundedText(proposal.content, AI_ACTION_LIMITS.outputBytes))
      errors.push("assistant proposal is malformed or oversized");
    if (proposal.text !== undefined)
      errors.push("assistant proposal contains unknown text");
    return;
  }
  errors.push("proposal kind is unsupported");
}

function validateAiActionUsage(
  value: unknown,
  limits: AiActionLimitsV1,
  errors: string[],
): void {
  const usage = closedObject(
    value,
    ["inputBytes", "outputBytes", "durationMs"],
    "AI action usage",
    errors,
  );
  if (!usage) return;
  const bounds: Array<[keyof AiActionUsageV1, number]> = [
    ["inputBytes", limits.maxInputBytes],
    ["outputBytes", limits.maxOutputBytes],
    ["durationMs", limits.maxDeadlineMs],
  ];
  for (const [key, maximum] of bounds) {
    if (
      !Number.isSafeInteger(usage[key]) ||
      (usage[key] as number) < 0 ||
      (usage[key] as number) > maximum
    ) {
      errors.push(`usage.${key} is outside descriptor limits`);
    }
  }
}
