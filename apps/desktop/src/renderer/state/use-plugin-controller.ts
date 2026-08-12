import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ExternalConnectorCatalogEntry,
  ExternalConnectorCheckpointView,
  ExternalConnectorInvokeResult,
  ExternalConnectorProfile,
  PluginBundledSummary,
  PluginCapabilityAuditEntry,
  PluginCapabilityRequestView,
  PluginCapabilityReview,
  PluginContributionDescriptor,
  PluginInspection,
  PluginSummary,
  PluginUiPanelView,
  PluginAiActionView,
  PluginVersionSummary,
} from "@translunar/contracts";

import { toUiError, type UiError } from "../lib/errors";
import { desktopApi, invokeEngine } from "../lib/rpc";
import {
  buildCreateConfiguration,
  mergeConfiguration,
  projectConnectorSchema,
  type ProjectedConfigField,
} from "./ai-view";
import {
  buildExternalConnectorRequest,
  mergeUnknownConfig,
  safeJsonPreview,
  type ConnectorFormInput,
  type ConnectorOperation,
} from "./external-connector-request";
import {
  isContributionOpenable,
  isPanelSessionUrl,
  requireActorReason,
  sessionMatchesRevocation,
} from "./plugin-view";
import type { P4ProjectContext } from "./p4-route-context";

export type ExternalConnectorDescriptor = Extract<
  PluginContributionDescriptor,
  { kind: "externalConnector" }
>;

export interface ConnectorProfileFormState {
  mode: "create" | "edit";
  contributionId: string;
  pluginId: string;
  profileId: string | null;
  displayName: string;
  enabled: boolean;
  configFields: ProjectedConfigField[];
  configValues: Record<string, string | boolean | number>;
  schemaOk: boolean;
  unsupported: string[];
}

function connectorOwnerKey(pluginId: string, contributionId: string): string {
  return `${pluginId}:${contributionId}`;
}

function asExternalConnectorDescriptor(
  d: PluginContributionDescriptor | undefined,
): ExternalConnectorDescriptor | null {
  return d?.kind === "externalConnector" ? d : null;
}

export interface PluginControllerGateway {
  generation: number;
  mutationsEnabled: boolean;
  active: boolean;
  section: string;
  context: P4ProjectContext | null;
}

export interface PluginPanelSessionState {
  pluginId: string;
  contributionId: string;
  activationRevision: number;
  sessionId: string;
  url: string;
  expiresAtMs: number;
}

export interface PluginControllerState {
  loading: boolean;
  error: UiError | null;
  installed: PluginSummary[];
  installedTotal: number;
  installedOffset: number;
  bundled: PluginBundledSummary[];
  selectedPluginId: string | null;
  inspection: PluginInspection | null;
  inspectionPath: string | null;
  versions: PluginVersionSummary[];
  permissionRequests: PluginCapabilityRequestView[];
  permissionReview: PluginCapabilityReview | null;
  audit: PluginCapabilityAuditEntry[];
  actor: string;
  reason: string;
  mutationPending: boolean;
  aiActions: PluginAiActionView[];
  uiPanels: PluginUiPanelView[];
  panelSession: PluginPanelSessionState | null;
  connectors: ExternalConnectorCatalogEntry[];
  profiles: ExternalConnectorProfile[];
  selectedProfileId: string | null;
  invokeResult: ExternalConnectorInvokeResult | null;
  checkpoint: ExternalConnectorCheckpointView | null;
  connectorOp: ConnectorOperation;
  connectorForm: {
    streamId: string;
    limit: number;
    itemsJson: string;
    eventId: string;
    eventType: string;
    bodyJson: string;
  };
  credentialSlot: string;
  credentialSecret: string;
  actionConfig: Record<string, string | boolean | number>;
  actionResult: string | null;
  actionHistory: unknown[];
  selectedActionId: string | null;
  activeInvocationId: string | null;
  connectorDescriptors: Record<string, ExternalConnectorDescriptor>;
  profileForm: ConnectorProfileFormState | null;
}

type Domain =
  | "installed"
  | "bundled"
  | "permissions"
  | "actions"
  | "panels"
  | "connectors"
  | "lifecycle";

function initialState(): PluginControllerState {
  return {
    loading: false,
    error: null,
    installed: [],
    installedTotal: 0,
    installedOffset: 0,
    bundled: [],
    selectedPluginId: null,
    inspection: null,
    inspectionPath: null,
    versions: [],
    permissionRequests: [],
    permissionReview: null,
    audit: [],
    actor: "local-user",
    reason: "",
    mutationPending: false,
    aiActions: [],
    uiPanels: [],
    panelSession: null,
    connectors: [],
    profiles: [],
    selectedProfileId: null,
    invokeResult: null,
    checkpoint: null,
    connectorOp: "test",
    connectorForm: {
      streamId: "",
      limit: 25,
      itemsJson: "[]",
      eventId: "",
      eventType: "",
      bodyJson: "{}",
    },
    credentialSlot: "",
    credentialSecret: "",
    actionConfig: {},
    actionResult: null,
    actionHistory: [],
    selectedActionId: null,
    activeInvocationId: null,
    connectorDescriptors: {},
    profileForm: null,
  };
}

