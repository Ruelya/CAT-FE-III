import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AiAction,
  AiBatchItem,
  AiBatchRun,
  AiConversation,
  AiConversationMessage,
  AiProviderProfile,
  AiRun,
  AiSettings,
  AiUsageQueryResult,
  AiConnectorCatalogItem,
  EditorMutationResult,
  QualityScoreReport,
  SemanticQaReport,
  TermExtractReport,
  AiCredentialStatus,
} from "@translunar/contracts";

import { formatAiError, toUiError, type UiError } from "../lib/errors";
import { desktopApi, invokeEngine } from "../lib/rpc";
import {
  createEmptyEventReplay,
  reduceRunEvents,
  type AiEventReplayState,
} from "./ai-events";
import {
  buildCreateConfiguration,
  canApplyRun,
  canCancelBatch,
  canCancelRun,
  canResumeBatch,
  canResumeRun,
  isBatchTerminal,
  isRunTerminal,
  mergeConfiguration,
  projectConnectorSchema,
  type ProjectedConfigField,
} from "./ai-view";
import type { P4ProjectContext } from "./p4-route-context";

export type AiDomain =
  | "catalog"
  | "settings"
  | "credentials"
  | "conversations"
  | "grounding"
  | "run"
  | "batch"
  | "usage"
  | "quality";

export interface AiControllerGateway {
  generation: number;
  mutationsEnabled: boolean;
  active: boolean;
  context: P4ProjectContext | null;
  section: string;
}

export interface ProviderFormState {
  name: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  maxResponseBytes: number;
  enabled: boolean;
  catalogId: string;
  configFields: ProjectedConfigField[];
  configValues: Record<string, string | boolean | number>;
  schemaOk: boolean;
  unsupported: string[];
}

export interface AiControllerState {
  loading: boolean;
  error: UiError | null;
  catalog: AiConnectorCatalogItem[];
  profiles: AiProviderProfile[];
  settings: AiSettings | null;
  credentialStatus: AiCredentialStatus | null;
  selectedProfileId: string | null;
  providerForm: ProviderFormState | null;
  credentialSecret: string;
  settingsForm: AiSettings | null;
  mutationPending: boolean;
  testResult: string | null;
  conversations: AiConversation[];
  selectedConversationId: string | null;
  messages: AiConversationMessage[];
  messagesTotal: number;
  messagesOffset: number;
  conversationTitle: string;
  groundingPreview: string | null;
  activeRun: AiRun | null;
  eventReplay: AiEventReplayState;
  prompt: string;
  action: AiAction;
  batchRuns: AiBatchRun[];
  selectedBatch: AiBatchRun | null;
  batchItems: AiBatchItem[];
  usage: AiUsageQueryResult | null;
  usageSinceMs: number;
  usageUntilMs: number;
  usageDimension: "day" | "month" | "project" | "provider" | "model";
  qualityScore: QualityScoreReport | null;
  qualitySemantic: SemanticQaReport | null;
  qualityTerms: TermExtractReport | null;
  segmentRevision: number | null;
  /** Authoritative mutation returned by a successful apply; Workbench rehydrate consumes later. */
  lastApplyMutation: EditorMutationResult | null;
  runs: AiRun[];
  runsTotal: number;
  runsOffset: number;
  batchRunsTotal: number;
  batchRunsOffset: number;
  batchItemsTotal: number;
  batchItemsOffset: number;
  usageOffset: number;
  usageLimit: number;
}

function emptyForm(): ProviderFormState {
  return {
    name: "",
    model: "",
    baseUrl: "",
    timeoutMs: 30_000,
    maxResponseBytes: 1_000_000,
    enabled: true,
    catalogId: "",
    configFields: [],
    configValues: {},
    schemaOk: true,
    unsupported: [],
  };
}

function initialState(): AiControllerState {
  const now = Date.now();
  return {
    loading: false,
    error: null,
    catalog: [],
    profiles: [],
    settings: null,
    credentialStatus: null,
    selectedProfileId: null,
    providerForm: null,
    credentialSecret: "",
    settingsForm: null,
    mutationPending: false,
    testResult: null,
    conversations: [],
    selectedConversationId: null,
    messages: [],
    messagesTotal: 0,
    messagesOffset: 0,
    conversationTitle: "",
    groundingPreview: null,
    activeRun: null,
    eventReplay: createEmptyEventReplay(),
    prompt: "",
    action: "translate",
    batchRuns: [],
    selectedBatch: null,
    batchItems: [],
    usage: null,
    usageSinceMs: now - 30 * 24 * 60 * 60 * 1000,
    usageUntilMs: now,
    usageDimension: "day",
    qualityScore: null,
    qualitySemantic: null,
    qualityTerms: null,
    segmentRevision: null,
    lastApplyMutation: null,
    runs: [],
    runsTotal: 0,
    runsOffset: 0,
    batchRunsTotal: 0,
    batchRunsOffset: 0,
    batchItemsTotal: 0,
    batchItemsOffset: 0,
    usageOffset: 0,
    usageLimit: 50,
  };
}

const PAGE_SIZE = 50;

export interface SegmentRevisionSnapshot {
  segmentId: string;
  revision: number;
}

function emptyCounters(): Record<AiDomain, number> {
  return {
    catalog: 0,
    settings: 0,
    credentials: 0,
    conversations: 0,
    grounding: 0,
    run: 0,
    batch: 0,
    usage: 0,
    quality: 0,
  };
}

