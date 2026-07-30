// src/qa-pipeline.ts
var PIPELINE_STEP_OPERATIONS_V1 = ["execute", "resume"];
var PUBLIC_CONTRIBUTION_LIMITS = Object.freeze({
  descriptorBytes: 64 * 1024,
  configBytes: 64 * 1024,
  checkpointBytes: 1024 * 1024,
  invocationBytes: 4 * 1024 * 1024,
  resultBytes: 8 * 1024 * 1024,
  jsonDepth: 16,
  jsonNodes: 65536,
  collectionItems: 4096,
  textBytes: 1024 * 1024,
  qaFindings: 1024,
  qaMessageBytes: 2048,
  qaEvidenceItems: 128,
  qaEvidenceTextBytes: 4096,
  qaRelatedSegments: 128,
  usageUnits: 1e9,
  deadlineMs: 12e4,
});
var QaRuleHandlerError = class extends Error {
  failure;
  constructor(failure) {
    const errors = validateQaRuleFailure(failure);
    if (errors.length > 0) {
      throw new TypeError(`invalid QA failure: ${errors.join("; ")}`);
    }
    super(failure.message);
    this.name = "QaRuleHandlerError";
    this.failure = failure;
  }
};
var PipelineStepHandlerError = class extends Error {
  failure;
  constructor(failure) {
    const errors = validatePipelineStepFailure(failure);
    if (errors.length > 0) {
      throw new TypeError(`invalid pipeline failure: ${errors.join("; ")}`);
    }
    super(failure.message);
    this.name = "PipelineStepHandlerError";
    this.failure = failure;
  }
};
var qaCategories = /* @__PURE__ */ new Set([
  "completeness",
  "numbers",
  "tags",
  "punctuation",
  "whitespace",
  "repetition",
  "length",
  "terminology",
  "consistency",
  "custom",
]);
var qaSeverities = /* @__PURE__ */ new Set(["error", "warning", "info"]);
var artifactKinds = /* @__PURE__ */ new Set([
  "none",
  "project",
  "document",
  "segments",
  "qaFindings",
  "json",
]);
function utf8Bytes(value) {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 127) {
      bytes += 1;
    } else if (codeUnit <= 2047) {
      bytes += 2;
    } else if (
      codeUnit >= 55296 &&
      codeUnit <= 56319 &&
      index + 1 < value.length
    ) {
      const next = value.charCodeAt(index + 1);
      if (next >= 56320 && next <= 57343) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}