export interface PluginControllerApi {
  state: PluginControllerState;
  invalidate: () => void;
  setActor: (v: string) => void;
  setReason: (v: string) => void;
  reloadInstalled: (offset?: number) => Promise<void>;
  reloadBundled: () => Promise<void>;
  selectPlugin: (id: string | null) => Promise<void>;
  pickAndInspect: () => Promise<void>;
  confirmInstall: () => Promise<void>;
  confirmUpgrade: (pluginId: string) => Promise<void>;
  enablePlugin: (pluginId: string, revision: number) => Promise<void>;
  disablePlugin: (pluginId: string, revision: number) => Promise<void>;
  uninstallPlugin: (pluginId: string, revision: number) => Promise<void>;
  applyBundled: (pluginId: string) => Promise<void>;
  loadVersions: (pluginId: string) => Promise<void>;
  rollbackVersion: (
    pluginId: string,
    versionId: string,
    revision: number,
  ) => Promise<void>;
  loadPermissions: (pluginId: string) => Promise<void>;
  reviewPermissions: (pluginId: string) => Promise<void>;
  grantPermission: (request: PluginCapabilityRequestView) => Promise<boolean>;
  denyPermission: (request: PluginCapabilityRequestView) => Promise<boolean>;
  revokePermission: (request: PluginCapabilityRequestView) => Promise<boolean>;
  loadAiActions: () => Promise<void>;
  setActionConfigValue: (key: string, value: string | boolean | number) => void;
  invokeAiAction: (action: PluginAiActionView) => Promise<void>;
  cancelAiAction: (invocationId?: string) => Promise<void>;
  loadAiActionHistory: (pluginId?: string) => Promise<void>;
  loadUiPanels: () => Promise<void>;
  openUiPanel: (panel: PluginUiPanelView) => Promise<void>;
  closeUiPanel: () => Promise<void>;
  loadConnectors: () => Promise<void>;
  selectProfile: (id: string | null) => void;
  beginCreateProfile: (entry: ExternalConnectorCatalogEntry) => void;
  beginEditProfile: (profileId: string) => void;
  clearProfileForm: () => void;
  patchProfileForm: (patch: Partial<ConnectorProfileFormState>) => void;
  setProfileConfigValue: (
    key: string,
    value: string | boolean | number,
  ) => void;
  createProfile: () => Promise<void>;
  updateProfile: () => Promise<void>;
  deleteProfile: (profileId: string, revision: number) => Promise<void>;
  setCredential: () => Promise<void>;
  deleteCredential: () => Promise<void>;
  setConnectorOp: (op: ConnectorOperation) => void;
  patchConnectorForm: (
    patch: Partial<PluginControllerState["connectorForm"]>,
  ) => void;
  setCredentialSlot: (slot: string) => void;
  setCredentialSecret: (secret: string) => void;
  invokeConnector: () => Promise<void>;
  loadCheckpoint: (streamId: string) => Promise<void>;
  clearInspection: () => void;
}