export interface AiControllerApi {
  state: AiControllerState;
  invalidate: () => void;
  reloadProviders: () => Promise<void>;
  selectProfile: (profileId: string | null) => void;
  beginCreateProfile: (catalogId: string) => void;
  beginEditProfile: (profileId: string) => void;
  clearProviderForm: () => void;
  patchProviderForm: (patch: Partial<ProviderFormState>) => void;
  setConfigValue: (key: string, value: string | boolean | number) => void;
  createProfile: () => Promise<void>;
  updateProfile: () => Promise<void>;
  deleteProfile: (profileId: string, expectedRevision: number) => Promise<void>;
  testProfile: (profileId: string) => Promise<void>;
  setCredentialSecret: (secret: string) => void;
  saveCredential: (profileId: string) => Promise<void>;
  deleteCredential: (profileId: string) => Promise<void>;
  patchSettingsForm: (patch: Partial<AiSettings>) => void;
  saveSettings: () => Promise<void>;
  loadConversations: () => Promise<void>;
  createConversation: () => Promise<void>;
  selectConversation: (id: string | null) => Promise<void>;
  archiveConversation: (id: string, revision: number) => Promise<void>;
  setConversationTitle: (title: string) => void;
  loadMessages: (offset?: number) => Promise<void>;
  previewGrounding: () => Promise<void>;
  setPrompt: (prompt: string) => void;
  setAction: (action: AiAction) => void;
  startRun: () => Promise<void>;
  cancelRun: () => Promise<void>;
  resumeRun: () => Promise<void>;
  applyResult: () => Promise<void>;
  discardProposal: () => void;
  loadBatches: (offset?: number) => Promise<void>;
  startBatch: () => Promise<void>;
  selectBatch: (id: string | null, itemsOffset?: number) => Promise<void>;
  loadBatchItems: (offset?: number) => Promise<void>;
  cancelBatch: () => Promise<void>;
  resumeBatch: () => Promise<void>;
  loadUsage: (offset?: number) => Promise<void>;
  setUsageRange: (sinceMs: number, untilMs: number) => void;
  setUsageDimension: (d: AiControllerState["usageDimension"]) => void;
  /** Enabled profiles that currently have credentials present. */
  runnableProfiles: () => Array<{ id: string; name: string }>;
  runQualityScore: () => Promise<void>;
  runSemanticQa: () => Promise<void>;
  runExtractTerms: () => Promise<void>;
  /** Returns validated revision from Engine; React state is display cache only. */
  hydrateSegmentRevision: () => Promise<SegmentRevisionSnapshot | null>;
  loadRuns: (offset?: number) => Promise<void>;
  reopenRun: (runId: string) => Promise<void>;
}