function jsonBytes(value) {
  try {
    return utf8Bytes(JSON.stringify(value));
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
function strictObject(value, keys, label, errors) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    errors.push(`${label} must be a plain object`);
    return void 0;
  }
  const record2 = value;
  const allowed = new Set(keys);
  for (const key of Object.keys(record2)) {
    if (!allowed.has(key))
      errors.push(`${label} contains unknown field ${key}`);
  }
  return record2;
}
function boundaryString(value, label, maxBytes, errors) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    utf8Bytes(value) > maxBytes ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    errors.push(`${label} is empty, malformed, or oversized`);
    return false;
  }
  return true;
}
function boundaryId(value, label, errors) {
  if (!boundaryString(value, label, 128, errors)) return false;
  if (!/^[A-Za-z0-9._:-]+$/u.test(value)) {
    errors.push(`${label} contains unsupported characters`);
    return false;
  }
  return true;
}
function boundedInteger(value, min, max, label, errors) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    errors.push(`${label} must be an integer between ${min} and ${max}`);
    return false;
  }
  return true;
}
function validatePublicJson(
  value,
  maxBytes = PUBLIC_CONTRIBUTION_LIMITS.resultBytes,
) {
  let nodes = 0;
  const stack = /* @__PURE__ */ new Set();
  const walk = (candidate, depth) => {
    nodes += 1;
    if (
      nodes > PUBLIC_CONTRIBUTION_LIMITS.jsonNodes ||
      depth > PUBLIC_CONTRIBUTION_LIMITS.jsonDepth
    ) {
      return false;
    }
    if (
      candidate === null ||
      typeof candidate === "boolean" ||
      typeof candidate === "string"
    ) {
      return (
        typeof candidate !== "string" ||
        utf8Bytes(candidate) <= PUBLIC_CONTRIBUTION_LIMITS.textBytes
      );
    }
    if (typeof candidate === "number") return Number.isFinite(candidate);
    if (typeof candidate !== "object" || stack.has(candidate)) return false;
    stack.add(candidate);
    if (Array.isArray(candidate)) {
      const valid2 =
        candidate.length <= PUBLIC_CONTRIBUTION_LIMITS.collectionItems &&
        candidate.every((item) => walk(item, depth + 1));
      stack.delete(candidate);
      return valid2;
    }
    if (Object.getPrototypeOf(candidate) !== Object.prototype) {
      stack.delete(candidate);
      return false;
    }
    const entries = Object.entries(candidate);
    const valid =
      entries.length <= PUBLIC_CONTRIBUTION_LIMITS.collectionItems &&
      entries.every(
        ([key, item]) =>
          utf8Bytes(key) <= 256 &&
          !/[\u0000-\u001f\u007f]/u.test(key) &&
          walk(item, depth + 1),
      );
    stack.delete(candidate);
    return valid;
  };
  return walk(value, 0) && jsonBytes(value) <= maxBytes;
}
function defaultQaRuleLimits() {
  return {
    maxFindings: 256,
    maxMessageBytes: 1024,
    maxEvidenceItems: 64,
    maxRelatedSegmentIds: 32,
    maxDeadlineMs: 2e3,
  };
}
function defaultPipelineStepLimits() {
  return {
    maxInputBytes: 1024 * 1024,
    maxOutputBytes: 1024 * 1024,
    maxConfigBytes: PUBLIC_CONTRIBUTION_LIMITS.configBytes,
    maxCheckpointBytes: PUBLIC_CONTRIBUTION_LIMITS.checkpointBytes,
    maxDeadlineMs: 3e4,
  };
}
function defineQaRule(descriptor) {
  const result = {
    ...descriptor,
    kind: "qaRule",
    descriptorVersion: 1,
    operationProtocolVersion: 1,
    ruleType: "mechanical",
    definition: {},
    ruleKind: "mechanical",
    configSchemaVersion: 1,
    limits: descriptor.limits ?? defaultQaRuleLimits(),
  };
  const errors = validateQaRuleDescriptor(result);
  if (errors.length > 0)
    throw new TypeError(`invalid QA descriptor: ${errors.join("; ")}`);
  return result;
}
function definePipelineStep(descriptor) {
  const result = {
    ...descriptor,
    kind: "pipelineStep",
    descriptorVersion: 1,
    operationProtocolVersion: 1,
    configSchemaVersion: 1,
    cancellable: true,
    limits: descriptor.limits ?? defaultPipelineStepLimits(),
  };
  const errors = validatePipelineStepDescriptor(result);
  if (errors.length > 0) {
    throw new TypeError(`invalid pipeline descriptor: ${errors.join("; ")}`);
  }
  return result;
}
function validatePublicConfigSchema(value) {
  const errors = [];
  const schema = strictObject(
    value,
    ["schemaVersion", "fields"],
    "config schema",
    errors,
  );
  if (schema?.schemaVersion !== 1)
    errors.push("config schemaVersion must be 1");
  if (!Array.isArray(schema?.fields) || schema.fields.length > 128) {
    errors.push(
      "config schema fields must be an array with at most 128 entries",
    );
    return errors;
  }
  const keys = /* @__PURE__ */ new Set();
  schema.fields.forEach((candidate, index) => {
    const field = strictObject(
      candidate,
      [
        "key",
        "label",
        "fieldType",
        "required",
        "defaultValue",
        "min",
        "max",
        "options",
      ],
      `config field ${index}`,
      errors,
    );
    if (!field) return;
    if (boundaryId(field.key, `config field ${index} key`, errors)) {
      if (keys.has(field.key))
        errors.push(`config field ${field.key} is duplicated`);
      keys.add(field.key);
    }
    boundaryString(field.label, `config field ${index} label`, 256, errors);
    if (
      !["text", "boolean", "integer", "number", "select", "json"].includes(
        String(field.fieldType),
      )
    ) {
      errors.push(`config field ${index} fieldType is unsupported`);
    }
    if (typeof field.required !== "boolean")
      errors.push(`config field ${index} required must be boolean`);
    if (field.min !== void 0 && !Number.isSafeInteger(field.min))
      errors.push(`config field ${index} min must be an integer`);
    if (field.max !== void 0 && !Number.isSafeInteger(field.max))
      errors.push(`config field ${index} max must be an integer`);
    if (
      typeof field.min === "number" &&
      typeof field.max === "number" &&
      field.min > field.max
    ) {
      errors.push(`config field ${index} range is invalid`);
    }
    const options = field.options ?? [];
    if (!Array.isArray(options) || options.length > 128) {
      errors.push(`config field ${index} options are invalid`);
    } else {
      const optionValues = /* @__PURE__ */ new Set();
      for (const [optionIndex, candidateOption] of options.entries()) {
        const option = strictObject(
          candidateOption,
          ["value", "label"],
          `config option ${optionIndex}`,
          errors,
        );
        if (option) {
          boundaryString(option.value, "config option value", 256, errors);
          boundaryString(option.label, "config option label", 256, errors);
          if (typeof option.value === "string") {
            if (optionValues.has(option.value))
              errors.push(`config field ${index} has duplicate option values`);
            optionValues.add(option.value);
          }
        }
      }
    }
    if (
      (field.fieldType === "select") !==
      (Array.isArray(options) && options.length > 0)
    ) {
      errors.push(`config field ${index} select/options contract is invalid`);
    }
    if (
      field.defaultValue !== void 0 &&
      !validatePublicJson(
        field.defaultValue,
        PUBLIC_CONTRIBUTION_LIMITS.configBytes,
      )
    ) {
      errors.push(`config field ${index} defaultValue is invalid`);
    } else if (
      field.defaultValue !== void 0 &&
      !configFieldAccepts(field, field.defaultValue)
    ) {
      errors.push(
        `config field ${index} defaultValue does not match fieldType`,
      );
    }
  });
  if (jsonBytes(value) > PUBLIC_CONTRIBUTION_LIMITS.descriptorBytes)
    errors.push("config schema is oversized");
  return errors;
}
function configFieldAccepts(field, value) {
  switch (field.fieldType) {
    case "text":
      return typeof value === "string" && utf8Bytes(value) <= 16 * 1024;
    case "select":
      return (
        typeof value === "string" &&
        (field.options ?? []).some((option) => option.value === value)
      );
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return (
        Number.isSafeInteger(value) &&
        (field.min === void 0 || value >= field.min) &&
        (field.max === void 0 || value <= field.max)
      );
    case "number":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        (field.min === void 0 || value >= field.min) &&
        (field.max === void 0 || value <= field.max)
      );
    case "json":
      return validatePublicJson(value, PUBLIC_CONTRIBUTION_LIMITS.configBytes);
  }
}
function validatePublicConfig(value, schema) {
  const errors = validatePublicConfigSchema(schema);
  const config = strictObject(
    value,
    schema.fields.map((field) => field.key),
    "config",
    errors,
  );
  if (!config || jsonBytes(value) > PUBLIC_CONTRIBUTION_LIMITS.configBytes) {
    if (jsonBytes(value) > PUBLIC_CONTRIBUTION_LIMITS.configBytes)
      errors.push("config is oversized");
    return errors;
  }
  for (const field of schema.fields) {
    const candidate = config[field.key];
    if (candidate === void 0) {
      if (field.required && field.defaultValue === void 0)
        errors.push(`config is missing required field ${field.key}`);
    } else if (!configFieldAccepts(field, candidate)) {
      errors.push(`config field ${field.key} has an invalid value`);
    }
  }
  return errors;
}
function validateUsage(value, errors) {
  const usage = strictObject(
    value,
    ["workUnits", "inputBytes", "outputBytes"],
    "usage",
    errors,
  );
  if (!usage) return;
  boundedInteger(
    usage.workUnits,
    0,
    PUBLIC_CONTRIBUTION_LIMITS.usageUnits,
    "usage workUnits",
    errors,
  );
  boundedInteger(
    usage.inputBytes,
    0,
    PUBLIC_CONTRIBUTION_LIMITS.invocationBytes,
    "usage inputBytes",
    errors,
  );
  boundedInteger(
    usage.outputBytes,
    0,
    PUBLIC_CONTRIBUTION_LIMITS.resultBytes,
    "usage outputBytes",
    errors,
  );
}
function validateQaRuleDescriptor(value) {
  const errors = [];
  const descriptor = strictObject(
    value,
    [
      "kind",
      "descriptorVersion",
      "operationProtocolVersion",
      "id",
      "version",
      "displayName",
      "ruleType",
      "severity",
      "definition",
      "ruleKind",
      "categories",
      "configSchemaVersion",
      "configSchema",
      "limits",
      "config",
    ],
    "QA descriptor",
    errors,
  );
  if (!descriptor) return errors;
  if (
    descriptor.kind !== "qaRule" ||
    descriptor.descriptorVersion !== 1 ||
    descriptor.operationProtocolVersion !== 1 ||
    descriptor.ruleType !== "mechanical" ||
    descriptor.ruleKind !== "mechanical" ||
    descriptor.configSchemaVersion !== 1
  ) {
    errors.push(
      "QA descriptor versions and kinds must use the closed V1 contract",
    );
  }
  boundaryId(descriptor.id, "QA id", errors);
  boundaryString(descriptor.version, "QA version", 128, errors);
  boundaryString(descriptor.displayName, "QA displayName", 256, errors);
  if (!qaSeverities.has(String(descriptor.severity)))
    errors.push("QA severity is unsupported");
  if (
    !Array.isArray(descriptor.categories) ||
    descriptor.categories.length === 0 ||
    descriptor.categories.length > 256 ||
    descriptor.categories.some(
      (category) => !qaCategories.has(String(category)),
    )
  )
    errors.push("QA categories are invalid");
  else if (
    descriptor.categories.some(
      (category, index, values) =>
        index > 0 && String(values[index - 1]) >= String(category),
    )
  )
    errors.push("QA categories must be unique and deterministically ordered");
  if (
    typeof descriptor.definition !== "object" ||
    descriptor.definition === null ||
    Array.isArray(descriptor.definition) ||
    Object.keys(descriptor.definition).length !== 0
  )
    errors.push("QA definition must be the closed empty V1 object");
  errors.push(...validatePublicConfigSchema(descriptor.configSchema));
  if (descriptor.config !== void 0 && descriptor.configSchema)
    errors.push(
      ...validatePublicConfig(descriptor.config, descriptor.configSchema),
    );
  const limits = strictObject(
    descriptor.limits,
    [
      "maxFindings",
      "maxMessageBytes",
      "maxEvidenceItems",
      "maxRelatedSegmentIds",
      "maxDeadlineMs",
    ],
    "QA limits",
    errors,
  );
  if (limits) {
    boundedInteger(
      limits.maxFindings,
      1,
      PUBLIC_CONTRIBUTION_LIMITS.qaFindings,
      "QA maxFindings",
      errors,
    );
    boundedInteger(
      limits.maxMessageBytes,
      1,
      PUBLIC_CONTRIBUTION_LIMITS.qaMessageBytes,
      "QA maxMessageBytes",
      errors,
    );
    boundedInteger(
      limits.maxEvidenceItems,
      1,
      PUBLIC_CONTRIBUTION_LIMITS.qaEvidenceItems,
      "QA maxEvidenceItems",
      errors,
    );
    boundedInteger(
      limits.maxRelatedSegmentIds,
      0,
      PUBLIC_CONTRIBUTION_LIMITS.qaRelatedSegments,
      "QA maxRelatedSegmentIds",
      errors,
    );
    boundedInteger(
      limits.maxDeadlineMs,
      1,
      PUBLIC_CONTRIBUTION_LIMITS.deadlineMs,
      "QA maxDeadlineMs",
      errors,
    );
  }
  if (jsonBytes(value) > PUBLIC_CONTRIBUTION_LIMITS.descriptorBytes)
    errors.push("QA descriptor is oversized");
  return errors;
}
function validatePipelineStepDescriptor(value) {
  const errors = [];
  const descriptor = strictObject(
    value,
    [
      "kind",
      "descriptorVersion",
      "operationProtocolVersion",
      "id",
      "version",
      "displayName",
      "input",
      "output",
      "configSchemaVersion",
      "configSchema",
      "resumable",
      "cancellable",
      "checkpointSchemaVersion",
      "limits",
    ],
    "pipeline descriptor",
    errors,
  );
  if (!descriptor) return errors;
  if (
    descriptor.kind !== "pipelineStep" ||
    descriptor.descriptorVersion !== 1 ||
    descriptor.operationProtocolVersion !== 1 ||
    descriptor.configSchemaVersion !== 1 ||
    descriptor.cancellable !== true
  )
    errors.push(
      "pipeline descriptor versions and flags must use the closed V1 contract",
    );
  boundaryId(descriptor.id, "pipeline id", errors);
  boundaryString(descriptor.version, "pipeline version", 128, errors);
  boundaryString(descriptor.displayName, "pipeline displayName", 256, errors);
  if (
    !artifactKinds.has(String(descriptor.input)) ||
    descriptor.input === "none"
  )
    errors.push("pipeline input artifact kind is invalid");
  if (
    !artifactKinds.has(String(descriptor.output)) ||
    descriptor.output === "none"
  )
    errors.push("pipeline output artifact kind is invalid");
  if (typeof descriptor.resumable !== "boolean")
    errors.push("pipeline resumable must be boolean");
  if (
    descriptor.resumable === true
      ? descriptor.checkpointSchemaVersion !== 1
      : descriptor.checkpointSchemaVersion !== void 0
  )
    errors.push("pipeline checkpoint schema must be 1 exactly when resumable");
  errors.push(...validatePublicConfigSchema(descriptor.configSchema));
  const limits = strictObject(
    descriptor.limits,
    [
      "maxInputBytes",
      "maxOutputBytes",
      "maxConfigBytes",
      "maxCheckpointBytes",
      "maxDeadlineMs",
    ],
    "pipeline limits",
    errors,
  );
  if (limits) {
    boundedInteger(
      limits.maxInputBytes,
      1,
      PUBLIC_CONTRIBUTION_LIMITS.invocationBytes,
      "pipeline maxInputBytes",
      errors,
    );
    boundedInteger(
      limits.maxOutputBytes,
      1,
      PUBLIC_CONTRIBUTION_LIMITS.resultBytes,
      "pipeline maxOutputBytes",
      errors,
    );
    boundedInteger(
      limits.maxConfigBytes,
      1,
      PUBLIC_CONTRIBUTION_LIMITS.configBytes,
      "pipeline maxConfigBytes",
      errors,
    );
    boundedInteger(
      limits.maxCheckpointBytes,
      0,
      PUBLIC_CONTRIBUTION_LIMITS.checkpointBytes,
      "pipeline maxCheckpointBytes",
      errors,
    );
    boundedInteger(
      limits.maxDeadlineMs,
      1,
      PUBLIC_CONTRIBUTION_LIMITS.deadlineMs,
      "pipeline maxDeadlineMs",
      errors,
    );
  }
  if (jsonBytes(value) > PUBLIC_CONTRIBUTION_LIMITS.descriptorBytes)
    errors.push("pipeline descriptor is oversized");
  return errors;
}
function validateInvocationCommon(record2, protocol, errors) {
  if (record2.protocolVersion !== protocol)
    errors.push("invocation protocolVersion is unsupported");
  boundaryId(record2.invocationId, "invocationId", errors);
  boundaryId(record2.contributionId, "contributionId", errors);
  boundedInteger(
    record2.deadlineMs,
    1,
    PUBLIC_CONTRIBUTION_LIMITS.deadlineMs,
    "deadlineMs",
    errors,
  );
}
function validateQaRuleInvocation(value, descriptor) {
  const errors = [];
  const invocation = strictObject(
    value,
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
    "QA invocation",
    errors,
  );
  if (!invocation) return errors;
  validateInvocationCommon(invocation, 1, errors);
  if (
    invocation.operation !== "evaluateSegment" ||
    invocation.contributionId !== descriptor.id ||
    invocation.configSchemaVersion !== descriptor.configSchemaVersion
  )
    errors.push(
      "QA invocation operation, contribution, or config version does not match",
    );
  if (
    typeof invocation.deadlineMs === "number" &&
    invocation.deadlineMs > descriptor.limits.maxDeadlineMs
  )
    errors.push("QA invocation deadline exceeds descriptor limit");
  errors.push(
    ...validatePublicConfig(invocation.config, descriptor.configSchema),
  );
  const context = strictObject(
    invocation.context,
    [
      "projectId",
      "documentId",
      "segmentId",
      "ordinal",
      "structuralPath",
      "sourceLocale",
      "targetLocale",
      "sourceText",
      "targetText",
      "tagFindings",
      "termExpectations",
    ],
    "QA context",
    errors,
  );
  if (context) {
    boundaryId(context.projectId, "QA projectId", errors);
    boundaryId(context.documentId, "QA documentId", errors);
    boundaryId(context.segmentId, "QA segmentId", errors);
    boundedInteger(
      context.ordinal,
      0,
      Number.MAX_SAFE_INTEGER,
      "QA ordinal",
      errors,
    );
    boundaryString(context.structuralPath, "QA structuralPath", 4096, errors);
    boundaryString(context.sourceLocale, "QA sourceLocale", 64, errors);
    boundaryString(context.targetLocale, "QA targetLocale", 64, errors);
    if (
      typeof context.sourceText !== "string" ||
      utf8Bytes(context.sourceText) > PUBLIC_CONTRIBUTION_LIMITS.textBytes ||
      typeof context.targetText !== "string" ||
      utf8Bytes(context.targetText) > PUBLIC_CONTRIBUTION_LIMITS.textBytes
    )
      errors.push("QA source/target text exceeds public bounds");
    if (
      !Array.isArray(context.tagFindings) ||
      context.tagFindings.length > PUBLIC_CONTRIBUTION_LIMITS.qaEvidenceItems
    ) {
      errors.push("QA tag findings are invalid");
    } else {
      context.tagFindings.forEach((candidate, index) => {
        const finding = strictObject(
          candidate,
          ["code", "message"],
          `QA tag finding ${index}`,
          errors,
        );
        if (finding) {
          boundaryId(finding.code, `QA tag finding ${index} code`, errors);
          boundaryString(
            finding.message,
            `QA tag finding ${index} message`,
            PUBLIC_CONTRIBUTION_LIMITS.qaEvidenceTextBytes,
            errors,
          );
        }
      });
    }
    if (
      !Array.isArray(context.termExpectations) ||
      context.termExpectations.length >
        PUBLIC_CONTRIBUTION_LIMITS.qaEvidenceItems
    ) {
      errors.push("QA term expectations are invalid");
    } else {
      context.termExpectations.forEach((candidate, index) => {
        const term = strictObject(
          candidate,
          ["id", "source", "expectedTargets", "forbiddenTargets"],
          `QA term expectation ${index}`,
          errors,
        );
        if (!term) return;
        boundaryId(term.id, `QA term expectation ${index} id`, errors);
        boundaryString(
          term.source,
          `QA term expectation ${index} source`,
          PUBLIC_CONTRIBUTION_LIMITS.qaEvidenceTextBytes,
          errors,
        );
        for (const key of ["expectedTargets", "forbiddenTargets"]) {
          const values = term[key];
          if (
            !Array.isArray(values) ||
            values.length > PUBLIC_CONTRIBUTION_LIMITS.qaEvidenceItems ||
            values.some(
              (item) =>
                typeof item !== "string" ||
                utf8Bytes(item) >
                  PUBLIC_CONTRIBUTION_LIMITS.qaEvidenceTextBytes,
            )
          ) {
            errors.push(`QA term expectation ${index} ${key} is invalid`);
          }
        }
      });
    }
  }
  if (jsonBytes(value) > PUBLIC_CONTRIBUTION_LIMITS.invocationBytes)
    errors.push("QA invocation is oversized");
  return errors;
}
function validateQaRuleResult(value, invocation, descriptor) {
  const errors = [];
  const result = strictObject(
    value,
    ["protocolVersion", "findings", "usage"],
    "QA result",
    errors,
  );
  if (!result) return errors;
  if (result.protocolVersion !== 1)
    errors.push("QA result protocolVersion must be 1");
  validateUsage(result.usage, errors);
  if (
    !Array.isArray(result.findings) ||
    result.findings.length > descriptor.limits.maxFindings
  ) {
    errors.push("QA findings exceed descriptor bounds");
    return errors;
  }
  const sourceLength = [...invocation.context.sourceText].length;
  const targetLength = [...invocation.context.targetText].length;
  let previous = "";
  const identities = /* @__PURE__ */ new Set();
  for (const [index, candidate] of result.findings.entries()) {
    const finding = strictObject(
      candidate,
      [
        "ruleId",
        "category",
        "severity",
        "message",
        "fingerprint",
        "spans",
        "evidence",
        "relatedSegmentIds",
      ],
      `QA finding ${index}`,
      errors,
    );
    if (!finding) continue;
    boundaryId(finding.ruleId, `QA finding ${index} ruleId`, errors);
    if (!qaCategories.has(String(finding.category)))
      errors.push(`QA finding ${index} category is unsupported`);
    if (!qaSeverities.has(String(finding.severity)))
      errors.push(`QA finding ${index} severity is unsupported`);
    boundaryString(
      finding.message,
      `QA finding ${index} message`,
      descriptor.limits.maxMessageBytes,
      errors,
    );
    boundaryString(
      finding.fingerprint,
      `QA finding ${index} fingerprint`,
      256,
      errors,
    );
    const identity = `${String(finding.ruleId)}\0${String(finding.fingerprint)}`;
    if (identities.has(identity))
      errors.push("QA result contains duplicate findings");
    identities.add(identity);
    if (identity <= previous)
      errors.push("QA findings are not deterministically ordered");
    previous = identity;
    if (
      !Array.isArray(finding.spans) ||
      finding.spans.length > descriptor.limits.maxEvidenceItems
    )
      errors.push(`QA finding ${index} spans are invalid`);
    else {
      let priorSpan = "";
      for (const [spanIndex, candidateSpan] of finding.spans.entries()) {
        const span = strictObject(
          candidateSpan,
          ["field", "start", "end"],
          `QA span ${spanIndex}`,
          errors,
        );
        if (!span) continue;
        const limit =
          span.field === "source"
            ? sourceLength
            : span.field === "target"
              ? targetLength
              : -1;
        if (
          limit < 0 ||
          !Number.isSafeInteger(span.start) ||
          !Number.isSafeInteger(span.end) ||
          span.start < 0 ||
          span.end <= span.start ||
          span.end > limit
        )
          errors.push(`QA span ${spanIndex} is outside the segment`);
        const spanKey = `${String(span.field)}:${String(span.start).padStart(10, "0")}:${String(span.end).padStart(10, "0")}`;
        if (spanKey <= priorSpan)
          errors.push("QA spans are not deterministically ordered");
        priorSpan = spanKey;
      }
    }
    if (
      !Array.isArray(finding.evidence) ||
      finding.evidence.length > descriptor.limits.maxEvidenceItems ||
      finding.evidence.some(
        (item) =>
          typeof item !== "string" ||
          utf8Bytes(item) > PUBLIC_CONTRIBUTION_LIMITS.qaEvidenceTextBytes,
      )
    )
      errors.push(`QA finding ${index} evidence is invalid`);
    if (
      !Array.isArray(finding.relatedSegmentIds) ||
      finding.relatedSegmentIds.length >
        descriptor.limits.maxRelatedSegmentIds ||
      finding.relatedSegmentIds.some(
        (item) => typeof item !== "string" || !/^[A-Za-z0-9._:-]+$/u.test(item),
      )
    )
      errors.push(`QA finding ${index} related segment IDs are invalid`);
    else if (
      finding.relatedSegmentIds.some(
        (item, itemIndex, values) =>
          itemIndex > 0 && String(values[itemIndex - 1]) >= String(item),
      )
    )
      errors.push("QA related segment IDs are not deterministically ordered");
  }
  if (jsonBytes(value) > PUBLIC_CONTRIBUTION_LIMITS.resultBytes)
    errors.push("QA result is oversized");
  return errors;
}
function validatePipelineArtifact(value, expected, maxBytes, label, errors) {
  const artifact = strictObject(value, ["kind", "value"], label, errors);
  if (!artifact) return;
  if (artifact.kind !== expected)
    errors.push(`${label} kind does not match descriptor`);
  if (!validatePublicJson(artifact.value, maxBytes))
    errors.push(`${label} value is invalid or oversized`);
}
function validatePipelineStepInvocation(value, descriptor) {
  const errors = [];
  const invocation = strictObject(
    value,
    [
      "protocolVersion",
      "invocationId",
      "contributionId",
      "operation",
      "runId",
      "projectId",
      "documentId",
      "input",
      "configSchemaVersion",
      "config",
      "checkpoint",
      "deadlineMs",
    ],
    "pipeline invocation",
    errors,
  );
  if (!invocation) return errors;
  validateInvocationCommon(invocation, 1, errors);
  if (
    !PIPELINE_STEP_OPERATIONS_V1.includes(invocation.operation) ||
    invocation.contributionId !== descriptor.id ||
    invocation.configSchemaVersion !== 1
  )
    errors.push(
      "pipeline invocation operation, contribution, or config version does not match",
    );
  boundaryId(invocation.runId, "pipeline runId", errors);
  boundaryId(invocation.projectId, "pipeline projectId", errors);
  if (invocation.documentId !== void 0)
    boundaryId(invocation.documentId, "pipeline documentId", errors);
  if (
    typeof invocation.deadlineMs === "number" &&
    invocation.deadlineMs > descriptor.limits.maxDeadlineMs
  )
    errors.push("pipeline invocation deadline exceeds descriptor limit");
  errors.push(
    ...validatePublicConfig(invocation.config, descriptor.configSchema),
  );
  validatePipelineArtifact(
    invocation.input,
    descriptor.input,
    descriptor.limits.maxInputBytes,
    "pipeline input",
    errors,
  );
  if (invocation.operation === "execute" && invocation.checkpoint !== void 0)
    errors.push("pipeline execute cannot include a checkpoint");
  if (invocation.operation === "resume") {
    if (!descriptor.resumable || !invocation.checkpoint)
      errors.push("pipeline step is not resumable or checkpoint is missing");
    const checkpoint = strictObject(
      invocation.checkpoint,
      ["schemaVersion", "value"],
      "pipeline checkpoint",
      errors,
    );
    if (
      checkpoint &&
      (checkpoint.schemaVersion !== descriptor.checkpointSchemaVersion ||
        !validatePublicJson(
          checkpoint.value,
          descriptor.limits.maxCheckpointBytes,
        ))
    )
      errors.push("plugin checkpoint is incompatible or oversized");
  }
  if (jsonBytes(value) > PUBLIC_CONTRIBUTION_LIMITS.invocationBytes)
    errors.push("pipeline invocation is oversized");
  return errors;
}
function validatePipelineStepResult(value, descriptor) {
  const errors = [];
  const result = strictObject(
    value,
    ["protocolVersion", "output", "checkpoint", "usage"],
    "pipeline result",
    errors,
  );
  if (!result) return errors;
  if (result.protocolVersion !== 1)
    errors.push("pipeline result protocolVersion must be 1");
  validatePipelineArtifact(
    result.output,
    descriptor.output,
    descriptor.limits.maxOutputBytes,
    "pipeline output",
    errors,
  );
  validateUsage(result.usage, errors);
  if (result.checkpoint !== void 0) {
    const checkpoint = strictObject(
      result.checkpoint,
      ["schemaVersion", "value"],
      "pipeline checkpoint",
      errors,
    );
    if (
      !descriptor.resumable ||
      !checkpoint ||
      checkpoint.schemaVersion !== descriptor.checkpointSchemaVersion ||
      !validatePublicJson(
        checkpoint.value,
        descriptor.limits.maxCheckpointBytes,
      )
    )
      errors.push("pipeline result checkpoint is incompatible or oversized");
  }
  if (jsonBytes(value) > PUBLIC_CONTRIBUTION_LIMITS.resultBytes)
    errors.push("pipeline result is oversized");
  return errors;
}
function validatePipelineStepCheckpointProgress(value, invocation, descriptor) {
  const errors = [];
  const progress = strictObject(
    value,
    ["protocolVersion", "invocationId", "contributionId", "checkpoint"],
    "pipeline checkpoint progress",
    errors,
  );
  if (!progress) return errors;
  if (
    progress.protocolVersion !== 1 ||
    progress.invocationId !== invocation.invocationId ||
    progress.contributionId !== descriptor.id
  )
    errors.push("pipeline checkpoint progress identity is incompatible");
  const checkpoint = strictObject(
    progress.checkpoint,
    ["schemaVersion", "value"],
    "pipeline checkpoint progress value",
    errors,
  );
  if (
    !descriptor.resumable ||
    !checkpoint ||
    checkpoint.schemaVersion !== descriptor.checkpointSchemaVersion ||
    !validatePublicJson(checkpoint.value, descriptor.limits.maxCheckpointBytes)
  )
    errors.push("pipeline checkpoint progress is incompatible or oversized");
  if (jsonBytes(value) > PUBLIC_CONTRIBUTION_LIMITS.resultBytes)
    errors.push("pipeline checkpoint progress is oversized");
  return errors;
}
function validatePipelineCheckpointMigrationInvocation(value, descriptor) {
  const errors = [];
  const invocation = strictObject(
    value,
    [
      "protocolVersion",
      "invocationId",
      "contributionId",
      "runId",
      "projectId",
      "documentId",
      "configSchemaVersion",
      "config",
      "sourceCheckpoint",
      "targetCheckpointSchemaVersion",
      "deadlineMs",
    ],
    "checkpoint migration invocation",
    errors,
  );
  if (!invocation) return errors;
  validateInvocationCommon(invocation, 1, errors);
  if (
    invocation.contributionId !== descriptor.id ||
    invocation.configSchemaVersion !== descriptor.configSchemaVersion ||
    invocation.targetCheckpointSchemaVersion !==
      descriptor.checkpointSchemaVersion
  )
    errors.push("checkpoint migration descriptor versions do not match");
  boundaryId(invocation.runId, "checkpoint migration runId", errors);
  boundaryId(invocation.projectId, "checkpoint migration projectId", errors);
  if (invocation.documentId !== void 0)
    boundaryId(
      invocation.documentId,
      "checkpoint migration documentId",
      errors,
    );
  errors.push(
    ...validatePublicConfig(invocation.config, descriptor.configSchema),
  );
  const source = strictObject(
    invocation.sourceCheckpoint,
    ["schemaVersion", "value"],
    "source checkpoint",
    errors,
  );
  if (
    !source ||
    !Number.isInteger(source.schemaVersion) ||
    source.schemaVersion < 1 ||
    !validatePublicJson(source.value, descriptor.limits.maxCheckpointBytes)
  )
    errors.push("source checkpoint is invalid or oversized");
  if (
    typeof invocation.deadlineMs === "number" &&
    invocation.deadlineMs > descriptor.limits.maxDeadlineMs
  )
    errors.push("checkpoint migration deadline exceeds descriptor limit");
  if (jsonBytes(value) > PUBLIC_CONTRIBUTION_LIMITS.invocationBytes)
    errors.push("checkpoint migration invocation is oversized");
  return errors;
}
function validatePipelineCheckpointMigrationResult(value, descriptor) {
  const errors = [];
  const result = strictObject(
    value,
    ["protocolVersion", "checkpoint", "usage"],
    "checkpoint migration result",
    errors,
  );
  if (!result) return errors;
  if (result.protocolVersion !== 1)
    errors.push("checkpoint migration result protocolVersion must be 1");
  const checkpoint = strictObject(
    result.checkpoint,
    ["schemaVersion", "value"],
    "migrated checkpoint",
    errors,
  );
  if (
    !checkpoint ||
    checkpoint.schemaVersion !== descriptor.checkpointSchemaVersion ||
    !validatePublicJson(checkpoint.value, descriptor.limits.maxCheckpointBytes)
  )
    errors.push("migrated checkpoint is incompatible or oversized");
  validateUsage(result.usage, errors);
  if (jsonBytes(value) > PUBLIC_CONTRIBUTION_LIMITS.resultBytes)
    errors.push("checkpoint migration result is oversized");
  return errors;
}
function validateFailure(value, codes, label) {
  const errors = [];
  const failure = strictObject(
    value,
    ["protocolVersion", "invocationId", "code", "message", "retryable"],
    label,
    errors,
  );
  if (!failure) return errors;
  if (failure.protocolVersion !== 1)
    errors.push(`${label} protocolVersion must be 1`);
  boundaryId(failure.invocationId, `${label} invocationId`, errors);
  if (!codes.has(String(failure.code)))
    errors.push(`${label} code is unsupported`);
  boundaryString(failure.message, `${label} message`, 1024, errors);
  if (typeof failure.retryable !== "boolean")
    errors.push(`${label} retryable must be boolean`);
  return errors;
}
var qaFailureCodes = /* @__PURE__ */ new Set([
  "invalid_input",
  "invalid_result",
  "permission_denied",
  "cancelled",
  "timeout",
  "host_crash",
  "protocol",
  "resource_limit",
  "stale_activation",
]);
var pipelineFailureCodes = /* @__PURE__ */ new Set([
  "invalid_input",
  "invalid_output",
  "permission_denied",
  "cancelled",
  "timeout",
  "host_crash",
  "protocol",
  "resource_limit",
  "stale_activation",
  "step_not_resumable",
  "plugin_checkpoint_incompatible",
]);
function validateQaRuleFailure(value) {
  return validateFailure(value, qaFailureCodes, "QA failure");
}
function validatePipelineStepFailure(value) {
  return validateFailure(value, pipelineFailureCodes, "pipeline failure");
}
function throwErrors(errors, label) {
  if (errors.length > 0) throw new TypeError(`${label}: ${errors.join("; ")}`);
}
function createPortableAbortController() {
  let aborted = false;
  const signal = {
    get aborted() {
      return aborted;
    },
    get reason() {
      return aborted ? "plugin contribution cancelled" : void 0;
    },
    onabort: null,
    throwIfAborted() {
      if (aborted) throw new Error("plugin contribution cancelled");
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
  };
  return {
    signal,
    abort() {
      aborted = true;
    },
  };
}
async function withInvocationSignal(
  invocationId,
  active,
  operation,
  suppliedController,
) {
  if (active.has(invocationId))
    throw new Error("invocationId is already active");
  const controller = suppliedController ?? createPortableAbortController();
  active.set(invocationId, controller);
  try {
    return await operation({ signal: controller.signal });
  } finally {
    active.delete(invocationId);
  }
}
function sandboxContributionFailure(error) {
  const failure =
    error instanceof QaRuleHandlerError ||
    error instanceof PipelineStepHandlerError
      ? error.failure
      : void 0;
  return {
    protocolVersion: 1,
    ok: false,
    error: {
      code: failure?.code ?? "plugin_sandbox_failed",
      message: "plugin contribution invocation failed",
      retryable: failure?.retryable ?? false,
    },
  };
}
function createSandboxQaRulePlugin(options) {
  throwErrors(
    validateQaRuleDescriptor(options.descriptor),
    "invalid QA descriptor",
  );
  const active = /* @__PURE__ */ new Map();
  return {
    async invoke(request) {
      try {
        if (
          request.contributionId !== options.descriptor.id ||
          request.operation !== "qa.evaluateSegment"
        )
          throw new Error("unsupported QA sandbox operation");
        const invocation = request.input;
        throwErrors(
          validateQaRuleInvocation(invocation, options.descriptor),
          "invalid QA invocation",
        );
        const result = await withInvocationSignal(
          invocation.invocationId,
          active,
          (context) => options.handler.evaluateSegment(invocation, context),
        );
        throwErrors(
          validateQaRuleResult(result, invocation, options.descriptor),
          "invalid QA result",
        );
        return {
          protocolVersion: 1,
          ok: true,
          output: result,
        };
      } catch (error) {
        return sandboxContributionFailure(error);
      }
    },
    async deactivate() {
      for (const controller of active.values()) controller.abort();
      active.clear();
      await options.handler.shutdown?.();
    },
  };
}
function createSandboxPipelineStepPlugin(options) {
  throwErrors(
    validatePipelineStepDescriptor(options.descriptor),
    "invalid pipeline descriptor",
  );
  const active = /* @__PURE__ */ new Map();
  return {
    async invoke(request, host) {
      try {
        if (
          request.contributionId !== options.descriptor.id ||
          ![
            "pipeline.execute",
            "pipeline.resume",
            "pipeline.checkpointMigrate",
          ].includes(request.operation)
        )
          throw new Error("unsupported pipeline sandbox operation");
        if (request.operation === "pipeline.checkpointMigrate") {
          const migration = request.input;
          throwErrors(
            validatePipelineCheckpointMigrationInvocation(
              migration,
              options.descriptor,
            ),
            "invalid checkpoint migration invocation",
          );
          if (!options.handler.migrateCheckpoint)
            throw new PipelineStepHandlerError({
              protocolVersion: 1,
              invocationId: migration.invocationId,
              code: "plugin_checkpoint_incompatible",
              message: "pipeline step has no checkpoint migration handler",
              retryable: false,
            });
          const result2 = await withInvocationSignal(
            migration.invocationId,
            active,
            (context) =>
              options.handler.migrateCheckpoint?.(migration, context),
          );
          throwErrors(
            validatePipelineCheckpointMigrationResult(
              result2,
              options.descriptor,
            ),
            "invalid checkpoint migration result",
          );
          return {
            protocolVersion: 1,
            ok: true,
            output: result2,
          };
        }
        const invocation = request.input;
        throwErrors(
          validatePipelineStepInvocation(invocation, options.descriptor),
          "invalid pipeline invocation",
        );
        let checkpointOpen = true;
        let checkpointSequence = 0;
        const result = await withInvocationSignal(
          invocation.invocationId,
          active,
          (context) => {
            const pipelineContext = {
              signal: context.signal,
              publishCheckpoint(checkpoint) {
                if (!checkpointOpen || context.signal.aborted || !host)
                  throw new Error(
                    "pipeline checkpoint publication is unavailable",
                  );
                const progress = {
                  protocolVersion: 1,
                  invocationId: invocation.invocationId,
                  contributionId: invocation.contributionId,
                  checkpoint,
                };
                throwErrors(
                  validatePipelineStepCheckpointProgress(
                    progress,
                    invocation,
                    options.descriptor,
                  ),
                  "invalid pipeline checkpoint progress",
                );
                checkpointSequence += 1;
                host.call({
                  protocolVersion: 1,
                  requestId: `${invocation.invocationId}.checkpoint.${checkpointSequence}`,
                  method: "pipeline.checkpoint",
                  params: progress,
                });
              },
            };
            if (invocation.operation === "execute")
              return options.handler.execute(invocation, pipelineContext);
            if (!options.handler.resume)
              throw new PipelineStepHandlerError({
                protocolVersion: 1,
                invocationId: invocation.invocationId,
                code: "step_not_resumable",
                message: "pipeline step is not resumable",
                retryable: false,
              });
            return options.handler.resume(invocation, pipelineContext);
          },
        ).finally(() => {
          checkpointOpen = false;
        });
        throwErrors(
          validatePipelineStepResult(result, options.descriptor),
          "invalid pipeline result",
        );
        return {
          protocolVersion: 1,
          ok: true,
          output: result,
        };
      } catch (error) {
        return sandboxContributionFailure(error);
      }
    },
    async deactivate() {
      for (const controller of active.values()) controller.abort();
      active.clear();
      await options.handler.shutdown?.();
    },
  };
}

// src/ai-ui.ts
var AI_ACTION_LIMITS = Object.freeze({
  inputBytes: 1024 * 1024,
  outputBytes: 1024 * 1024,
  tags: 1024,
  deadlineMs: 12e4,
  methods: 16,
});

// src/external-connector.ts
var EXTERNAL_CONNECTOR_LIMITS = Object.freeze({
  configBytes: 64 * 1024,
  items: 256,
  itemTextBytes: 256 * 1024,
  metadataEntries: 32,
  checkpointBytes: 64 * 1024,
  deadlineMs: 12e4,
  requestBytes: 256 * 1024,
  responseBytes: 1024 * 1024,
  requestIdBytes: 128,
  credentialBytes: 16 * 1024,
});

// src/index.ts
var MAX_ENGINE_CONNECTOR_CREDENTIAL_BYTES = 16 * 1024;
var ENGINE_CONNECTOR_LIMITS = Object.freeze({
  configBytes: 64 * 1024,
  configFields: 64,
  configKeyBytes: 64,
  configValueBytes: 4 * 1024,
  messages: 128,
  messageBytes: 64 * 1024,
  sourceTextBytes: 1024 * 1024,
  outputBytes: 4 * 1024 * 1024,
  events: 8192,
  models: 256,
  modelIdBytes: 256,
  deadlineMs: 12e4,
  requestIdBytes: 128,
  localeBytes: 64,
  errorMessageBytes: 1024,
  endpointBytes: 2048,
  headers: 32,
  headerNameBytes: 128,
  headerValueBytes: 1024,
  jsonPathDepth: 16,
  jsonPathSegmentBytes: 128,
});
var SANDBOX_LIMITS = Object.freeze({
  heapBytes: 32 * 1024 * 1024,
  stackBytes: 512 * 1024,
  initializationMs: 1e3,
  invocationMs: 2e3,
  shutdownMs: 500,
  moduleBytes: 1024 * 1024,
  aggregateModuleBytes: 8 * 1024 * 1024,
  moduleCount: 128,
  pendingRequests: 32,
  invocationJsonBytes: 1024 * 1024,
  hostCallJsonBytes: 256 * 1024,
  jsonDepth: 16,
  hostCallsPerInvocation: 256,
  diagnosticBytes: 4 * 1024,
});

// ../../fixtures/plugins/qa-pipeline-sandbox/src/index.ts
var qaDescriptor = defineQaRule({
  id: "fixture.qa.sandbox-marker",
  version: "1.0.0",
  displayName: "Sandbox marker",
  severity: "warning",
  categories: ["custom"],
  configSchema: { schemaVersion: 1, fields: [] },
  config: {},
  limits: {
    maxFindings: 4,
    maxMessageBytes: 256,
    maxEvidenceItems: 4,
    maxRelatedSegmentIds: 4,
    maxDeadlineMs: 1e3,
  },
});
var pipelineDescriptor = definePipelineStep({
  id: "fixture.pipeline.sandbox-normalize",
  version: "1.0.0",
  displayName: "Sandbox normalize",
  input: "json",
  output: "json",
  configSchema: { schemaVersion: 1, fields: [] },
  resumable: true,
  checkpointSchemaVersion: 1,
  limits: {
    maxInputBytes: 65536,
    maxOutputBytes: 65536,
    maxConfigBytes: 1024,
    maxCheckpointBytes: 1024,
    maxDeadlineMs: 2e3,
  },
});
function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : {};
}
function evaluateMarker(invocation) {
  const marker = "TIER2";
  const start = invocation.context.targetText.indexOf(marker);
  return {
    protocolVersion: 1,
    findings:
      start < 0
        ? []
        : [
            {
              ruleId: "sandbox.marker",
              category: "custom",
              severity: "warning",
              message: "Sandbox marker requires review.",
              fingerprint: `sandbox.marker:${start}`,
              spans: [{ field: "target", start, end: start + marker.length }],
              evidence: [marker],
              relatedSegmentIds: [],
            },
          ],
    usage: {
      workUnits: 1,
      inputBytes: invocation.context.targetText.length,
      outputBytes: start < 0 ? 0 : marker.length,
    },
  };
}
function normalize(invocation) {
  const values = record(invocation.input.value).values;
  const normalized = Array.isArray(values)
    ? values
        .filter((value) => typeof value === "string")
        .map((value) => value.trim().toUpperCase())
    : [];
  return {
    protocolVersion: 1,
    output: { kind: "json", value: { values: normalized } },
    checkpoint: { schemaVersion: 1, value: { cursor: normalized.length } },
    usage: {
      workUnits: normalized.length,
      inputBytes: JSON.stringify(values ?? []).length,
      outputBytes: JSON.stringify(normalized).length,
    },
  };
}
var qaPlugin = createSandboxQaRulePlugin({
  descriptor: qaDescriptor,
  handler: { evaluateSegment: evaluateMarker },
});
var pipelinePlugin = createSandboxPipelineStepPlugin({
  descriptor: pipelineDescriptor,
  handler: {
    execute(invocation, context) {
      const result = normalize(invocation);
      context.publishCheckpoint(result.checkpoint);
      return result;
    },
    resume(invocation, context) {
      const result = normalize(invocation);
      context.publishCheckpoint(result.checkpoint);
      return result;
    },
    migrateCheckpoint(invocation) {
      const source = record(invocation.sourceCheckpoint.value);
      const cursor =
        typeof source.cursor === "number" && Number.isInteger(source.cursor)
          ? source.cursor
          : 0;
      return {
        protocolVersion: 1,
        checkpoint: { schemaVersion: 1, value: { cursor } },
        usage: { workUnits: 1, inputBytes: 0, outputBytes: 0 },
      };
    },
  },
});
var index_default = Object.freeze({
  activate(context) {
    if (context.protocolVersion !== 1) throw new Error("unsupported protocol");
  },
  invoke(request, host) {
    if (request.contributionId === qaDescriptor.id) {
      return qaPlugin.invoke(request, host);
    }
    if (request.contributionId === pipelineDescriptor.id) {
      return pipelinePlugin.invoke(request, host);
    }
    return {
      protocolVersion: 1,
      ok: false,
      error: {
        code: "plugin_sandbox_failed",
        message: "unsupported contribution",
        retryable: false,
      },
    };
  },
  async deactivate() {
    await qaPlugin.deactivate?.();
    await pipelinePlugin.deactivate?.();
  },
});
export { index_default as default };