export function usePluginController(
  gateway: PluginControllerGateway,
): PluginControllerApi {
  const [state, setState] = useState(initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const gatewayRef = useRef(gateway);
  gatewayRef.current = gateway;
  const ops = useRef<Record<Domain, number>>({
    installed: 0,
    bundled: 0,
    permissions: 0,
    actions: 0,
    panels: 0,
    connectors: 0,
    lifecycle: 0,
  });
  const pending = useRef<Record<Domain, number>>({
    installed: 0,
    bundled: 0,
    permissions: 0,
    actions: 0,
    panels: 0,
    connectors: 0,
    lifecycle: 0,
  });
  const genRef = useRef(gateway.generation);
  const revokeUnsub = useRef<(() => void) | null>(null);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sectionRef = useRef(gateway.section);
  sectionRef.current = gateway.section;
  /** Post-lifecycle authoritative refresh across dependent projections. */
  const refreshDependentRef = useRef<() => Promise<void>>(async () => {});

  const current = useCallback((d: Domain, op: number) => {
    return (
      gatewayRef.current.active &&
      gatewayRef.current.generation === genRef.current &&
      ops.current[d] === op
    );
  }, []);

  const begin = useCallback((d: Domain): number | null => {
    if (!gatewayRef.current.mutationsEnabled) return null;
    if (pending.current[d] > 0) return null;
    const op = ++ops.current[d];
    pending.current[d] = op;
    return op;
  }, []);

  const end = useCallback((d: Domain, op: number) => {
    if (pending.current[d] === op) pending.current[d] = 0;
  }, []);

  const clearExpiryTimer = useCallback(() => {
    if (expiryTimer.current) {
      clearTimeout(expiryTimer.current);
      expiryTimer.current = null;
    }
  }, []);

  const closeUiPanel = useCallback(async () => {
    clearExpiryTimer();
    const session = stateRef.current.panelSession;
    if (!session) return;
    // Drop local mount immediately; revoke is best-effort authority cleanup.
    setState((s) => ({ ...s, panelSession: null }));
    try {
      await desktopApi().revokePluginPanelSession(session.sessionId);
    } catch {
      /* still unmounted */
    }
  }, [clearExpiryTimer]);

  const schedulePanelExpiry = useCallback(
    (session: PluginPanelSessionState) => {
      clearExpiryTimer();
      const remaining = session.expiresAtMs - Date.now();
      if (remaining <= 0) {
        void closeUiPanel();
        return;
      }
      expiryTimer.current = setTimeout(() => {
        const live = stateRef.current.panelSession;
        if (live?.sessionId === session.sessionId) {
          void closeUiPanel();
        }
      }, remaining);
    },
    [clearExpiryTimer, closeUiPanel],
  );

  const invalidate = useCallback(() => {
    genRef.current = gatewayRef.current.generation;
    for (const k of Object.keys(ops.current) as Domain[]) {
      ops.current[k] += 1;
      pending.current[k] = 0;
    }
    setState((s) => (s.mutationPending ? { ...s, mutationPending: false } : s));
    void closeUiPanel();
  }, [closeUiPanel]);

  useEffect(() => {
    if (gateway.generation !== genRef.current) invalidate();
  }, [gateway.generation, invalidate]);

  // Revoke authorized panel when leaving uiPanels (section change keeps surface active).
  useEffect(() => {
    if (!gateway.active) return;
    if (gateway.section !== "uiPanels") {
      void closeUiPanel();
    }
  }, [gateway.active, gateway.section, closeUiPanel]);

  useEffect(() => {
    if (!gateway.active) {
      void closeUiPanel();
      revokeUnsub.current?.();
      revokeUnsub.current = null;
      return;
    }
    revokeUnsub.current = desktopApi().onPluginPanelRevoked((pluginId) => {
      clearExpiryTimer();
      setState((s) => {
        if (sessionMatchesRevocation(s.panelSession, pluginId)) {
          return { ...s, panelSession: null };
        }
        return s;
      });
    });
    return () => {
      revokeUnsub.current?.();
      revokeUnsub.current = null;
      void closeUiPanel();
    };
  }, [gateway.active, closeUiPanel, clearExpiryTimer]);

  const reloadInstalled = useCallback(
    async (offset = 0) => {
      const op = ++ops.current.installed;
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const page = await invokeEngine("plugin.list", {
          limit: 50,
          offset,
        });
        if (!current("installed", op)) return;
        setState((s) => ({
          ...s,
          loading: false,
          installed: page.items,
          installedTotal: page.total,
          installedOffset: offset,
        }));
      } catch (error) {
        if (!current("installed", op)) return;
        setState((s) => ({
          ...s,
          loading: false,
          error: toUiError(error),
        }));
      }
    },
    [current],
  );

  const reloadBundled = useCallback(async () => {
    const op = ++ops.current.bundled;
    try {
      const page = await invokeEngine("plugin.bundled.list", {
        limit: 100,
        offset: 0,
      });
      if (!current("bundled", op)) return;
      setState((s) => ({ ...s, bundled: page.items }));
    } catch (error) {
      if (!current("bundled", op)) return;
      setState((s) => ({ ...s, error: toUiError(error) }));
    }
  }, [current]);

  const selectPlugin = useCallback(
    async (id: string | null) => {
      setState((s) => ({ ...s, selectedPluginId: id }));
      if (!id) return;
      const op = ++ops.current.installed;
      try {
        const plugin = await invokeEngine("plugin.get", { pluginId: id });
        if (!current("installed", op)) return;
        setState((s) => ({
          ...s,
          installed: s.installed.map((p) => (p.id === id ? plugin : p)),
        }));
      } catch (error) {
        if (!current("installed", op)) return;
        setState((s) => ({ ...s, error: toUiError(error) }));
      }
    },
    [current],
  );

  const pickAndInspect = useCallback(async () => {
    const path = await desktopApi().selectPluginPackage();
    if (!path) return;
    const op = begin("lifecycle");
    if (op === null) return;
    setState((s) => ({ ...s, mutationPending: true, error: null }));
    try {
      const inspection = await invokeEngine("plugin.inspect", {
        sourcePath: path,
      });
      const _still = current("lifecycle", op);
      end("lifecycle", op);
      if (!_still) return;
      setState((s) => ({
        ...s,
        mutationPending: false,
        inspection,
        inspectionPath: path,
      }));
    } catch (error) {
      const _still = current("lifecycle", op);
      end("lifecycle", op);
      if (!_still) return;
      setState((s) => ({
        ...s,
        mutationPending: false,
        error: toUiError(error),
      }));
    }
  }, [begin, current, end]);

  const confirmInstall = useCallback(async () => {
    const path = stateRef.current.inspectionPath;
    if (!path) return;
    const guard = requireActorReason(
      stateRef.current.actor,
      stateRef.current.reason || "install",
    );
    if (!guard.ok) {
      setState((s) => ({
        ...s,
        error: {
          code: "VALIDATION",
          message: `${guard.field} is required`,
          kind: "domain",
        },
      }));
      return;
    }
    const op = begin("lifecycle");
    if (op === null) return;
    setState((s) => ({ ...s, mutationPending: true, error: null }));
    try {
      await invokeEngine("plugin.install", {
        sourcePath: path,
        actor: stateRef.current.actor,
        reason: stateRef.current.reason || "install",
      });
      const _still = current("lifecycle", op);
      end("lifecycle", op);
      if (!_still) return;
      setState((s) => ({
        ...s,
        mutationPending: false,
        inspection: null,
        inspectionPath: null,
      }));
      await refreshDependentRef.current();
    } catch (error) {
      const _still = current("lifecycle", op);
      end("lifecycle", op);
      if (!_still) return;
      setState((s) => ({
        ...s,
        mutationPending: false,
        error: toUiError(error),
      }));
    }
  }, [begin, current, end]);

  const confirmUpgrade = useCallback(
    async (pluginId: string) => {
      const path = stateRef.current.inspectionPath;
      if (!path) return;
      const plugin = stateRef.current.installed.find((p) => p.id === pluginId);
      if (!plugin) return;
      const op = begin("lifecycle");
      if (op === null) return;
      setState((s) => ({ ...s, mutationPending: true, error: null }));
      try {
        await invokeEngine("plugin.upgrade", {
          pluginId,
          sourcePath: path,
          expectedRevision: plugin.revision,
          actor: stateRef.current.actor,
          reason: stateRef.current.reason || "upgrade",
        });
        const _still = current("lifecycle", op);
        end("lifecycle", op);
        if (!_still) return;
        setState((s) => ({
          ...s,
          mutationPending: false,
          inspection: null,
          inspectionPath: null,
        }));
        await refreshDependentRef.current();
      } catch (error) {
        const _still = current("lifecycle", op);
        end("lifecycle", op);
        if (!_still) return;
        setState((s) => ({
          ...s,
          mutationPending: false,
          error: toUiError(error),
        }));
      }
    },
    [begin, current, end],
  );

  const enablePlugin = useCallback(
    async (pluginId: string, revision: number) => {
      const op = begin("lifecycle");
      if (op === null) return;
      try {
        await invokeEngine("plugin.enable", {
          pluginId,
          expectedRevision: revision,
          actor: stateRef.current.actor,
          reason: stateRef.current.reason || "enable",
        });
        const _still = current("lifecycle", op);
        end("lifecycle", op);
        if (!_still) return;
        await refreshDependentRef.current();
      } catch (error) {
        const _still = current("lifecycle", op);
        end("lifecycle", op);
        if (!_still) return;
        setState((s) => ({ ...s, error: toUiError(error) }));
      }
    },
    [begin, current, end],
  );

  const disablePlugin = useCallback(
    async (pluginId: string, revision: number) => {
      if (stateRef.current.panelSession?.pluginId === pluginId) {
        await closeUiPanel();
      }
      const op = begin("lifecycle");
      if (op === null) return;
      try {
        await invokeEngine("plugin.disable", {
          pluginId,
          expectedRevision: revision,
          actor: stateRef.current.actor,
          reason: stateRef.current.reason || "disable",
        });
        const _still = current("lifecycle", op);
        end("lifecycle", op);
        if (!_still) return;
        await refreshDependentRef.current();
      } catch (error) {
        const _still = current("lifecycle", op);
        end("lifecycle", op);
        if (!_still) return;
        setState((s) => ({ ...s, error: toUiError(error) }));
      }
    },
    [begin, closeUiPanel, current, end],
  );

  const uninstallPlugin = useCallback(
    async (pluginId: string, revision: number) => {
      if (stateRef.current.panelSession?.pluginId === pluginId) {
        await closeUiPanel();
      }
      const op = begin("lifecycle");
      if (op === null) return;
      try {
        await invokeEngine("plugin.uninstall", {
          pluginId,
          expectedRevision: revision,
          actor: stateRef.current.actor,
          reason: stateRef.current.reason || "uninstall",
        });
        const _still = current("lifecycle", op);
        end("lifecycle", op);
        if (!_still) return;
        await refreshDependentRef.current();
      } catch (error) {
        const _still = current("lifecycle", op);
        end("lifecycle", op);
        if (!_still) return;
        setState((s) => ({ ...s, error: toUiError(error) }));
      }
    },
    [begin, closeUiPanel, current, end],
  );

  const applyBundled = useCallback(
    async (pluginId: string) => {
      const op = begin("lifecycle");
      if (op === null) return;
      try {
        await invokeEngine("plugin.bundled.apply", {
          pluginId,
          actor: stateRef.current.actor,
          reason: stateRef.current.reason || "bundled.apply",
        });
        const _still = current("lifecycle", op);
        end("lifecycle", op);
        if (!_still) return;
        await refreshDependentRef.current();
      } catch (error) {
        const _still = current("lifecycle", op);
        end("lifecycle", op);
        if (!_still) return;
        setState((s) => ({ ...s, error: toUiError(error) }));
      }
    },
    [begin, current, end],
  );

  const loadVersions = useCallback(
    async (pluginId: string) => {
      const op = ++ops.current.installed;
      try {
        const page = await invokeEngine("plugin.version.list", {
          pluginId,
          limit: 50,
          offset: 0,
        });
        if (!current("installed", op)) return;
        setState((s) => ({ ...s, versions: page.items }));
      } catch (error) {
        if (!current("installed", op)) return;
        setState((s) => ({ ...s, error: toUiError(error) }));
      }
    },
    [current],
  );

  const rollbackVersion = useCallback(
    async (pluginId: string, versionId: string, revision: number) => {
      const op = begin("lifecycle");
      if (op === null) return;
      try {
        await invokeEngine("plugin.rollback", {
          pluginId,
          versionId,
          expectedRevision: revision,
          actor: stateRef.current.actor,
          reason: stateRef.current.reason || "rollback",
        });
        const _still = current("lifecycle", op);
        end("lifecycle", op);
        if (!_still) return;
        await refreshDependentRef.current();
      } catch (error) {
        const _still = current("lifecycle", op);
        end("lifecycle", op);
        if (!_still) return;
        setState((s) => ({ ...s, error: toUiError(error) }));
      }
    },
    [begin, current, end],
  );

  const loadPermissions = useCallback(
    async (pluginId: string) => {
      const op = ++ops.current.permissions;
      try {
        const [requests, audit] = await Promise.all([
          invokeEngine("plugin.permission.request.list", {
            pluginId,
            limit: 50,
            offset: 0,
          }),
          invokeEngine("plugin.permission.audit.list", {
            pluginId,
            limit: 50,
            offset: 0,
          }),
        ]);
        if (!current("permissions", op)) return;
        setState((s) => ({
          ...s,
          permissionRequests: requests.items,
          audit: audit.items,
        }));
      } catch (error) {
        if (!current("permissions", op)) return;
        setState((s) => ({ ...s, error: toUiError(error) }));
      }
    },
    [current],
  );

  const reviewPermissions = useCallback(
    async (pluginId: string) => {
      const op = ++ops.current.permissions;
      try {
        const review = await invokeEngine("plugin.permission.review", {
          pluginId,
        });
        if (!current("permissions", op)) return;
        setState((s) => ({
          ...s,
          permissionReview: review,
          permissionRequests: review.requests,
          selectedPluginId: pluginId,
        }));
      } catch (error) {
        if (!current("permissions", op)) return;
        setState((s) => ({ ...s, error: toUiError(error) }));
      }
    },
    [current],
  );

  const grantPermission = useCallback(
    async (request: PluginCapabilityRequestView): Promise<boolean> => {
      const guard = requireActorReason(
        stateRef.current.actor,
        stateRef.current.reason,
      );
      if (!guard.ok) {
        setState((s) => ({
          ...s,
          error: {
            code: "VALIDATION",
            message: `${guard.field} is required`,
            kind: "domain",
          },
        }));
        return false;
      }
      const op = begin("permissions");
      if (op === null) return false;
      setState((s) => ({ ...s, mutationPending: true, error: null }));
      try {
        await invokeEngine("plugin.permission.grant", {
          pluginId: request.pluginId,
          requestId: request.id,
          expectedRevision: request.revision,
          actor: stateRef.current.actor,
          reason: stateRef.current.reason,
          scope: request.requestedScope,
        });
        const _still = current("permissions", op);
        end("permissions", op);
        if (!_still) return false;
        setState((s) => ({ ...s, mutationPending: false }));
        await loadPermissions(request.pluginId);
        return true;
      } catch (error) {
        const _still = current("permissions", op);
        end("permissions", op);
        if (!_still) return false;
        setState((s) => ({
          ...s,
          mutationPending: false,
          error: toUiError(error),
        }));
        return false;
      }
    },
    [begin, current, end, loadPermissions],
  );

  const denyPermission = useCallback(
    async (request: PluginCapabilityRequestView): Promise<boolean> => {
      const guard = requireActorReason(
        stateRef.current.actor,
        stateRef.current.reason,
      );
      if (!guard.ok) {
        setState((s) => ({
          ...s,
          error: {
            code: "VALIDATION",
            message: `${guard.field} is required`,
            kind: "domain",
          },
        }));
        return false;
      }
      const op = begin("permissions");
      if (op === null) return false;
      setState((s) => ({ ...s, mutationPending: true, error: null }));
      try {
        await invokeEngine("plugin.permission.deny", {
          pluginId: request.pluginId,
          requestId: request.id,
          expectedRevision: request.revision,
          actor: stateRef.current.actor,
          reason: stateRef.current.reason,
        });
        const _still = current("permissions", op);
        end("permissions", op);
        if (!_still) return false;
        setState((s) => ({ ...s, mutationPending: false }));
        await loadPermissions(request.pluginId);
        return true;
      } catch (error) {
        const _still = current("permissions", op);
        end("permissions", op);
        if (!_still) return false;
        setState((s) => ({
          ...s,
          mutationPending: false,
          error: toUiError(error),
        }));
        return false;
      }
    },
    [begin, current, end, loadPermissions],
  );

  const revokePermission = useCallback(
    async (request: PluginCapabilityRequestView): Promise<boolean> => {
      const guard = requireActorReason(
        stateRef.current.actor,
        stateRef.current.reason,
      );
      if (!guard.ok) {
        setState((s) => ({
          ...s,
          error: {
            code: "VALIDATION",
            message: `${guard.field} is required`,
            kind: "domain",
          },
        }));
        return false;
      }
      const op = begin("permissions");
      if (op === null) return false;
      setState((s) => ({ ...s, mutationPending: true, error: null }));
      try {
        await invokeEngine("plugin.permission.revoke", {
          pluginId: request.pluginId,
          requestId: request.id,
          expectedRevision: request.revision,
          actor: stateRef.current.actor,
          reason: stateRef.current.reason,
        });
        const _still = current("permissions", op);
        end("permissions", op);
        if (!_still) return false;
        setState((s) => ({ ...s, mutationPending: false }));
        await loadPermissions(request.pluginId);
        return true;
      } catch (error) {
        const _still = current("permissions", op);
        end("permissions", op);
        if (!_still) return false;
        setState((s) => ({
          ...s,
          mutationPending: false,
          error: toUiError(error),
        }));
        return false;
      }
    },
    [begin, current, end, loadPermissions],
  );

  const loadAiActions = useCallback(async () => {
    const op = ++ops.current.actions;
    try {
      const page = await invokeEngine("plugin.aiAction.list", {});
      if (!current("actions", op)) return;
      setState((s) => ({ ...s, aiActions: page.items }));
    } catch (error) {
      if (!current("actions", op)) return;
      setState((s) => ({ ...s, error: toUiError(error) }));
    }
  }, [current]);

  const setActionConfigValue = useCallback(
    (key: string, value: string | boolean | number) => {
      setState((s) => ({
        ...s,
        actionConfig: { ...s.actionConfig, [key]: value },
      }));
    },
    [],
  );

  const hydrateAiActionContext = useCallback(async () => {
    const ctx = gatewayRef.current.context;
    let segmentText = "";
    let sourceText = "";
    let sourceLocale = "";
    let targetLocale = "";
    if (ctx?.documentId && ctx.activeSegmentId) {
      try {
        const page = await invokeEngine("segment.editor.list", {
          documentId: ctx.documentId,
          limit: 200,
          offset: 0,
        });
        const row = page.items.find(
          (r) => r.segment.id === ctx.activeSegmentId,
        );
        if (row) {
          sourceText = row.segment.sourceText;
          segmentText =
            row.segment.targetText.length > 0
              ? row.segment.targetText
              : row.segment.sourceText;
        }
      } catch {
        /* keep empty bounded context */
      }
    }
    if (ctx?.projectId) {
      try {
        const snap = await invokeEngine("project.get", {
          projectId: ctx.projectId,
        });
        sourceLocale = snap.project.sourceLocale;
        targetLocale = snap.project.targetLocale;
      } catch {
        /* keep empty locales */
      }
    }
    return { segmentText, sourceText, sourceLocale, targetLocale };
  }, []);

  const invokeAiAction = useCallback(
    async (action: PluginAiActionView) => {
      if (!isContributionOpenable(action.state)) return;
      const op = begin("actions");
      if (op === null) return;
      const invocationId = `inv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      setState((s) => ({
        ...s,
        mutationPending: true,
        error: null,
        selectedActionId: action.descriptor.id,
        activeInvocationId: invocationId,
        actionResult: null,
      }));
      try {
        const actionContext = await hydrateAiActionContext();
        if (!current("actions", op)) {
          end("actions", op);
          return;
        }
        const result = await invokeEngine("plugin.aiAction.invoke", {
          invocation: {
            contributionId: action.owner.contributionId,
            operation: action.descriptor.id,
            protocolVersion: action.descriptor.operationProtocolVersion ?? 1,
            configSchemaVersion: action.descriptor.configSchemaVersion ?? 1,
            config: stateRef.current.actionConfig,
            invocationId,
            deadlineMs: action.descriptor.limits?.maxDeadlineMs ?? 30_000,
            context: actionContext,
          },
        });
        const _still = current("actions", op);
        end("actions", op);
        if (!_still) return;
        setState((s) => ({
          ...s,
          mutationPending: false,
          actionResult: safeJsonPreview(result),
          activeInvocationId: invocationId,
        }));
      } catch (error) {
        const _still = current("actions", op);
        end("actions", op);
        if (!_still) return;
        setState((s) => ({
          ...s,
          mutationPending: false,
          error: toUiError(error),
          activeInvocationId: invocationId,
        }));
      }
    },
    [begin, current, end, hydrateAiActionContext],
  );

  const cancelAiAction = useCallback(
    async (invocationId?: string) => {
      const id = invocationId || stateRef.current.activeInvocationId;
      if (!id) return;
      const op = begin("actions");
      if (op === null) return;
      setState((s) => ({ ...s, mutationPending: true, error: null }));
      try {
        await invokeEngine("plugin.aiAction.cancel", { invocationId: id });
        const _still = current("actions", op);
        end("actions", op);
        if (!_still) return;
        setState((s) => ({
          ...s,
          mutationPending: false,
          actionResult: null,
          activeInvocationId: null,
        }));
      } catch (error) {
        const _still = current("actions", op);
        end("actions", op);
        if (!_still) return;
        setState((s) => ({
          ...s,
          mutationPending: false,
          error: toUiError(error),
        }));
      }
    },
    [begin, current, end],
  );

  const loadAiActionHistory = useCallback(
    async (pluginId?: string) => {
      const op = ++ops.current.actions;
      try {
        const page = await invokeEngine("plugin.aiAction.history.list", {
          limit: 50,
          offset: 0,
          ...(pluginId ? { pluginId } : {}),
        });
        if (!current("actions", op)) return;
        setState((s) => ({ ...s, actionHistory: page.items }));
      } catch (error) {
        if (!current("actions", op)) return;
        setState((s) => ({ ...s, error: toUiError(error) }));
      }
    },
    [current],
  );

  const loadUiPanels = useCallback(async () => {
    const op = ++ops.current.panels;
    try {
      const page = await invokeEngine("plugin.uiPanel.list", {});
      if (!current("panels", op)) return;
      setState((s) => ({ ...s, uiPanels: page.items }));
    } catch (error) {
      if (!current("panels", op)) return;
      setState((s) => ({ ...s, error: toUiError(error) }));
    }
  }, [current]);

  const openUiPanel = useCallback(
    async (panel: PluginUiPanelView) => {
      if (!isContributionOpenable(panel.state)) return;
      await closeUiPanel();
      const op = begin("panels");
      if (op === null) return;
      const issueOwner = {
        pluginId: panel.owner.pluginId,
        contributionId: panel.owner.contributionId,
        activationRevision: panel.owner.activationRevision,
      };
      try {
        const session = await desktopApi().issuePluginPanelSession({
          pluginId: issueOwner.pluginId,
          contributionId: issueOwner.contributionId,
          revision: issueOwner.activationRevision,
        });
        const still = current("panels", op);
        end("panels", op);
        const sectionOk = gatewayRef.current.section === "uiPanels";
        const activeOk = gatewayRef.current.active;
        if (!still || !sectionOk || !activeOk) {
          try {
            await desktopApi().revokePluginPanelSession(session.sessionId);
          } catch {
            /* drop */
          }
          return;
        }
        if (
          typeof session.expiresAtMs === "number" &&
          session.expiresAtMs <= Date.now()
        ) {
          try {
            await desktopApi().revokePluginPanelSession(session.sessionId);
          } catch {
            /* drop */
          }
          setState((s) => ({
            ...s,
            error: {
              code: "PANEL_SESSION_EXPIRED",
              message: "Panel session expired before mount",
              kind: "domain",
            },
          }));
          return;
        }
        if (!isPanelSessionUrl(session.url)) {
          try {
            await desktopApi().revokePluginPanelSession(session.sessionId);
          } catch {
            /* drop */
          }
          setState((s) => ({
            ...s,
            error: {
              code: "INVALID_PANEL_URL",
              message: "Panel session URL is not authorized",
              kind: "domain",
            },
          }));
          return;
        }
        const mounted: PluginPanelSessionState = {
          pluginId: issueOwner.pluginId,
          contributionId: issueOwner.contributionId,
          activationRevision: issueOwner.activationRevision,
          sessionId: session.sessionId,
          url: session.url,
          expiresAtMs: session.expiresAtMs,
        };
        setState((s) => ({
          ...s,
          panelSession: mounted,
        }));
        schedulePanelExpiry(mounted);
      } catch (error) {
        const still = current("panels", op);
        end("panels", op);
        if (!still) return;
        setState((s) => ({ ...s, error: toUiError(error) }));
      }
    },
    [begin, closeUiPanel, current, end, schedulePanelExpiry],
  );

  const loadConnectors = useCallback(async () => {
    const op = ++ops.current.connectors;
    try {
      const [catalog, profiles] = await Promise.all([
        invokeEngine("externalConnector.catalog", {}),
        invokeEngine("externalConnector.profile.list", {
          limit: 50,
          offset: 0,
        }),
      ]);
      if (!current("connectors", op)) return;
      const pluginIds = [
        ...new Set(catalog.items.map((c) => c.owner.pluginId)),
      ];
      const descriptors: Record<string, ExternalConnectorDescriptor> = {};
      await Promise.all(
        pluginIds.map(async (pluginId) => {
          try {
            const plugin = await invokeEngine("plugin.get", { pluginId });
            for (const contrib of plugin.contributions ?? []) {
              const ext = asExternalConnectorDescriptor(contrib);
              if (ext) {
                descriptors[connectorOwnerKey(pluginId, ext.id)] = ext;
              }
            }
          } catch {
            /* leave missing; create/edit will mark unsupported */
          }
        }),
      );
      if (!current("connectors", op)) return;
      setState((s) => ({
        ...s,
        connectors: catalog.items,
        profiles: profiles.items,
        connectorDescriptors: descriptors,
      }));
    } catch (error) {
      if (!current("connectors", op)) return;
      setState((s) => ({ ...s, error: toUiError(error) }));
    }
  }, [current]);

  const selectProfile = useCallback((id: string | null) => {
    setState((s) => ({
      ...s,
      selectedProfileId: id,
      invokeResult: null,
      credentialSlot: "",
      credentialSecret: "",
    }));
  }, []);

  const beginCreateProfile = useCallback(
    (entry: ExternalConnectorCatalogEntry) => {
      if (entry.state !== "active") return;
      const key = connectorOwnerKey(
        entry.owner.pluginId,
        entry.owner.contributionId,
      );
      const descriptor = stateRef.current.connectorDescriptors[key] ?? null;
      const projected = projectConnectorSchema(descriptor?.configSchema);
      const configValues: Record<string, string | boolean | number> = {};
      if (projected.ok) {
        for (const f of projected.fields) {
          if (f.defaultValue !== null) configValues[f.key] = f.defaultValue;
        }
      }
      setState((s) => ({
        ...s,
        selectedProfileId: null,
        profileForm: {
          mode: "create",
          contributionId: entry.owner.contributionId,
          pluginId: entry.owner.pluginId,
          profileId: null,
          displayName: entry.displayName,
          enabled: true,
          configFields: projected.ok ? projected.fields : [],
          configValues,
          schemaOk: projected.ok,
          unsupported: projected.ok ? [] : projected.unsupportedKeys,
        },
        error: null,
      }));
    },
    [],
  );

  const beginEditProfile = useCallback((profileId: string) => {
    const profile = stateRef.current.profiles.find((p) => p.id === profileId);
    if (!profile) return;
    const key = connectorOwnerKey(profile.pluginId, profile.contributionId);
    const descriptor = stateRef.current.connectorDescriptors[key] ?? null;
    const projected = projectConnectorSchema(descriptor?.configSchema);
    const configValues: Record<string, string | boolean | number> = {};
    const cfg =
      profile.configuration &&
      typeof profile.configuration === "object" &&
      !Array.isArray(profile.configuration)
        ? (profile.configuration as Record<string, unknown>)
        : {};
    if (projected.ok) {
      for (const f of projected.fields) {
        const v = cfg[f.key];
        if (
          typeof v === "string" ||
          typeof v === "boolean" ||
          typeof v === "number"
        ) {
          configValues[f.key] = v;
        } else if (f.defaultValue !== null) {
          configValues[f.key] = f.defaultValue;
        }
      }
    }
    setState((s) => ({
      ...s,
      selectedProfileId: profileId,
      profileForm: {
        mode: "edit",
        contributionId: profile.contributionId,
        pluginId: profile.pluginId,
        profileId,
        displayName: profile.displayName,
        enabled: profile.enabled,
        configFields: projected.ok ? projected.fields : [],
        configValues,
        schemaOk: projected.ok,
        unsupported: projected.ok ? [] : projected.unsupportedKeys,
      },
      error: null,
    }));
  }, []);

  const clearProfileForm = useCallback(() => {
    setState((s) => ({ ...s, profileForm: null }));
  }, []);

  const patchProfileForm = useCallback(
    (patch: Partial<ConnectorProfileFormState>) => {
      setState((s) =>
        s.profileForm
          ? { ...s, profileForm: { ...s.profileForm, ...patch } }
          : s,
      );
    },
    [],
  );

  const setProfileConfigValue = useCallback(
    (key: string, value: string | boolean | number) => {
      setState((s) => {
        if (!s.profileForm) return s;
        return {
          ...s,
          profileForm: {
            ...s.profileForm,
            configValues: { ...s.profileForm.configValues, [key]: value },
          },
        };
      });
    },
    [],
  );

  const createProfile = useCallback(async () => {
    const form = stateRef.current.profileForm;
    if (!form || form.mode !== "create" || !form.schemaOk) return;
    const entry = stateRef.current.connectors.find(
      (c) =>
        c.owner.contributionId === form.contributionId &&
        c.owner.pluginId === form.pluginId,
    );
    if (!entry || entry.state !== "active") return;
    const op = begin("connectors");
    if (op === null) return;
    setState((s) => ({ ...s, mutationPending: true, error: null }));
    try {
      await invokeEngine("externalConnector.profile.create", {
        contributionId: form.contributionId,
        displayName: form.displayName,
        configuration: buildCreateConfiguration(
          form.configFields,
          form.configValues,
        ),
        enabled: form.enabled,
      });
      const _still = current("connectors", op);
      end("connectors", op);
      if (!_still) return;
      setState((s) => ({
        ...s,
        mutationPending: false,
        profileForm: null,
      }));
      await loadConnectors();
    } catch (error) {
      const _still = current("connectors", op);
      end("connectors", op);
      if (!_still) return;
      setState((s) => ({
        ...s,
        mutationPending: false,
        error: toUiError(error),
      }));
    }
  }, [begin, current, end, loadConnectors]);

  const updateProfile = useCallback(async () => {
    const form = stateRef.current.profileForm;
    if (!form || form.mode !== "edit" || !form.schemaOk || !form.profileId) {
      return;
    }
    const profile = stateRef.current.profiles.find(
      (p) => p.id === form.profileId,
    );
    if (!profile) return;
    const op = begin("connectors");
    if (op === null) return;
    setState((s) => ({ ...s, mutationPending: true, error: null }));
    try {
      const existing =
        profile.configuration &&
        typeof profile.configuration === "object" &&
        !Array.isArray(profile.configuration)
          ? (profile.configuration as Record<string, unknown>)
          : {};
      await invokeEngine("externalConnector.profile.update", {
        profileId: form.profileId,
        expectedRevision: profile.revision,
        displayName: form.displayName,
        enabled: form.enabled,
        configuration: mergeConfiguration(
          existing,
          form.configFields,
          form.configValues,
        ),
      });
      const _still = current("connectors", op);
      end("connectors", op);
      if (!_still) return;
      setState((s) => ({
        ...s,
        mutationPending: false,
        profileForm: null,
      }));
      await loadConnectors();
    } catch (error) {
      const _still = current("connectors", op);
      end("connectors", op);
      if (!_still) return;
      setState((s) => ({
        ...s,
        mutationPending: false,
        error: toUiError(error),
      }));
    }
  }, [begin, current, end, loadConnectors]);

  const deleteProfile = useCallback(
    async (profileId: string, revision: number) => {
      const op = begin("connectors");
      if (op === null) return;
      try {
        await invokeEngine("externalConnector.profile.delete", {
          profileId,
          expectedRevision: revision,
        });
        const _still = current("connectors", op);
        end("connectors", op);
        if (!_still) return;
        await loadConnectors();
      } catch (error) {
        const _still = current("connectors", op);
        end("connectors", op);
        if (!_still) return;
        setState((s) => ({ ...s, error: toUiError(error) }));
      }
    },
    [begin, current, end, loadConnectors],
  );

  const setCredential = useCallback(async () => {
    const profileId = stateRef.current.selectedProfileId;
    const slot = stateRef.current.credentialSlot;
    const secret = stateRef.current.credentialSecret;
    if (!profileId || !slot || !secret) return;
    const profile = stateRef.current.profiles.find((p) => p.id === profileId);
    if (!profile) return;
    const op = begin("connectors");
    if (op === null) return;
    try {
      await invokeEngine("externalConnector.credential.set", {
        profileId,
        slotId: slot,
        secret,
        expectedRevision: profile.revision,
      });
      const _still = current("connectors", op);
      end("connectors", op);
      if (!_still) return;
      setState((s) => ({ ...s, credentialSecret: "" }));
      await loadConnectors();
    } catch (error) {
      const _still = current("connectors", op);
      end("connectors", op);
      if (!_still) return;
      setState((s) => ({ ...s, error: toUiError(error) }));
    }
  }, [begin, current, end, loadConnectors]);

  const deleteCredential = useCallback(async () => {
    const profileId = stateRef.current.selectedProfileId;
    const slot = stateRef.current.credentialSlot;
    if (!profileId || !slot) return;
    const profile = stateRef.current.profiles.find((p) => p.id === profileId);
    if (!profile) return;
    const op = begin("connectors");
    if (op === null) return;
    try {
      await invokeEngine("externalConnector.credential.delete", {
        profileId,
        slotId: slot,
        expectedRevision: profile.revision,
      });
      const _still = current("connectors", op);
      end("connectors", op);
      if (!_still) return;
      await loadConnectors();
    } catch (error) {
      const _still = current("connectors", op);
      end("connectors", op);
      if (!_still) return;
      setState((s) => ({ ...s, error: toUiError(error) }));
    }
  }, [begin, current, end, loadConnectors]);

  const invokeConnector = useCallback(async () => {
    const profileId = stateRef.current.selectedProfileId;
    if (!profileId) return;
    const profile = stateRef.current.profiles.find((p) => p.id === profileId);
    if (!profile) return;
    const form: ConnectorFormInput = {
      operation: stateRef.current.connectorOp,
      requestId: `req-${Date.now()}`,
      deadlineMs: 30_000,
      streamId: stateRef.current.connectorForm.streamId,
      limit: stateRef.current.connectorForm.limit,
      itemsJson: stateRef.current.connectorForm.itemsJson,
      eventId: stateRef.current.connectorForm.eventId,
      eventType: stateRef.current.connectorForm.eventType,
      bodyJson: stateRef.current.connectorForm.bodyJson,
    };
    const built = buildExternalConnectorRequest(
      {
        profileId: profile.id,
        contributionId: profile.contributionId,
        pluginId: profile.pluginId,
        versionId: profile.versionId,
        activationRevision: profile.activationRevision,
        configSchemaVersion: profile.configSchemaVersion,
        checkpointSchemaVersion: profile.checkpointSchemaVersion,
        configuration: mergeUnknownConfig(profile.configuration, {}),
      },
      form,
      profile.operations,
    );
    if (!built.ok) {
      setState((s) => ({
        ...s,
        error: { code: "VALIDATION", message: built.error, kind: "domain" },
      }));
      return;
    }
    const op = begin("connectors");
    if (op === null) return;
    setState((s) => ({ ...s, mutationPending: true, error: null }));
    try {
      const result = await invokeEngine("externalConnector.invoke", {
        profileId,
        request: built.request,
      });
      const _still = current("connectors", op);
      end("connectors", op);
      if (!_still) return;
      setState((s) => ({
        ...s,
        mutationPending: false,
        invokeResult: result,
      }));
    } catch (error) {
      const _still = current("connectors", op);
      end("connectors", op);
      if (!_still) return;
      setState((s) => ({
        ...s,
        mutationPending: false,
        error: toUiError(error),
      }));
    }
  }, [begin, current, end]);

  const loadCheckpoint = useCallback(
    async (streamId: string) => {
      const profileId = stateRef.current.selectedProfileId;
      if (!profileId || !streamId) return;
      const op = ++ops.current.connectors;
      try {
        const checkpoint = await invokeEngine(
          "externalConnector.checkpoint.get",
          { profileId, streamId },
        );
        if (!current("connectors", op)) return;
        setState((s) => ({ ...s, checkpoint }));
      } catch (error) {
        if (!current("connectors", op)) return;
        setState((s) => ({ ...s, error: toUiError(error) }));
      }
    },
    [current],
  );

  const refreshDependentProjections = useCallback(async () => {
    await Promise.all([
      reloadInstalled(stateRef.current.installedOffset),
      reloadBundled(),
      loadAiActions(),
      loadUiPanels(),
      loadConnectors(),
    ]);
    const pluginId = stateRef.current.selectedPluginId;
    if (pluginId) {
      await loadPermissions(pluginId);
    }
  }, [
    reloadInstalled,
    reloadBundled,
    loadAiActions,
    loadUiPanels,
    loadConnectors,
    loadPermissions,
  ]);
  refreshDependentRef.current = refreshDependentProjections;

  useEffect(() => {
    if (!gateway.active) return;
    if (gateway.section === "installed" || gateway.section === "permissions") {
      void reloadInstalled(0);
    }
    if (gateway.section === "bundled") void reloadBundled();
    if (gateway.section === "aiActions") void loadAiActions();
    if (gateway.section === "uiPanels") void loadUiPanels();
    if (gateway.section === "connectors") void loadConnectors();
  }, [
    gateway.active,
    gateway.section,
    gateway.generation,
    reloadInstalled,
    reloadBundled,
    loadAiActions,
    loadUiPanels,
    loadConnectors,
  ]);

  return {
    state,
    invalidate,
    setActor: (v) => setState((s) => ({ ...s, actor: v })),
    setReason: (v) => setState((s) => ({ ...s, reason: v })),
    reloadInstalled,
    reloadBundled,
    selectPlugin,
    pickAndInspect,
    confirmInstall,
    confirmUpgrade,
    enablePlugin,
    disablePlugin,
    uninstallPlugin,
    applyBundled,
    loadVersions,
    rollbackVersion,
    loadPermissions,
    reviewPermissions,
    grantPermission,
    denyPermission,
    revokePermission,
    loadAiActions,
    setActionConfigValue,
    invokeAiAction,
    cancelAiAction,
    loadAiActionHistory,
    loadUiPanels,
    openUiPanel,
    closeUiPanel,
    loadConnectors,
    selectProfile,
    beginCreateProfile,
    beginEditProfile,
    clearProfileForm,
    patchProfileForm,
    setProfileConfigValue,
    createProfile,
    updateProfile,
    deleteProfile,
    setCredential,
    deleteCredential,
    setConnectorOp: (op) => setState((s) => ({ ...s, connectorOp: op })),
    patchConnectorForm: (patch) =>
      setState((s) => ({
        ...s,
        connectorForm: { ...s.connectorForm, ...patch },
      })),
    setCredentialSlot: (slot) =>
      setState((s) => ({ ...s, credentialSlot: slot })),
    setCredentialSecret: (secret) =>
      setState((s) => ({ ...s, credentialSecret: secret })),
    invokeConnector,
    loadCheckpoint,
    clearInspection: () =>
      setState((s) => ({
        ...s,
        inspection: null,
        inspectionPath: null,
      })),
  };
}