export function useAiController(
  gateway: AiControllerGateway,
): AiControllerApi {
  const [state, setState] = useState<AiControllerState>(initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const gatewayRef = useRef(gateway);
  gatewayRef.current = gateway;
  const listOps = useRef(emptyCounters());
  const mutOps = useRef(emptyCounters());
  const mutPending = useRef(emptyCounters());
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(gateway.generation);

  const clearPoll = useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const invalidate = useCallback(() => {
    generationRef.current = gatewayRef.current.generation;
    for (const k of Object.keys(listOps.current) as AiDomain[]) {
      listOps.current[k] += 1;
      mutOps.current[k] += 1;
      mutPending.current[k] = 0;
    }
    clearPoll();
    // Clear disposable pending presentation so re-entry is usable.
    setState((s) =>
      s.mutationPending ? { ...s, mutationPending: false } : s,
    );
  }, [clearPoll]);

  useEffect(() => {
    if (gateway.generation !== generationRef.current) {
      invalidate();
    }
  }, [gateway.generation, invalidate]);

  useEffect(() => () => clearPoll(), [clearPoll]);

  const isCurrent = useCallback(
    (domain: AiDomain, op: number, kind: "list" | "mut") => {
      if (gatewayRef.current.generation !== generationRef.current) return false;
      if (!gatewayRef.current.active) return false;
      return kind === "list"
        ? listOps.current[domain] === op
        : mutOps.current[domain] === op;
    },
    [],
  );

  const beginMut = useCallback((domain: AiDomain): number | null => {
    if (mutPending.current[domain] > 0) return null;
    if (!gatewayRef.current.mutationsEnabled) return null;
    const op = ++mutOps.current[domain];
    mutPending.current[domain] = op;
    return op;
  }, []);

  const endMut = useCallback((domain: AiDomain, op: number) => {
    if (mutPending.current[domain] === op) mutPending.current[domain] = 0;
  }, []);

  const reloadProviders = useCallback(async () => {
    if (!gatewayRef.current.active) return;
    const op = ++listOps.current.catalog;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [catalog, list, settings] = await Promise.all([
        invokeEngine("ai.provider.catalog", {}),
        invokeEngine("ai.provider.list", { limit: 100, offset: 0 }),
        invokeEngine("ai.settings.get", {}),
      ]);
      if (!isCurrent("catalog", op, "list")) return;
      setState((s) => ({
        ...s,
        loading: false,
        catalog: catalog.items,
        profiles: list.items,
        settings,
        settingsForm: settings,
        error: null,
      }));
    } catch (error) {
      if (!isCurrent("catalog", op, "list")) return;
      setState((s) => ({
        ...s,
        loading: false,
        error: toUiError(error),
      }));
    }
  }, [isCurrent]);

  const selectProfile = useCallback((profileId: string | null) => {
    setState((s) => ({
      ...s,
      selectedProfileId: profileId,
      credentialStatus: null,
      testResult: null,
    }));
    if (!profileId) return;
    void (async () => {
      const op = ++listOps.current.credentials;
      try {
        const status = await invokeEngine("ai.credential.status", {
          profileId,
        });
        if (!isCurrent("credentials", op, "list")) return;
        setState((s) => ({ ...s, credentialStatus: status }));
      } catch (error) {
        if (!isCurrent("credentials", op, "list")) return;
        setState((s) => ({ ...s, error: toUiError(error) }));
      }
    })();
  }, [isCurrent]);

  const beginCreateProfile = useCallback((catalogId: string) => {
    const item = stateRef.current.catalog.find((c) => c.id === catalogId);
    const projected = projectConnectorSchema(item?.configSchema);
    const form = emptyForm();
    form.catalogId = catalogId;
    form.name = item?.displayName ?? "";
    form.model = item?.defaultModel ?? "";
    form.baseUrl = item?.defaultBaseUrl ?? "";
    if (projected.ok) {
      form.configFields = projected.fields;
      form.schemaOk = true;
      for (const f of projected.fields) {
        if (f.defaultValue !== null) form.configValues[f.key] = f.defaultValue;
      }
    } else {
      form.schemaOk = false;
      form.unsupported = projected.unsupportedKeys;
    }
    setState((s) => ({ ...s, providerForm: form, selectedProfileId: null }));
  }, []);

  const beginEditProfile = useCallback((profileId: string) => {
    const profile = stateRef.current.profiles.find((p) => p.id === profileId);
    if (!profile) return;
    const catalogItem = stateRef.current.catalog.find((c) => {
      if (profile.source.kind === "builtin") {
        return c.source.kind === "builtin" && c.source.provider === profile.source.provider;
      }
      return (
        c.source.kind === "plugin" &&
        profile.source.kind === "plugin" &&
        c.source.owner.pluginId === profile.source.owner.pluginId &&
        c.source.contributionId === profile.source.contributionId
      );
    });
    const projected = projectConnectorSchema(catalogItem?.configSchema);
    const form = emptyForm();
    form.name = profile.name;
    form.model = profile.model;
    form.baseUrl = profile.baseUrl;
    form.timeoutMs = profile.timeoutMs;
    form.maxResponseBytes = profile.maxResponseBytes;
    form.enabled = profile.enabled;
    form.catalogId = catalogItem?.id ?? "";
    if (projected.ok) {
      form.configFields = projected.fields;
      form.schemaOk = true;
      const cfg = (profile.configuration ?? {}) as Record<string, unknown>;
      for (const f of projected.fields) {
        const v = cfg[f.key];
        if (typeof v === "string" || typeof v === "boolean" || typeof v === "number") {
          form.configValues[f.key] = v;
        } else if (f.defaultValue !== null) {
          form.configValues[f.key] = f.defaultValue;
        }
      }
    } else {
      form.schemaOk = false;
      form.unsupported = projected.unsupportedKeys;
    }
    setState((s) => ({
      ...s,
      providerForm: form,
      selectedProfileId: profileId,
    }));
  }, []);

  const clearProviderForm = useCallback(() => {
    setState((s) => ({ ...s, providerForm: null }));
  }, []);

  const patchProviderForm = useCallback((patch: Partial<ProviderFormState>) => {
    setState((s) =>
      s.providerForm
        ? { ...s, providerForm: { ...s.providerForm, ...patch } }
        : s,
    );
  }, []);

  const setConfigValue = useCallback(
    (key: string, value: string | boolean | number) => {
      setState((s) => {
        if (!s.providerForm) return s;
        return {
          ...s,
          providerForm: {
            ...s.providerForm,
            configValues: { ...s.providerForm.configValues, [key]: value },
          },
        };
      });
    },
    [],
  );

  const createProfile = useCallback(async () => {
    const form = stateRef.current.providerForm;
    if (!form || !form.schemaOk) return;
    const item = stateRef.current.catalog.find((c) => c.id === form.catalogId);
    if (!item) return;
    const op = beginMut("catalog");
    if (op === null) return;
    setState((s) => ({ ...s, mutationPending: true, error: null }));
    try {
      await invokeEngine("ai.provider.create", {
        name: form.name,
        model: form.model,
        baseUrl: form.baseUrl,
        timeoutMs: form.timeoutMs,
        maxResponseBytes: form.maxResponseBytes,
        enabled: form.enabled,
        source: item.source,
        configuration: buildCreateConfiguration(
          form.configFields,
          form.configValues,
        ),
        configSchemaVersion: item.configSchemaVersion,
        ...(item.kind ? { kind: item.kind } : {}),
      });
      const _still = isCurrent("catalog", op, "mut");
      endMut("catalog", op);
      if (!_still) return;
      setState((s) => ({
        ...s,
        mutationPending: false,
        providerForm: null,
      }));
      await reloadProviders();
    } catch (error) {
      const _still = isCurrent("catalog", op, "mut");
      endMut("catalog", op);
      if (!_still) return;
      setState((s) => ({
        ...s,
        mutationPending: false,
        error: toUiError(error),
      }));
    }
  }, [beginMut, endMut, isCurrent, reloadProviders]);

  const updateProfile = useCallback(async () => {
    const form = stateRef.current.providerForm;
    const profileId = stateRef.current.selectedProfileId;
    if (!form || !form.schemaOk || !profileId) return;
    const profile = stateRef.current.profiles.find((p) => p.id === profileId);
    if (!profile) return;
    const op = beginMut("catalog");
    if (op === null) return;
    setState((s) => ({ ...s, mutationPending: true, error: null }));
    try {
      await invokeEngine("ai.provider.update", {
        profileId,
        expectedRevision: profile.revision,
        name: form.name,
        model: form.model,
        baseUrl: form.baseUrl,
        timeoutMs: form.timeoutMs,
        maxResponseBytes: form.maxResponseBytes,
        enabled: form.enabled,
        configuration: mergeConfiguration(
          profile.configuration as Record<string, unknown> | undefined,
          form.configFields,
          form.configValues,
        ),
        source: profile.source,
        ...(profile.kind ? { kind: profile.kind } : {}),
        ...(profile.configSchemaVersion != null
          ? { configSchemaVersion: profile.configSchemaVersion }
          : {}),
      });
      const _still = isCurrent("catalog", op, "mut");
      endMut("catalog", op);
      if (!_still) return;
      setState((s) => ({
        ...s,
        mutationPending: false,
        providerForm: null,
      }));
      await reloadProviders();
    } catch (error) {
      const _still = isCurrent("catalog", op, "mut");
      endMut("catalog", op);
      if (!_still) return;
      setState((s) => ({
        ...s,
        mutationPending: false,
        error: toUiError(error),
      }));
    }
  }, [beginMut, endMut, isCurrent, reloadProviders]);

  const deleteProfile = useCallback(
    async (profileId: string, expectedRevision: number) => {
      const op = beginMut("catalog");
      if (op === null) return;
      setState((s) => ({ ...s, mutationPending: true, error: null }));
      try {
        await invokeEngine("ai.provider.delete", {
          profileId,
          expectedRevision,
        });
        const _still = isCurrent("catalog", op, "mut");
        endMut("catalog", op);
        if (!_still) return;
        setState((s) => ({
          ...s,
          mutationPending: false,
          selectedProfileId: null,
          providerForm: null,
        }));
        await reloadProviders();
      } catch (error) {
        const _still = isCurrent("catalog", op, "mut");
        endMut("catalog", op);
        if (!_still) return;
        setState((s) => ({
          ...s,
          mutationPending: false,
          error: toUiError(error),
        }));
      }
    },
    [beginMut, endMut, isCurrent, reloadProviders],
  );

  const testProfile = useCallback(
    async (profileId: string) => {
      const op = beginMut("catalog");
      if (op === null) return;
      setState((s) => ({ ...s, mutationPending: true, error: null, testResult: null }));
      try {
        const result = await invokeEngine("ai.provider.test", { profileId });
        const _still = isCurrent("catalog", op, "mut");
        endMut("catalog", op);
        if (!_still) return;
        setState((s) => ({
          ...s,
          mutationPending: false,
          testResult: `${result.run.status}${result.run.errorMessage ? `: ${result.run.errorMessage}` : ""}`,
        }));
      } catch (error) {
        const _still = isCurrent("catalog", op, "mut");
        endMut("catalog", op);
        if (!_still) return;
        setState((s) => ({
          ...s,
          mutationPending: false,
          error: toUiError(error),
        }));
      }
    },
    [beginMut, endMut, isCurrent],
  );

  const setCredentialSecret = useCallback((secret: string) => {
    setState((s) => ({ ...s, credentialSecret: secret }));
  }, []);

  const saveCredential = useCallback(
    async (profileId: string) => {
      const secret = stateRef.current.credentialSecret;
      if (!secret) return;
      const op = beginMut("credentials");
      if (op === null) return;
      setState((s) => ({ ...s, mutationPending: true, error: null }));
      try {
        await desktopApi().setAiCredential(profileId, secret);
        if (!isCurrent("credentials", op, "mut")) {
          endMut("credentials", op);
          return;
        }
        const status = await invokeEngine("ai.credential.status", {
          profileId,
        });
        const _still = isCurrent("credentials", op, "mut");
        endMut("credentials", op);
        if (!_still) return;
        setState((s) => ({
          ...s,
          mutationPending: false,
          credentialSecret: "",
          credentialStatus: status,
        }));
      } catch (error) {
        const _still = isCurrent("credentials", op, "mut");
        endMut("credentials", op);
        if (!_still) return;
        setState((s) => ({
          ...s,
          mutationPending: false,
          error: toUiError(error),
        }));
      }
    },
    [beginMut, endMut, isCurrent],
  );

  const deleteCredential = useCallback(
    async (profileId: string) => {
      const op = beginMut("credentials");
      if (op === null) return;
      setState((s) => ({ ...s, mutationPending: true, error: null }));
      try {
        await invokeEngine("ai.credential.delete", { profileId });
        const status = await invokeEngine("ai.credential.status", {
          profileId,
        });
        const _still = isCurrent("credentials", op, "mut");
        endMut("credentials", op);
        if (!_still) return;
        setState((s) => ({
          ...s,
          mutationPending: false,
          credentialStatus: status,
        }));
      } catch (error) {
        const _still = isCurrent("credentials", op, "mut");
        endMut("credentials", op);
        if (!_still) return;
        setState((s) => ({
          ...s,
          mutationPending: false,
          error: toUiError(error),
        }));
      }
    },
    [beginMut, endMut, isCurrent],
  );

  const patchSettingsForm = useCallback((patch: Partial<AiSettings>) => {
    setState((s) =>
      s.settingsForm
        ? { ...s, settingsForm: { ...s.settingsForm, ...patch } }
        : s,
    );
  }, []);

  const saveSettings = useCallback(async () => {
    const form = stateRef.current.settingsForm;
    if (!form) return;
    const op = beginMut("settings");
    if (op === null) return;
    setState((s) => ({ ...s, mutationPending: true, error: null }));
    try {
      const updated = await invokeEngine("ai.settings.update", {
        expectedRevision: form.revision,
        enabled: form.enabled,
        allowInteractive: form.allowInteractive,
        allowBatch: form.allowBatch,
        allowedOrigins: form.allowedOrigins,
        defaultProfileId: form.defaultProfileId ?? null,
        monthlyTokenBudget: form.monthlyTokenBudget ?? null,
      });
      const _still = isCurrent("settings", op, "mut");
      endMut("settings", op);
      if (!_still) return;
      setState((s) => ({
        ...s,
        mutationPending: false,
        settings: updated,
        settingsForm: updated,
      }));
    } catch (error) {
      const _still = isCurrent("settings", op, "mut");
      endMut("settings", op);
      if (!_still) return;
      setState((s) => ({
        ...s,
        mutationPending: false,
        error: toUiError(error),
      }));
    }
  }, [beginMut, endMut, isCurrent]);

  const hydrateSegmentRevision = useCallback(async (): Promise<SegmentRevisionSnapshot | null> => {
    const ctx = gatewayRef.current.context;
    const documentId = ctx?.documentId ?? null;
    const segmentId = ctx?.activeSegmentId ?? null;
    if (!documentId || !segmentId) {
      setState((s) => ({ ...s, segmentRevision: null }));
      return null;
    }
    const gen = generationRef.current;
    const ownerDoc = documentId;
    const ownerSeg = segmentId;
    const op = ++listOps.current.grounding;
    try {
      const page = await invokeEngine("segment.editor.list", {
        documentId,
        limit: 200,
        offset: 0,
      });
      // Reject stale completions: generation, surface owner, document/segment.
      if (generationRef.current !== gen) return null;
      if (!gatewayRef.current.active) return null;
      const live = gatewayRef.current.context;
      if (
        live?.documentId !== ownerDoc ||
        live?.activeSegmentId !== ownerSeg
      ) {
        return null;
      }
      if (listOps.current.grounding !== op) return null;
      const row = page.items.find((r) => r.segment.id === ownerSeg);
      if (!row) {
        setState((s) => ({ ...s, segmentRevision: null }));
        return null;
      }
      const snapshot: SegmentRevisionSnapshot = {
        segmentId: ownerSeg,
        revision: row.segment.revision,
      };
      setState((s) => ({ ...s, segmentRevision: snapshot.revision }));
      return snapshot;
    } catch {
      if (
        generationRef.current === gen &&
        gatewayRef.current.active &&
        gatewayRef.current.context?.documentId === ownerDoc &&
        gatewayRef.current.context?.activeSegmentId === ownerSeg &&
        listOps.current.grounding === op
      ) {
        setState((s) => ({ ...s, segmentRevision: null }));
      }
      return null;
    }
  }, []);

  const loadConversations = useCallback(async () => {
    const projectId = gatewayRef.current.context?.projectId;
    if (!projectId) return;
    const op = ++listOps.current.conversations;
    try {
      const page = await invokeEngine("ai.conversation.list", {
        projectId,
        limit: 50,
        offset: 0,
      });
      if (!isCurrent("conversations", op, "list")) return;
      setState((s) => ({ ...s, conversations: page.items }));
    } catch (error) {
      if (!isCurrent("conversations", op, "list")) return;
      setState((s) => ({ ...s, error: toUiError(error) }));
    }
  }, [isCurrent]);

  const createConversation = useCallback(async () => {
    const projectId = gatewayRef.current.context?.projectId;
    if (!projectId) return;
    const op = beginMut("conversations");
    if (op === null) return;
    try {
      const created = await invokeEngine("ai.conversation.create", {
        projectId,
        title: stateRef.current.conversationTitle || "Conversation",
      });
      const _still = isCurrent("conversations", op, "mut");
      endMut("conversations", op);
      if (!_still) return;
      setState((s) => ({
        ...s,
        selectedConversationId: created.id,
        conversations: [created, ...s.conversations],
      }));
    } catch (error) {
      const _still = isCurrent("conversations", op, "mut");
      endMut("conversations", op);
      if (!_still) return;
      setState((s) => ({ ...s, error: toUiError(error) }));
    }
  }, [beginMut, endMut, isCurrent]);

  const loadMessages = useCallback(
    async (offset = 0) => {
      const id = stateRef.current.selectedConversationId;
      if (!id) return;
      const op = ++listOps.current.conversations;
      try {
        const page = await invokeEngine("ai.conversation.messages", {
          conversationId: id,
          limit: 50,
          offset,
        });
        if (!isCurrent("conversations", op, "list")) return;
        setState((s) => ({
          ...s,
          messages: page.items,
          messagesTotal: page.total,
          messagesOffset: offset,
        }));
      } catch (error) {
        if (!isCurrent("conversations", op, "list")) return;
        setState((s) => ({ ...s, error: toUiError(error) }));
      }
    },
    [isCurrent],
  );

  const selectConversation = useCallback(
    async (id: string | null) => {
      setState((s) => ({
        ...s,
        selectedConversationId: id,
        messages: [],
      }));
      if (id) await loadMessages(0);
    },
    [loadMessages],
  );

  const archiveConversation = useCallback(
    async (id: string, revision: number) => {
      const op = beginMut("conversations");
      if (op === null) return;
      try {
        const title =
          stateRef.current.conversations.find((c) => c.id === id)?.title ??
          "Conversation";
        await invokeEngine("ai.conversation.update", {
          conversationId: id,
          expectedRevision: revision,
          archived: true,
          title,
        });
        const _still = isCurrent("conversations", op, "mut");
        endMut("conversations", op);
        if (!_still) return;
        await loadConversations();
      } catch (error) {
        const _still = isCurrent("conversations", op, "mut");
        endMut("conversations", op);
        if (!_still) return;
        setState((s) => ({ ...s, error: toUiError(error) }));
      }
    },
    [beginMut, endMut, isCurrent, loadConversations],
  );

  const setConversationTitle = useCallback((title: string) => {
    setState((s) => ({ ...s, conversationTitle: title }));
  }, []);

  const previewGrounding = useCallback(async () => {
    const ctx = gatewayRef.current.context;
    if (!ctx?.projectId || !ctx.documentId || !ctx.activeSegmentId) return;
    const snapshot = await hydrateSegmentRevision();
    if (!snapshot) return;
    const op = ++listOps.current.grounding;
    try {
      const result = await invokeEngine("ai.grounding.preview", {
        projectId: ctx.projectId,
        segmentId: snapshot.segmentId,
        expectedRevision: snapshot.revision,
        action: stateRef.current.action,
        prompt: stateRef.current.prompt,
      });
      if (!isCurrent("grounding", op, "list")) return;
      setState((s) => ({
        ...s,
        groundingPreview: JSON.stringify(
          {
            truncated: result.bundle.truncated,
            hash: result.bundle.promptHash,
            sections: result.bundle.sections,
            totalChars: result.bundle.totalChars,
          },
          null,
          2,
        ),
      }));
    } catch (error) {
      if (!isCurrent("grounding", op, "list")) return;
      setState((s) => ({ ...s, error: toUiError(error) }));
    }
  }, [hydrateSegmentRevision, isCurrent]);

  const pollRun = useCallback(
    async (runId: string) => {
      clearPoll();
      const tick = async () => {
        if (!gatewayRef.current.active) return;
        const op = ++listOps.current.run;
        try {
          const after = stateRef.current.eventReplay.lastSequence;
          const [events, run] = await Promise.all([
            invokeEngine("ai.run.events", {
              runId,
              afterSequence: after,
              limit: 100,
            }),
            invokeEngine("ai.run.get", { runId }),
          ]);
          if (!isCurrent("run", op, "list")) return;
          setState((s) => ({
            ...s,
            activeRun: run,
            eventReplay: reduceRunEvents(s.eventReplay, events),
          }));
          if (!isRunTerminal(run.status)) {
            pollTimer.current = setTimeout(() => {
              void tick();
            }, 500);
          }
        } catch (error) {
          if (!isCurrent("run", op, "list")) return;
          setState((s) => ({ ...s, error: toUiError(error) }));
        }
      };
      await tick();
    },
    [clearPoll, isCurrent],
  );

  const listRunnableProfiles = useCallback(() => {
    return stateRef.current.profiles
      .filter((p) => p.enabled && p.credentialPresent)
      .map((p) => ({ id: p.id, name: p.name }));
  }, []);

  const resolveRunnableProfileId = useCallback((): string | null => {
    const runnable = listRunnableProfiles();
    if (runnable.length === 0) return null;
    const selected = stateRef.current.selectedProfileId;
    if (selected && runnable.some((p) => p.id === selected)) return selected;
    const def = stateRef.current.settings?.defaultProfileId;
    if (def && runnable.some((p) => p.id === def)) return def;
    return runnable[0]?.id ?? null;
  }, [listRunnableProfiles]);

  const startRun = useCallback(async () => {
    const ctx = gatewayRef.current.context;
    if (!ctx?.projectId || !ctx.activeSegmentId) return;
    const snapshot = await hydrateSegmentRevision();
    if (!snapshot) return;
    let conversationId = stateRef.current.selectedConversationId;
    const op = beginMut("run");
    if (op === null) return;
    setState((s) => ({
      ...s,
      mutationPending: true,
      error: null,
      eventReplay: createEmptyEventReplay(),
      lastApplyMutation: null,
    }));
    try {
      if (!conversationId) {
        const created = await invokeEngine("ai.conversation.create", {
          projectId: ctx.projectId,
          title: stateRef.current.conversationTitle || "Conversation",
        });
        if (!isCurrent("run", op, "mut")) {
          endMut("run", op);
          return;
        }
        conversationId = created.id;
        setState((s) => ({
          ...s,
          selectedConversationId: created.id,
          conversations: [created, ...s.conversations],
        }));
      }
      const profileId = resolveRunnableProfileId();
      if (!profileId) {
        endMut("run", op);
        setState((s) => ({
          ...s,
          mutationPending: false,
          error: {
            code: "NO_PROFILE",
            message: "No enabled credential-backed AI profile",
            kind: "domain",
          },
        }));
        return;
      }
      const run = await invokeEngine("ai.run.start", {
        action: stateRef.current.action,
        conversationId,
        expectedRevision: snapshot.revision,
        profileId,
        projectId: ctx.projectId,
        segmentId: snapshot.segmentId,
        prompt: stateRef.current.prompt,
      });
      const _still = isCurrent("run", op, "mut");
      endMut("run", op);
      if (!_still) return;
      setState((s) => ({
        ...s,
        mutationPending: false,
        activeRun: run,
      }));
      void pollRun(run.id);
    } catch (error) {
      const _still = isCurrent("run", op, "mut");
      endMut("run", op);
      if (!_still) return;
      setState((s) => ({
        ...s,
        mutationPending: false,
        error: toUiError(error),
      }));
    }
  }, [
    beginMut,
    endMut,
    hydrateSegmentRevision,
    isCurrent,
    pollRun,
    resolveRunnableProfileId,
  ]);

  const cancelRun = useCallback(async () => {
    const run = stateRef.current.activeRun;
    if (!run || !canCancelRun(run.status)) return;
    const op = beginMut("run");
    if (op === null) return;
    try {
      const next = await invokeEngine("ai.run.cancel", {
        runId: run.id,
        expectedRevision: run.revision,
      });
      const _still = isCurrent("run", op, "mut");
      endMut("run", op);
      if (!_still) return;
      setState((s) => ({ ...s, activeRun: next }));
    } catch (error) {
      const _still = isCurrent("run", op, "mut");
      endMut("run", op);
      if (!_still) return;
      setState((s) => ({ ...s, error: toUiError(error) }));
    }
  }, [beginMut, endMut, isCurrent]);

  const resumeRun = useCallback(async () => {
    const run = stateRef.current.activeRun;
    if (!run || !canResumeRun(run.status)) return;
    const op = beginMut("run");
    if (op === null) return;
    try {
      const next = await invokeEngine("ai.run.resume", {
        runId: run.id,
        expectedRevision: run.revision,
      });
      const _still = isCurrent("run", op, "mut");
      endMut("run", op);
      if (!_still) return;
      setState((s) => ({ ...s, activeRun: next }));
      void pollRun(next.id);
    } catch (error) {
      const _still = isCurrent("run", op, "mut");
      endMut("run", op);
      if (!_still) return;
      setState((s) => ({ ...s, error: toUiError(error) }));
    }
  }, [beginMut, endMut, isCurrent, pollRun]);

  const applyResult = useCallback(async () => {
    const run = stateRef.current.activeRun;
    if (!run || !canApplyRun(run.status, run.proposalText)) return;
    const snapshot = await hydrateSegmentRevision();
    if (!snapshot) return;
    const op = beginMut("run");
    if (op === null) return;
    setState((s) => ({ ...s, mutationPending: true, error: null }));
    try {
      const mutation = await invokeEngine("ai.result.apply", {
        runId: run.id,
        expectedRunRevision: run.revision,
        expectedSegmentRevision: snapshot.revision,
      });
      const _still = isCurrent("run", op, "mut");
      endMut("run", op);
      if (!_still) return;
      const appliedRow = mutation.rows.find(
        (r) => r.segment.id === snapshot.segmentId,
      );
      setState((s) => ({
        ...s,
        mutationPending: false,
        lastApplyMutation: mutation,
        segmentRevision: appliedRow?.segment.revision ?? s.segmentRevision,
        // Successful apply consumes the proposal; Engine mutation is authority.
        activeRun: null,
        eventReplay: createEmptyEventReplay(),
      }));
    } catch (error) {
      const _still = isCurrent("run", op, "mut");
      endMut("run", op);
      if (!_still) return;
      // Failed apply retains proposal/run for retry.
      setState((s) => ({
        ...s,
        mutationPending: false,
        error: toUiError(error),
      }));
    }
  }, [beginMut, endMut, hydrateSegmentRevision, isCurrent]);

  const discardProposal = useCallback(() => {
    setState((s) => ({
      ...s,
      activeRun: null,
      eventReplay: createEmptyEventReplay(),
    }));
  }, []);

  const loadBatches = useCallback(
    async (offset = 0) => {
      const projectId = gatewayRef.current.context?.projectId;
      if (!projectId) return;
      const op = ++listOps.current.batch;
      try {
        const page = await invokeEngine("ai.batch.list", {
          projectId,
          limit: PAGE_SIZE,
          offset,
        });
        if (!isCurrent("batch", op, "list")) return;
        setState((s) => ({
          ...s,
          batchRuns: page.items,
          batchRunsTotal: page.total,
          batchRunsOffset: page.offset,
        }));
      } catch (error) {
        if (!isCurrent("batch", op, "list")) return;
        setState((s) => ({ ...s, error: toUiError(error) }));
      }
    },
    [isCurrent],
  );

  const startBatch = useCallback(async () => {
    const ctx = gatewayRef.current.context;
    if (!ctx?.projectId) return;
    const profileId = resolveRunnableProfileId();
    if (!profileId) {
      setState((s) => ({
        ...s,
        error: {
          code: "NO_PROFILE",
          message: "No enabled credential-backed AI profile",
          kind: "domain",
        },
      }));
      return;
    }
    const op = beginMut("batch");
    if (op === null) return;
    try {
      const run = await invokeEngine("ai.batch.start", {
        projectId: ctx.projectId,
        profileId,
        ...(ctx.documentId ? { documentId: ctx.documentId } : {}),
      });
      const _still = isCurrent("batch", op, "mut");
      endMut("batch", op);
      if (!_still) return;
      setState((s) => ({
        ...s,
        selectedBatch: run,
        batchRuns: [run, ...s.batchRuns],
        batchRunsTotal: s.batchRunsTotal + 1,
      }));
    } catch (error) {
      const _still = isCurrent("batch", op, "mut");
      endMut("batch", op);
      if (!_still) return;
      setState((s) => ({ ...s, error: toUiError(error) }));
    }
  }, [beginMut, endMut, isCurrent, resolveRunnableProfileId]);

  const selectBatch = useCallback(
    async (id: string | null, itemsOffset = 0) => {
      if (!id) {
        setState((s) => ({
          ...s,
          selectedBatch: null,
          batchItems: [],
          batchItemsTotal: 0,
          batchItemsOffset: 0,
        }));
        return;
      }
      const op = ++listOps.current.batch;
      try {
        const [run, items] = await Promise.all([
          invokeEngine("ai.batch.get", { batchId: id }),
          invokeEngine("ai.batch.items", {
            batchId: id,
            limit: PAGE_SIZE,
            offset: itemsOffset,
          }),
        ]);
        if (!isCurrent("batch", op, "list")) return;
        setState((s) => ({
          ...s,
          selectedBatch: run,
          batchItems: items.items,
          batchItemsTotal: items.total,
          batchItemsOffset: items.offset,
        }));
      } catch (error) {
        if (!isCurrent("batch", op, "list")) return;
        setState((s) => ({ ...s, error: toUiError(error) }));
      }
    },
    [isCurrent],
  );

  const loadBatchItems = useCallback(
    async (offset = 0) => {
      const batch = stateRef.current.selectedBatch;
      if (!batch) return;
      const op = ++listOps.current.batch;
      try {
        const items = await invokeEngine("ai.batch.items", {
          batchId: batch.id,
          limit: PAGE_SIZE,
          offset,
        });
        if (!isCurrent("batch", op, "list")) return;
        setState((s) => ({
          ...s,
          batchItems: items.items,
          batchItemsTotal: items.total,
          batchItemsOffset: items.offset,
        }));
      } catch (error) {
        if (!isCurrent("batch", op, "list")) return;
        setState((s) => ({ ...s, error: toUiError(error) }));
      }
    },
    [isCurrent],
  );

  const cancelBatch = useCallback(async () => {
    const batch = stateRef.current.selectedBatch;
    if (!batch || !canCancelBatch(batch.status)) return;
    if (isBatchTerminal(batch.status)) return;
    const op = beginMut("batch");
    if (op === null) return;
    try {
      const next = await invokeEngine("ai.batch.cancel", {
        batchId: batch.id,
        expectedRevision: batch.revision,
      });
      const _still = isCurrent("batch", op, "mut");
      endMut("batch", op);
      if (!_still) return;
      setState((s) => ({ ...s, selectedBatch: next }));
    } catch (error) {
      const _still = isCurrent("batch", op, "mut");
      endMut("batch", op);
      if (!_still) return;
      setState((s) => ({ ...s, error: toUiError(error) }));
    }
  }, [beginMut, endMut, isCurrent]);

  const resumeBatch = useCallback(async () => {
    const batch = stateRef.current.selectedBatch;
    if (!batch || !canResumeBatch(batch.status)) return;
    const op = beginMut("batch");
    if (op === null) return;
    try {
      const next = await invokeEngine("ai.batch.resume", {
        batchId: batch.id,
        expectedRevision: batch.revision,
      });
      const _still = isCurrent("batch", op, "mut");
      endMut("batch", op);
      if (!_still) return;
      setState((s) => ({ ...s, selectedBatch: next }));
    } catch (error) {
      const _still = isCurrent("batch", op, "mut");
      endMut("batch", op);
      if (!_still) return;
      setState((s) => ({ ...s, error: toUiError(error) }));
    }
  }, [beginMut, endMut, isCurrent]);

  const loadUsage = useCallback(
    async (offset = 0) => {
      const op = ++listOps.current.usage;
      try {
        const result = await invokeEngine("ai.usage.query", {
          dimension: stateRef.current.usageDimension,
          sinceMs: stateRef.current.usageSinceMs,
          untilMs: stateRef.current.usageUntilMs,
          limit: PAGE_SIZE,
          offset,
          projectId: gatewayRef.current.context?.projectId ?? null,
        });
        if (!isCurrent("usage", op, "list")) return;
        setState((s) => ({
          ...s,
          usage: result,
          usageOffset: result.offset,
          usageLimit: result.limit,
        }));
      } catch (error) {
        if (!isCurrent("usage", op, "list")) return;
        setState((s) => ({ ...s, error: toUiError(error) }));
      }
    },
    [isCurrent],
  );

  const setUsageRange = useCallback((sinceMs: number, untilMs: number) => {
    setState((s) => ({ ...s, usageSinceMs: sinceMs, usageUntilMs: untilMs }));
  }, []);

  const setUsageDimension = useCallback(
    (d: AiControllerState["usageDimension"]) => {
      setState((s) => ({ ...s, usageDimension: d }));
    },
    [],
  );

  const runQualityScore = useCallback(async () => {
    const ctx = gatewayRef.current.context;
    if (!ctx?.documentId) return;
    const op = beginMut("quality");
    if (op === null) return;
    try {
      const report = await invokeEngine("ai.quality.scoreDocument", {
        documentId: ctx.documentId,
      });
      const _still = isCurrent("quality", op, "mut");
      endMut("quality", op);
      if (!_still) return;
      setState((s) => ({ ...s, qualityScore: report }));
    } catch (error) {
      const _still = isCurrent("quality", op, "mut");
      endMut("quality", op);
      if (!_still) return;
      setState((s) => ({ ...s, error: toUiError(error) }));
    }
  }, [beginMut, endMut, isCurrent]);

  const runSemanticQa = useCallback(async () => {
    const ctx = gatewayRef.current.context;
    if (!ctx?.documentId) return;
    const op = beginMut("quality");
    if (op === null) return;
    try {
      const report = await invokeEngine("ai.quality.semanticQa", {
        documentId: ctx.documentId,
      });
      const _still = isCurrent("quality", op, "mut");
      endMut("quality", op);
      if (!_still) return;
      setState((s) => ({ ...s, qualitySemantic: report }));
    } catch (error) {
      const _still = isCurrent("quality", op, "mut");
      endMut("quality", op);
      if (!_still) return;
      setState((s) => ({ ...s, error: toUiError(error) }));
    }
  }, [beginMut, endMut, isCurrent]);

  const runExtractTerms = useCallback(async () => {
    const ctx = gatewayRef.current.context;
    if (!ctx?.documentId) return;
    const op = beginMut("quality");
    if (op === null) return;
    try {
      const report = await invokeEngine("ai.quality.extractTerms", {
        documentId: ctx.documentId,
      });
      if (!isCurrent("quality", op, "mut")) {
        endMut("quality", op);
        return;
      }
      endMut("quality", op);
      setState((s) => ({ ...s, qualityTerms: report }));
    } catch (error) {
      if (!isCurrent("quality", op, "mut")) {
        endMut("quality", op);
        return;
      }
      endMut("quality", op);
      setState((s) => ({ ...s, error: toUiError(error) }));
    }
  }, [beginMut, endMut, isCurrent]);

  const loadRuns = useCallback(
    async (offset = 0) => {
      const projectId = gatewayRef.current.context?.projectId;
      if (!projectId) return;
      const op = ++listOps.current.run;
      try {
        const page = await invokeEngine("ai.run.list", {
          projectId,
          limit: PAGE_SIZE,
          offset,
        });
        if (!isCurrent("run", op, "list")) return;
        setState((s) => ({
          ...s,
          runs: page.items,
          runsTotal: page.total,
          runsOffset: page.offset,
        }));
      } catch (error) {
        if (!isCurrent("run", op, "list")) return;
        setState((s) => ({ ...s, error: toUiError(error) }));
      }
    },
    [isCurrent],
  );

  const reopenRun = useCallback(
    async (runId: string) => {
      const op = ++listOps.current.run;
      try {
        const run = await invokeEngine("ai.run.get", { runId });
        if (!isCurrent("run", op, "list")) return;
        setState((s) => ({
          ...s,
          activeRun: run,
          eventReplay: createEmptyEventReplay(),
        }));
        if (!isRunTerminal(run.status)) {
          void pollRun(run.id);
        }
      } catch (error) {
        if (!isCurrent("run", op, "list")) return;
        setState((s) => ({ ...s, error: toUiError(error) }));
      }
    },
    [isCurrent, pollRun],
  );

  useEffect(() => {
    if (!gateway.active) {
      clearPoll();
      return;
    }
    void reloadProviders();
  }, [gateway.active, gateway.generation, reloadProviders, clearPoll]);

  useEffect(() => {
    if (!gateway.active) return;
    if (gateway.section === "interactive" || gateway.section === "quality") {
      void hydrateSegmentRevision();
    }
    if (gateway.section === "interactive" && gateway.context?.projectId) {
      void loadConversations();
      void loadRuns(0);
    }
    if (gateway.section === "batch" && gateway.context?.projectId) {
      void loadBatches();
    }
    if (gateway.section === "usage") {
      void loadUsage();
    }
  }, [
    gateway.active,
    gateway.section,
    gateway.context?.projectId,
    gateway.context?.documentId,
    gateway.context?.activeSegmentId,
    hydrateSegmentRevision,
    loadConversations,
    loadBatches,
    loadUsage,
    loadRuns,
  ]);

  return {
    state,
    invalidate,
    reloadProviders,
    selectProfile,
    beginCreateProfile,
    beginEditProfile,
    clearProviderForm,
    patchProviderForm,
    setConfigValue,
    createProfile,
    updateProfile,
    deleteProfile,
    testProfile,
    setCredentialSecret,
    saveCredential,
    deleteCredential,
    patchSettingsForm,
    saveSettings,
    loadConversations,
    createConversation,
    selectConversation,
    archiveConversation,
    setConversationTitle,
    loadMessages,
    previewGrounding,
    setPrompt: (prompt) => setState((s) => ({ ...s, prompt })),
    setAction: (action) => setState((s) => ({ ...s, action })),
    startRun,
    cancelRun,
    resumeRun,
    applyResult,
    discardProposal,
    loadBatches,
    startBatch,
    selectBatch,
    loadBatchItems,
    cancelBatch,
    resumeBatch,
    loadUsage,
    setUsageRange,
    setUsageDimension,
    runnableProfiles: listRunnableProfiles,
    runQualityScore,
    runSemanticQa,
    runExtractTerms,
    hydrateSegmentRevision,
    loadRuns,
    reopenRun,
  };
}

/** @internal re-export for structured surface errors */
export { formatAiError };
