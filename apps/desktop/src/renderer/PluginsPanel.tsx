import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AiConnectorCatalogItem,
  AiProviderProfile,
  PluginBundledSummary,
  PluginCapabilityAuditEntry,
  PluginCapabilityChangeKind,
  PluginCapabilityId,
  PluginCapabilityRequestView,
  PluginCapabilityReview,
  PluginCapabilityScope,
  PluginContributionDescriptor,
  PluginInspection,
  PluginSummary,
  PluginVersionSummary,
  PipelineRunSnapshot,
} from "@translunar/contracts";
import {
  Ban,
  Eye,
  History,
  PackagePlus,
  Puzzle,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  ShieldEllipsis,
  Upload,
  X,
} from "lucide-react";

import { formatError } from "./workbench-utils";
import { useFocusTrap } from "./useFocusTrap";

import "./PluginsPanel.css";
import { useLocale } from "./i18n/LocaleProvider";
import type { MessageKey } from "./i18n/messages";
import { PluginPanelHost } from "./PluginPanelHost";
import {
  countContributionKinds,
  permissionRowsFromRequests,
  showTier3Honesty,
  tierLabelKey,
} from "./components/ai/plugin-permission-presenters";
import {
  findContributionPermission,
  formatDescriptorValue,
  listExecutableContributions,
  type ExecutablePluginContribution,
} from "./plugin-provenance-utils";

interface PluginsPanelProps {
  projectId: string;
  onRefresh(): Promise<void>;
}

type PluginInspectionState =
  | {
      sourcePath: string;
      result: PluginInspection;
      mode: "install";
    }
  | {
      sourcePath: string;
      result: PluginInspection;
      mode: "upgrade";
      pluginId: string;
      expectedRevision: number;
    };

const EFFECT_KEYS: Partial<Record<PluginCapabilityId, MessageKey>> = {
  "file.read": "plugins.effect.fileRead",
  "file.write": "plugins.effect.fileWrite",
  "network.connect": "plugins.effect.networkConnect",
  "asset.read": "plugins.effect.assetRead",
  "asset.write": "plugins.effect.assetWrite",
  "project.read": "plugins.effect.projectRead",
  "project.write": "plugins.effect.projectWrite",
  "engine.connector": "plugins.effect.engineConnector",
  "qa.register": "plugins.effect.qaRegister",
  "pipeline.register": "plugins.effect.pipelineRegister",
  "ai.action": "plugins.effect.aiAction",
  "ui.panel": "plugins.effect.uiPanel",
  "external.connector": "plugins.effect.externalConnector",
  "diagnostics.read": "plugins.effect.diagnosticsRead",
};

const CHANGE_KEYS: Record<PluginCapabilityChangeKind, MessageKey> = {
  added: "plugins.change.added",
  expanded: "plugins.change.expanded",
  narrowed: "plugins.change.narrowed",
  unchanged: "plugins.change.unchanged",
  removed: "plugins.change.removed",
};

export function PluginsPanel({ projectId, onRefresh }: PluginsPanelProps) {
  const { t, formatDate } = useLocale();
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [providerProfiles, setProviderProfiles] = useState<AiProviderProfile[]>(
    [],
  );
  const [connectorCatalog, setConnectorCatalog] = useState<
    AiConnectorCatalogItem[]
  >([]);
  const [contributionPermissions, setContributionPermissions] = useState<
    Record<string, PluginCapabilityRequestView[] | null>
  >({});
  const [pipelineRuns, setPipelineRuns] = useState<PipelineRunSnapshot[]>([]);
  const [pipelineLoading, setPipelineLoading] = useState(true);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [review, setReview] = useState<PluginCapabilityReview | null>(null);
  const [audit, setAudit] = useState<PluginCapabilityAuditEntry[]>([]);
  const [scopeDrafts, setScopeDrafts] = useState<
    Record<string, PluginCapabilityScope>
  >({});
  const [reason, setReason] = useState("");
  const [panelPreview, setPanelPreview] = useState<{
    plugin: PluginSummary;
    contribution: Extract<PluginContributionDescriptor, { kind: "uiPanel" }>;
  } | null>(null);
  const [bundled, setBundled] = useState<PluginBundledSummary[]>([]);
  const [bundledAvailable, setBundledAvailable] = useState(false);
  const [inspection, setInspection] = useState<PluginInspectionState | null>(
    null,
  );
  const [versionHistory, setVersionHistory] = useState<{
    plugin: PluginSummary;
    versions: PluginVersionSummary[];
  } | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const inspectionDialogRef = useRef<HTMLElement>(null);
  const historyDialogRef = useRef<HTMLElement>(null);

  const closeReview = useCallback(() => {
    if (busyId === null) {
      setReview(null);
      setAudit([]);
      setReason("");
    }
  }, [busyId]);
  useFocusTrap(dialogRef, { active: review !== null, onEscape: closeReview });
  useFocusTrap(inspectionDialogRef, {
    active: inspection !== null,
    onEscape: () => {
      if (busyId === null) setInspection(null);
    },
  });
  useFocusTrap(historyDialogRef, {
    active: versionHistory !== null,
    onEscape: () => {
      if (busyId === null) setVersionHistory(null);
    },
  });

  const load = useCallback(async (preserveError = false) => {
    setLoading(true);
    if (!preserveError) setError(null);
    try {
      const [page, profiles, catalog, bundledPage] = await Promise.all([
        window.translunar.invoke("plugin.list", {
          offset: 0,
          limit: 100,
        }),
        window.translunar.invoke("ai.provider.list", {
          offset: 0,
          limit: 100,
        }),
        window.translunar.invoke("ai.provider.catalog", {}),
        window.translunar
          .invoke("plugin.bundled.list", { offset: 0, limit: 100 })
          .catch(() => ({
            items: [] as PluginBundledSummary[],
            total: 0,
            offset: 0,
            limit: 100,
            catalogAvailable: false,
            diagnostics: [],
          })),
      ]);
      const executablePlugins = page.items.filter((plugin) =>
        (plugin.contributions ?? []).some(
          (contribution) =>
            contribution.kind === "engineConnector" ||
            contribution.kind === "qaRule" ||
            contribution.kind === "pipelineStep",
        ),
      );
      const permissionEntries = await Promise.all(
        executablePlugins.map(async (plugin) => {
          try {
            const nextReview = await window.translunar.invoke(
              "plugin.permission.review",
              { pluginId: plugin.id },
            );
            return [plugin.id, nextReview.requests] as const;
          } catch {
            return [plugin.id, null] as const;
          }
        }),
      );
      setPlugins(page.items);
      setProviderProfiles(profiles.items);
      setConnectorCatalog(catalog.items);
      setContributionPermissions(Object.fromEntries(permissionEntries));
      setBundled(bundledPage.items);
      setBundledAvailable(bundledPage.catalogAvailable);
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPipelineHistory = useCallback(async () => {
    setPipelineLoading(true);
    setPipelineError(null);
    try {
      const page = await window.translunar.invoke("pipeline.run.list", {
        projectId,
        offset: 0,
        limit: 10,
      });
      const snapshots = await Promise.all(
        page.items.map((run) =>
          window.translunar.invoke("pipeline.run.get", { runId: run.id }),
        ),
      );
      setPipelineRuns(snapshots);
    } catch (cause) {
      setPipelineError(formatError(cause));
    } finally {
      setPipelineLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
    void loadPipelineHistory();
  }, [load, loadPipelineHistory]);

  const openReview = async (pluginId: string, preserveReason = false) => {
    setBusyId(`review:${pluginId}`);
    setError(null);
    try {
      const [nextReview, auditPage] = await Promise.all([
        window.translunar.invoke("plugin.permission.review", { pluginId }),
        window.translunar.invoke("plugin.permission.audit.list", {
          pluginId,
          offset: 0,
          limit: 100,
        }),
      ]);
      setScopeDrafts(
        Object.fromEntries(
          nextReview.requests.map((request) => [
            request.id,
            request.grantedScope ?? request.requestedScope,
          ]),
        ),
      );
      setAudit(auditPage.items);
      setReview(nextReview);
      if (!preserveReason) setReason("");
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setBusyId(null);
    }
  };

  const beginInspect = async (
    mode: "install" | "upgrade",
    plugin?: PluginSummary,
  ) => {
    setError(null);
    try {
      const sourcePath = await window.translunar.selectPluginPackage();
      if (!sourcePath) return;
      setBusyId(
        mode === "install" ? "inspect-install" : `inspect:${plugin?.id}`,
      );
      const result = await window.translunar.invoke("plugin.inspect", {
        sourcePath,
      });
      if (
        mode === "upgrade" &&
        plugin &&
        result.normalizedManifest.id !== plugin.id
      ) {
        throw new Error(
          t("plugins.inspectIdMismatch", {
            expected: plugin.id,
            actual: result.normalizedManifest.id,
          }),
        );
      }
      if (mode === "upgrade" && plugin) {
        setInspection({
          sourcePath,
          result,
          mode,
          pluginId: plugin.id,
          expectedRevision: plugin.revision,
        });
      } else {
        setInspection({ sourcePath, result, mode: "install" });
      }
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setBusyId(null);
    }
  };

  const confirmInspection = async () => {
    if (!inspection) return;
    setBusyId("confirm-inspection");
    setError(null);
    try {
      if (inspection.mode === "install") {
        const result = await window.translunar.invoke("plugin.install", {
          sourcePath: inspection.sourcePath,
          actor: "desktop",
          reason: "install from Plugins panel",
        });
        setInspection(null);
        await load();
        await onRefresh();
        await openReview(result.plugin.id);
      } else {
        if (panelPreview?.plugin.id === inspection.pluginId) {
          setPanelPreview(null);
        }
        await window.translunar.invoke("plugin.upgrade", {
          pluginId: inspection.pluginId,
          sourcePath: inspection.sourcePath,
          expectedRevision: inspection.expectedRevision,
          actor: "desktop",
          reason: "upgrade from Plugins panel",
        });
        setInspection(null);
        await load();
        await onRefresh();
      }
    } catch (cause) {
      const message = formatError(cause);
      setError(message);
      await load(true);
      setError(message);
    } finally {
      setBusyId(null);
    }
  };

  const applyBundled = async (item: PluginBundledSummary) => {
    setBusyId(`bundled:${item.pluginId}`);
    setError(null);
    try {
      const installed = plugins.find((plugin) => plugin.id === item.pluginId);
      if (panelPreview?.plugin.id === item.pluginId) setPanelPreview(null);
      await window.translunar.invoke("plugin.bundled.apply", {
        pluginId: item.pluginId,
        ...(installed ? { expectedRevision: installed.revision } : {}),
        actor: "desktop",
        reason: "apply bundled core plugin",
      });
      await load();
      await onRefresh();
    } catch (cause) {
      const message = formatError(cause);
      setError(message);
      await load(true);
      setError(message);
    } finally {
      setBusyId(null);
    }
  };

  const openVersionHistory = async (plugin: PluginSummary) => {
    setBusyId(`history:${plugin.id}`);
    setError(null);
    try {
      const page = await window.translunar.invoke("plugin.version.list", {
        pluginId: plugin.id,
        offset: 0,
        limit: 100,
      });
      setVersionHistory({ plugin, versions: page.items });
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setBusyId(null);
    }
  };

  const rollbackVersion = async (version: PluginVersionSummary) => {
    if (!versionHistory) return;
    setBusyId(`rollback:${version.id}`);
    setError(null);
    try {
      if (panelPreview?.plugin.id === versionHistory.plugin.id) {
        setPanelPreview(null);
      }
      await window.translunar.invoke("plugin.rollback", {
        pluginId: versionHistory.plugin.id,
        versionId: version.id,
        expectedRevision: versionHistory.plugin.revision,
        actor: "desktop",
        reason: "rollback from Plugins panel",
      });
      setVersionHistory(null);
      await load();
      await onRefresh();
    } catch (cause) {
      const message = formatError(cause);
      setVersionHistory(null);
      setError(message);
      await load(true);
      setError(message);
    } finally {
      setBusyId(null);
    }
  };

  const mutate = async (
    plugin: PluginSummary,
    method: "plugin.enable" | "plugin.disable" | "plugin.uninstall",
  ) => {
    setBusyId(plugin.id);
    setError(null);
    try {
      if (method !== "plugin.enable" && panelPreview?.plugin.id === plugin.id) {
        setPanelPreview(null);
      }
      await window.translunar.invoke(method, {
        pluginId: plugin.id,
        expectedRevision: plugin.revision,
        actor: "desktop",
        reason: `${method} from Plugins panel`,
      });
      await load();
      await onRefresh();
    } catch (cause) {
      const message = formatError(cause);
      setError(message);
      await load(true);
      setError(message);
    } finally {
      setBusyId(null);
    }
  };

  const decide = async (
    request: PluginCapabilityRequestView,
    action: "grant" | "deny" | "revoke",
  ) => {
    if (!review || reason.trim().length === 0) return;
    setBusyId(request.id);
    setError(null);
    try {
      const base = {
        pluginId: review.plugin.id,
        requestId: request.id,
        expectedRevision: request.revision,
        actor: "desktop",
        reason: reason.trim(),
      };
      if (action === "grant") {
        await window.translunar.invoke("plugin.permission.grant", {
          ...base,
          scope: scopeDrafts[request.id] ?? request.requestedScope,
        });
      } else {
        await window.translunar.invoke(`plugin.permission.${action}`, base);
      }
      await openReview(review.plugin.id, true);
      await load();
      await onRefresh();
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section
      className="plugins-panel plugins-ortho"
      aria-labelledby="plugins-heading"
    >
      <header className="plugins-panel__header">
        <div>
          <h2 id="plugins-heading">
            <Puzzle size={16} aria-hidden />
            {t("plugins.title")}
          </h2>
          <p className="plugins-panel__lede">{t("plugins.lede")}</p>
        </div>
        <div className="plugins-panel__actions">
          <button
            type="button"
            onClick={() => {
              void load();
              void loadPipelineHistory();
            }}
            disabled={loading || pipelineLoading}
          >
            <RefreshCw size={14} aria-hidden />
            {t("common.refresh")}
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void beginInspect("install")}
            disabled={busyId !== null}
          >
            <PackagePlus size={14} aria-hidden />
            {t("plugins.installPackage")}
          </button>
        </div>
      </header>

      {error ? (
        <p className="plugins-panel__error" role="alert">
          {error}
        </p>
      ) : null}

      <section
        className="plugins-panel__band"
        aria-labelledby="plugins-bundled-heading"
      >
        <header className="plugins-panel__band-header">
          <h3 id="plugins-bundled-heading">{t("plugins.bundledTitle")}</h3>
          <p className="plugins-panel__lede">
            {bundledAvailable
              ? t("plugins.bundledLede")
              : t("plugins.bundledUnavailable")}
          </p>
        </header>
        {bundledAvailable && bundled.length > 0 ? (
          <ul className="plugins-panel__list plugins-panel__list--bundled">
            {bundled.map((item) => (
              <li key={item.pluginId} className="plugins-panel__row">
                <div className="plugins-panel__row-main">
                  <strong>{item.displayName}</strong>
                  <span className="plugins-panel__meta">
                    {item.pluginId} · v{item.version} · {item.tier} ·{" "}
                    {item.publisher} · {item.license} ·{" "}
                    {t(`plugins.bundledState.${item.installState}`)}
                  </span>
                </div>
                <div className="plugins-panel__row-actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={
                      busyId !== null ||
                      item.installState === "current" ||
                      item.installState === "installed"
                    }
                    onClick={() => void applyBundled(item)}
                  >
                    {item.installState === "available"
                      ? t("plugins.bundledInstall")
                      : item.installState === "updateAvailable"
                        ? t("plugins.bundledUpdate")
                        : item.installState === "current"
                          ? t("plugins.bundledCurrent")
                          : t("plugins.bundledState.installed")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="plugins-panel__empty">{t("plugins.bundledEmpty")}</p>
        )}
      </section>

      <h3 className="plugins-panel__band-header" id="plugins-installed-heading">
        {t("plugins.installedTitle")}
      </h3>

      {loading ? (
        <p className="plugins-panel__empty">{t("plugins.loading")}</p>
      ) : plugins.length === 0 ? (
        <p className="plugins-panel__empty">{t("plugins.empty")}</p>
      ) : (
        <ul className="plugins-panel__list">
          {plugins.map((plugin) => {
            const panel = (plugin.contributions ?? []).find(
              (
                contribution,
              ): contribution is Extract<
                PluginContributionDescriptor,
                { kind: "uiPanel" }
              > => contribution.kind === "uiPanel",
            );
            const connectors = (plugin.contributions ?? []).filter(
              (
                contribution,
              ): contribution is Extract<
                PluginContributionDescriptor,
                { kind: "engineConnector" }
              > => contribution.kind === "engineConnector",
            );
            const executableContributions = listExecutableContributions(
              plugin.contributions,
            );
            const kindCounts = countContributionKinds(plugin.contributions);
            const permRows = permissionRowsFromRequests(
              contributionPermissions[plugin.id],
            );
            const permUnknown =
              contributionPermissions[plugin.id] === null ||
              contributionPermissions[plugin.id] === undefined;
            return (
              <li key={plugin.id} className="plugins-panel__item">
                <div className="plugins-panel__identity">
                  <strong>{plugin.displayName}</strong>
                  <div className="plugins-panel__meta">
                    <span>{plugin.id}</span>
                    <span>v{plugin.version}</span>
                    <span className="plugin-tier">{t(tierLabelKey(plugin.tier))}</span>
                    <span data-status={plugin.status}>{plugin.status}</span>
                    <span className="plugins-panel__badge">
                      {t(
                        `plugins.source.${plugin.sourceKind ?? "localDirectory"}`,
                      )}
                    </span>
                    {plugin.distribution ? (
                      <span>
                        {plugin.distribution.publisher} ·{" "}
                        {plugin.distribution.license}
                      </span>
                    ) : null}
                    {plugin.packageSha256 ? (
                      <span title={plugin.packageSha256}>
                        sha256:{plugin.packageSha256.slice(0, 12)}
                      </span>
                    ) : null}
                    <span>
                      {t("plugins.crashCount", { count: plugin.crashCount })}
                    </span>
                  </div>
                  {kindCounts.total > 0 ? (
                    <div
                      className="plugins-contrib-counts"
                      aria-label={t("plugins.contribCountsAria")}
                    >
                      {kindCounts.filter > 0 ? (
                        <span>
                          {t("plugins.contrib.filter", {
                            count: kindCounts.filter,
                          })}
                        </span>
                      ) : null}
                      {kindCounts.qaRule > 0 ? (
                        <span>
                          {t("plugins.contrib.qa", { count: kindCounts.qaRule })}
                        </span>
                      ) : null}
                      {kindCounts.uiPanel > 0 ? (
                        <span>
                          {t("plugins.contrib.panel", {
                            count: kindCounts.uiPanel,
                          })}
                        </span>
                      ) : null}
                      {kindCounts.aiAction > 0 ? (
                        <span>
                          {t("plugins.contrib.ai", {
                            count: kindCounts.aiAction,
                          })}
                        </span>
                      ) : null}
                      {kindCounts.pipelineStep > 0 ? (
                        <span>
                          {t("plugins.contrib.pipeline", {
                            count: kindCounts.pipelineStep,
                          })}
                        </span>
                      ) : null}
                      {kindCounts.engineConnector > 0 ? (
                        <span>
                          {t("plugins.contrib.connector", {
                            count: kindCounts.engineConnector,
                          })}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {showTier3Honesty(plugin) ? (
                    <p className="plugin-honesty" role="note">
                      <span className="plugin-honesty__lamp" aria-hidden="true" />
                      {t("plugins.honesty.tier3")}
                    </p>
                  ) : null}
                  {permUnknown ? (
                    <div className="plugins-panel__meta">
                      {t("plugins.permissionUnknown")}
                    </div>
                  ) : permRows.length ? (
                    <div
                      className="plugin-perm-table"
                      role="table"
                      aria-label={t("plugins.permTableAria")}
                    >
                      <div className="plugin-perm-table__head" role="row">
                        <span role="columnheader">
                          {t("plugins.perm.capability")}
                        </span>
                        <span role="columnheader">
                          {t("plugins.perm.scope")}
                        </span>
                        <span role="columnheader">
                          {t("plugins.perm.state")}
                        </span>
                        <span role="columnheader">
                          {t("plugins.perm.action")}
                        </span>
                      </div>
                      {permRows.map((row) => (
                        <div
                          key={row.requestId}
                          className="plugin-perm-table__row"
                          role="row"
                        >
                          <span role="cell">
                            <code>{row.capabilityId}</code>
                            {row.unenforceable ||
                            (showTier3Honesty(plugin) &&
                              row.decision === "unknown") ? (
                              <span className="plugin-honesty">
                                <span
                                  className="plugin-honesty__lamp"
                                  aria-hidden="true"
                                />
                                {t("plugins.honesty.osUnenforceable")}
                              </span>
                            ) : null}
                          </span>
                          <span role="cell">{row.scopeKind}</span>
                          <span role="cell">
                            <span
                              className="plugin-perm-chip"
                              data-decision={row.decision}
                            >
                              {t(`plugins.perm.decision.${row.decision}`)}
                            </span>
                          </span>
                          <div role="cell">
                            <button
                              type="button"
                              onClick={() => void openReview(plugin.id)}
                            >
                              {t("plugins.perm.review")}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="plugins-panel__meta">
                      {t("plugins.permissions", {
                        list: t("plugins.permissionsNone"),
                      })}
                    </div>
                  )}
                  {plugin.lastError ? (
                    <p className="plugins-panel__error">{plugin.lastError}</p>
                  ) : null}
                  {plugin.compatibility || plugin.diagnostics?.length ? (
                    <PluginDiagnostics plugin={plugin} />
                  ) : null}
                  {executableContributions.length ? (
                    <ContributionInventory
                      plugin={plugin}
                      contributions={executableContributions}
                      requests={contributionPermissions[plugin.id]}
                    />
                  ) : null}
                  {connectors.length ? (
                    <div className="plugins-connector-list">
                      {connectors.map((connector) => {
                        const catalogItem = connectorCatalog.find(
                          (item) =>
                            item.source.kind === "plugin" &&
                            item.source.owner.pluginId === plugin.id &&
                            item.source.owner.versionId ===
                              plugin.activeVersionId &&
                            item.source.contributionId === connector.id,
                        );
                        const references = providerProfiles.filter(
                          (profile) =>
                            profile.source.kind === "plugin" &&
                            profile.source.owner.pluginId === plugin.id &&
                            profile.source.owner.versionId ===
                              plugin.activeVersionId &&
                            profile.source.contributionId === connector.id &&
                            (catalogItem?.source.kind !== "plugin" ||
                              profile.source.contractVersion ===
                                catalogItem.source.contractVersion),
                        );
                        const permissionRequests =
                          contributionPermissions[plugin.id];
                        const authority = permissionRequests?.find(
                          (request) =>
                            request.capabilityId === "engine.connector" &&
                            request.contributionId === connector.id,
                        );
                        const networkRequests = permissionRequests?.filter(
                          (request) =>
                            request.capabilityId === "network.connect" &&
                            request.contributionId === connector.id,
                        );
                        const origins = (networkRequests ?? []).flatMap(
                          (request) =>
                            request.decision === "granted" &&
                            request.grantedScope?.kind === "network"
                              ? request.grantedScope.origins
                              : [],
                        );
                        const grantedOperations =
                          authority?.decision === "granted" &&
                          authority.grantedScope?.kind === "operations"
                            ? authority.grantedScope.operations
                            : [];
                        const authorityState = [
                          authority?.decision ??
                            t("plugins.connectorNotRequested"),
                          ...grantedOperations,
                        ].join(" · ");
                        const originState = [
                          ...(networkRequests ?? []).map(
                            (request) => request.decision,
                          ),
                          origins.join(", ") ||
                            t("plugins.connectorOriginNone"),
                        ].join(" · ");
                        const exactVersion = `${
                          catalogItem?.source.kind === "plugin"
                            ? catalogItem.source.owner.versionId
                            : (plugin.activeVersionId ?? plugin.version)
                        }:${connector.version}/v${
                          catalogItem?.source.kind === "plugin"
                            ? catalogItem.source.contractVersion
                            : 1
                        }`;
                        return (
                          <article key={connector.id}>
                            <header>
                              <strong>{connector.displayName}</strong>
                              <span
                                className="plugins-connector-availability"
                                data-availability={
                                  catalogItem?.availability ?? "unavailable"
                                }
                              >
                                {catalogItem?.availability === "available"
                                  ? t("ai.connectorAvailable")
                                  : catalogItem?.availability === "degraded"
                                    ? t("ai.connectorDegraded")
                                    : t("ai.connectorUnavailable")}
                              </span>
                            </header>
                            <code title={connector.id}>{connector.id}</code>
                            <dl>
                              <div>
                                <dt>{t("plugins.connectorVersion")}</dt>
                                <dd title={exactVersion}>{exactVersion}</dd>
                              </div>
                              <div>
                                <dt>{t("plugins.connectorOperations")}</dt>
                                <dd>{connector.operations.join(" · ")}</dd>
                              </div>
                            </dl>
                            <div className="plugins-connector-status">
                              <span>
                                {t("plugins.connectorProfiles", {
                                  count: references.length,
                                })}
                              </span>
                              {permissionRequests === null ||
                              permissionRequests === undefined ? (
                                <span>
                                  {t("plugins.connectorPermissionUnknown")}
                                </span>
                              ) : (
                                <>
                                  <span
                                    data-decision={
                                      authority?.decision ?? "not-requested"
                                    }
                                  >
                                    {t("plugins.connectorAuthority", {
                                      state: authorityState,
                                    })}
                                  </span>
                                  <span title={originState}>
                                    {t("plugins.connectorOrigins", {
                                      list: originState,
                                    })}
                                  </span>
                                </>
                              )}
                            </div>
                            {catalogItem?.safeFailure ? (
                              <p
                                className="plugins-connector-failure"
                                role="status"
                              >
                                {t("plugins.connectorFailure", {
                                  message: catalogItem.safeFailure,
                                })}
                              </p>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
                <div className="plugins-panel__item-actions">
                  {plugin.status === "enabled" &&
                  plugin.tier === "sandbox" &&
                  panel ? (
                    <button
                      type="button"
                      disabled={busyId !== null}
                      onClick={() =>
                        setPanelPreview({ plugin, contribution: panel })
                      }
                    >
                      <Eye size={14} aria-hidden />
                      {t("plugins.previewPanel")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => void openReview(plugin.id)}
                  >
                    <ShieldEllipsis size={14} aria-hidden />
                    {t("plugins.review")}
                  </button>
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => void beginInspect("upgrade", plugin)}
                  >
                    <Upload size={14} aria-hidden />
                    {t("plugins.upgrade")}
                  </button>
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => void openVersionHistory(plugin)}
                  >
                    <History size={14} aria-hidden />
                    {t("plugins.versionHistory")}
                  </button>
                  {plugin.status === "enabled" ? (
                    <button
                      type="button"
                      disabled={busyId !== null}
                      onClick={() => void mutate(plugin, "plugin.disable")}
                    >
                      {t("plugins.disable")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busyId !== null}
                      onClick={() => void mutate(plugin, "plugin.enable")}
                    >
                      {t("common.enable")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="danger"
                    disabled={busyId !== null}
                    onClick={() => void mutate(plugin, "plugin.uninstall")}
                  >
                    {t("plugins.uninstall")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {inspection ? (
        <div className="plugins-panel__dialog-backdrop" role="presentation">
          <section
            ref={inspectionDialogRef}
            className="plugins-panel__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="plugins-inspect-heading"
          >
            <header className="plugins-panel__dialog-header">
              <h3 id="plugins-inspect-heading">{t("plugins.inspectTitle")}</h3>
              <button
                type="button"
                disabled={busyId !== null}
                onClick={() => setInspection(null)}
              >
                <X size={14} aria-hidden />
                {t("common.close")}
              </button>
            </header>
            <div className="plugins-panel__dialog-body">
              <dl className="plugins-panel__inspect">
                <div>
                  <dt>{t("plugins.inspectId")}</dt>
                  <dd>{inspection.result.normalizedManifest.id}</dd>
                </div>
                <div>
                  <dt>{t("plugins.inspectVersion")}</dt>
                  <dd>{inspection.result.normalizedManifest.version}</dd>
                </div>
                <div>
                  <dt>{t("plugins.inspectTier")}</dt>
                  <dd>{inspection.result.normalizedManifest.runtime.tier}</dd>
                </div>
                <div>
                  <dt>{t("plugins.inspectSource")}</dt>
                  <dd>{t(`plugins.source.${inspection.result.sourceKind}`)}</dd>
                </div>
                <div>
                  <dt>{t("plugins.inspectHash")}</dt>
                  <dd title={inspection.result.packageSha256}>
                    {inspection.result.packageSha256.slice(0, 16)}…
                  </dd>
                </div>
                <div>
                  <dt>{t("plugins.inspectLicense")}</dt>
                  <dd>
                    {inspection.result.distribution
                      ? `${inspection.result.distribution.publisher} · ${inspection.result.distribution.license}`
                      : t("plugins.inspectLicenseNone")}
                  </dd>
                </div>
                <div>
                  <dt>{t("plugins.inspectCompatibility")}</dt>
                  <dd>
                    {inspection.result.compatibility.compatible
                      ? t("plugins.compatibilityReady")
                      : t("plugins.compatibilityBlocked")}
                  </dd>
                </div>
                <div>
                  <dt>{t("plugins.inspectContributions")}</dt>
                  <dd>
                    {inspection.result.normalizedManifest.contributions.length}
                  </dd>
                </div>
              </dl>
              <div className="plugins-panel__dialog-actions">
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => setInspection(null)}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={
                    busyId !== null ||
                    (inspection.mode === "install" &&
                      !inspection.result.canInstall) ||
                    !inspection.result.compatibility.compatible
                  }
                  onClick={() => void confirmInspection()}
                >
                  {inspection.mode === "install"
                    ? t("plugins.inspectConfirmInstall")
                    : t("plugins.inspectConfirmUpgrade")}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {versionHistory ? (
        <div className="plugins-panel__dialog-backdrop" role="presentation">
          <section
            ref={historyDialogRef}
            className="plugins-panel__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="plugins-history-heading"
          >
            <header className="plugins-panel__dialog-header">
              <h3 id="plugins-history-heading">
                {t("plugins.versionHistoryTitle", {
                  name: versionHistory.plugin.displayName,
                })}
              </h3>
              <button
                type="button"
                disabled={busyId !== null}
                onClick={() => setVersionHistory(null)}
              >
                <X size={14} aria-hidden />
                {t("common.close")}
              </button>
            </header>
            <div className="plugins-panel__dialog-body">
              <ul className="plugins-panel__list">
                {versionHistory.versions.map((version) => {
                  const isActive =
                    versionHistory.plugin.activeVersionId === version.id;
                  return (
                    <li key={version.id} className="plugins-panel__row">
                      <div className="plugins-panel__row-main">
                        <strong>v{version.version}</strong>
                        <span className="plugins-panel__meta">
                          {version.state}
                          {isActive ? ` · ${t("plugins.versionActive")}` : ""}
                          {version.packageSha256
                            ? ` · sha256:${version.packageSha256.slice(0, 12)}`
                            : ""}
                          {` · ${t(`plugins.source.${version.sourceKind ?? "localDirectory"}`)}`}
                        </span>
                      </div>
                      <div className="plugins-panel__row-actions">
                        <button
                          type="button"
                          disabled={
                            busyId !== null ||
                            isActive ||
                            version.state !== "validated"
                          }
                          onClick={() => void rollbackVersion(version)}
                        >
                          <RotateCcw size={14} aria-hidden />
                          {t("plugins.rollback")}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        </div>
      ) : null}

      <PipelineHistory
        snapshots={pipelineRuns}
        loading={pipelineLoading}
        error={pipelineError}
      />

      {panelPreview ? (
        <div className="surface-dialog-backdrop" role="presentation">
          <section
            className="surface-dialog plugins-panel-preview"
            role="dialog"
            aria-modal="true"
            aria-label={panelPreview.contribution.displayName}
          >
            <PluginPanelHost
              pluginId={panelPreview.plugin.id}
              pluginName={panelPreview.plugin.displayName}
              contributionId={panelPreview.contribution.id}
              contributionName={panelPreview.contribution.displayName}
              revision={panelPreview.plugin.revision}
              versionId={panelPreview.plugin.activeVersionId ?? ""}
              allowedMethods={previewBridgeMethods(
                panelPreview.contribution.methods,
              )}
              projectId={projectId}
              onClose={() => setPanelPreview(null)}
            />
          </section>
        </div>
      ) : null}

      {review ? (
        <div className="surface-dialog-backdrop" role="presentation">
          <section
            ref={dialogRef}
            className="surface-dialog plugins-permission-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="plugin-permission-dialog-title"
          >
            <header className="plugins-permission-dialog__header">
              <div>
                <span className="surface-kicker">
                  {t("plugins.permissionKicker")}
                </span>
                <h2 id="plugin-permission-dialog-title">
                  {t("plugins.reviewTitle")}
                </h2>
                <p>
                  {review.plugin.displayName} · v{review.plugin.version} ·{" "}
                  {review.plugin.tier}
                </p>
              </div>
              <button
                type="button"
                className="icon-button"
                title={t("aria.closeDialog")}
                aria-label={t("aria.closeDialog")}
                onClick={closeReview}
                disabled={busyId !== null}
              >
                <X size={15} aria-hidden />
              </button>
            </header>

            <section
              className="plugins-permission-dialog__changes"
              aria-labelledby="plugin-version-changes"
            >
              <h3 id="plugin-version-changes">{t("plugins.versionChanges")}</h3>
              {review.changes.length === 0 ? (
                <p>{t("plugins.change.none")}</p>
              ) : (
                <ul>
                  {review.changes.map((change, index) => (
                    <li
                      key={`${change.capabilityId}:${change.contributionId ?? ""}:${index}`}
                    >
                      <strong>{change.capabilityId}</strong>
                      <span>{t(CHANGE_KEYS[change.kind])}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <label className="plugins-permission-dialog__reason">
              <span>{t("common.reason")}</span>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.currentTarget.value)}
                placeholder={t("plugins.reasonPlaceholder")}
                maxLength={4096}
                rows={2}
                disabled={busyId !== null}
              />
            </label>

            <div className="plugins-permission-dialog__requests">
              {review.requests.map((request) => {
                const change = review.changes.find(
                  (item) =>
                    item.capabilityId === request.capabilityId &&
                    item.contributionId === request.contributionId,
                );
                const scope = scopeDrafts[request.id] ?? request.requestedScope;
                const canGrant =
                  request.supported &&
                  scopeHasAuthority(scope) &&
                  reason.trim().length > 0;
                return (
                  <article
                    key={request.id}
                    className="plugins-permission-request"
                  >
                    <header>
                      <div>
                        <h3>{request.capabilityId}</h3>
                        <p>
                          {t(
                            EFFECT_KEYS[request.capabilityId] ??
                              "plugins.effect.unsupported",
                          )}
                        </p>
                      </div>
                      <div className="plugins-permission-request__badges">
                        <span data-risk={request.risk}>{request.risk}</span>
                        <span data-decision={request.decision}>
                          {request.decision}
                        </span>
                        <span>
                          {request.required
                            ? t("plugins.required")
                            : t("plugins.optional")}
                        </span>
                        {!request.supported ? (
                          <span>{t("plugins.unsupported")}</span>
                        ) : null}
                      </div>
                    </header>
                    <dl>
                      <div>
                        <dt>{t("plugins.contribution")}</dt>
                        <dd>
                          {request.contributionId ??
                            t("plugins.allContributions")}
                        </dd>
                      </div>
                      <div>
                        <dt>{t("plugins.versionChange")}</dt>
                        <dd>
                          {change
                            ? t(CHANGE_KEYS[change.kind])
                            : t("plugins.change.none")}
                        </dd>
                      </div>
                    </dl>
                    <ScopeEditor
                      scope={scope}
                      requestedScope={request.requestedScope}
                      disabled={busyId !== null}
                      label={t("plugins.scope")}
                      emptyLabel={t("plugins.scopeUnscoped")}
                      onChange={(next) =>
                        setScopeDrafts((current) => ({
                          ...current,
                          [request.id]: next,
                        }))
                      }
                    />
                    <div className="plugins-permission-request__actions">
                      <button
                        type="button"
                        className="primary"
                        disabled={busyId !== null || !canGrant}
                        onClick={() => void decide(request, "grant")}
                      >
                        <ShieldCheck size={14} aria-hidden />
                        {t("plugins.grant")}
                      </button>
                      <button
                        type="button"
                        disabled={busyId !== null || reason.trim().length === 0}
                        onClick={() => void decide(request, "deny")}
                      >
                        <Ban size={14} aria-hidden />
                        {t("plugins.deny")}
                      </button>
                      <button
                        type="button"
                        disabled={
                          busyId !== null ||
                          request.decision !== "granted" ||
                          reason.trim().length === 0
                        }
                        onClick={() => void decide(request, "revoke")}
                      >
                        <RotateCcw size={14} aria-hidden />
                        {t("plugins.revoke")}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>

            <section
              className="plugins-permission-audit"
              aria-labelledby="plugin-permission-audit-title"
            >
              <h3 id="plugin-permission-audit-title">{t("plugins.audit")}</h3>
              {audit.length === 0 ? (
                <p>{t("plugins.auditEmpty")}</p>
              ) : (
                <ol>
                  {audit.map((entry) => (
                    <li key={entry.id}>
                      <span>#{entry.sequence}</span>
                      <strong>{entry.event}</strong>
                      <span>{entry.capabilityId}</span>
                      <span>{entry.actor || "engine"}</span>
                      <time
                        dateTime={new Date(entry.createdAtMs).toISOString()}
                      >
                        {formatDate(entry.createdAtMs)}
                      </time>
                      {entry.reason ? <p>{entry.reason}</p> : null}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function PluginDiagnostics({ plugin }: { plugin: PluginSummary }) {
  const { t } = useLocale();
  return (
    <div className="plugins-runtime-diagnostics">
      {plugin.compatibility ? (
        <span data-compatible={plugin.compatibility.compatible}>
          {t("plugins.compatibility", {
            state: plugin.compatibility.compatible
              ? t("plugins.compatibilityReady")
              : t("plugins.compatibilityBlocked"),
          })}
        </span>
      ) : null}
      {(plugin.diagnostics ?? []).map((diagnostic, index) => (
        <span
          key={`${diagnostic.code}:${diagnostic.phase ?? ""}:${index}`}
          data-severity={diagnostic.severity ?? "info"}
          title={diagnostic.message}
        >
          {diagnostic.code}
          {diagnostic.phase ? ` · ${diagnostic.phase}` : ""}
        </span>
      ))}
    </div>
  );
}

function ContributionInventory({
  plugin,
  contributions,
  requests,
}: {
  plugin: PluginSummary;
  contributions: readonly ExecutablePluginContribution[];
  requests: readonly PluginCapabilityRequestView[] | null | undefined;
}) {
  const { t } = useLocale();
  return (
    <section
      className="plugins-contribution-inventory"
      aria-label={t("plugins.inventoryAria")}
    >
      <header>
        <strong>{t("plugins.inventoryTitle")}</strong>
        <span>
          {t("plugins.contributionCount", { count: contributions.length })}
        </span>
      </header>
      <div className="plugins-contribution-list">
        {contributions.map((contribution) => {
          const permission = findContributionPermission(requests, contribution);
          const decision =
            permission === undefined
              ? "unknown"
              : permission === null
                ? "not-requested"
                : permission.decision;
          const capabilityId =
            contribution.kind === "qaRule"
              ? "qa.register"
              : "pipeline.register";
          const grantedScope = permission?.grantedScope;
          const scopeLabel =
            grantedScope?.kind === "contributions"
              ? grantedScope.contributionIds.join(", ")
              : (grantedScope?.kind ?? t("plugins.scopeUnscoped"));
          return (
            <article
              key={`${contribution.kind}:${contribution.id}`}
              data-contribution-kind={contribution.kind}
            >
              <header>
                <div>
                  <strong>{contribution.displayName}</strong>
                  <code title={contribution.id}>{contribution.id}</code>
                </div>
                <span data-decision={decision}>
                  {permission === undefined
                    ? t("plugins.permissionUnknown")
                    : permission === null
                      ? t("plugins.connectorNotRequested")
                      : permission.decision}
                </span>
              </header>
              <dl>
                <div>
                  <dt>{t("plugins.contributionKind")}</dt>
                  <dd>
                    {contribution.kind === "qaRule"
                      ? t("plugins.qaRule")
                      : t("plugins.pipelineStep")}
                  </dd>
                </div>
                <div>
                  <dt>{t("plugins.pluginVersion")}</dt>
                  <dd title={plugin.activeVersionId ?? plugin.version}>
                    {plugin.version} · {plugin.tier} · {plugin.status}
                    {plugin.activeVersionId ? (
                      <code>{plugin.activeVersionId}</code>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt>{t("plugins.operationAuthority")}</dt>
                  <dd>
                    {capabilityId} · {decision} · {scopeLabel}
                  </dd>
                </div>
                <div>
                  <dt>{t("plugins.contributionVersion")}</dt>
                  <dd>{contribution.version}</dd>
                </div>
                <div>
                  <dt>{t("plugins.descriptorVersions")}</dt>
                  <dd>
                    {t("plugins.descriptorVersionShort", {
                      version: contribution.descriptorVersion,
                    })}
                    {contribution.operationProtocolVersion != null
                      ? ` · ${t("plugins.operationVersionShort", {
                          version: contribution.operationProtocolVersion,
                        })}`
                      : ""}
                  </dd>
                </div>
                {contribution.kind === "qaRule" ? (
                  <>
                    <div>
                      <dt>{t("plugins.ruleContract")}</dt>
                      <dd>
                        {contribution.ruleKind ?? contribution.ruleType} ·{" "}
                        {contribution.severity}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("plugins.configSchemaVersion")}</dt>
                      <dd>
                        {contribution.configSchemaVersion ?? t("common.none")}
                      </dd>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <dt>{t("plugins.artifactContract")}</dt>
                      <dd>
                        {formatDescriptorValue(contribution.input)} →{" "}
                        {formatDescriptorValue(contribution.output)}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("plugins.schemaVersions")}</dt>
                      <dd>
                        {t("plugins.configVersionShort", {
                          version: contribution.configSchemaVersion,
                        })}
                        {contribution.checkpointSchemaVersion != null
                          ? ` · ${t("plugins.checkpointVersionShort", {
                              version: contribution.checkpointSchemaVersion,
                            })}`
                          : ""}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("plugins.executionControls")}</dt>
                      <dd>
                        {t("plugins.resumable", {
                          state: contribution.resumable
                            ? t("plugins.yes")
                            : t("plugins.no"),
                        })}
                        {" · "}
                        {t("plugins.cancellable", {
                          state: contribution.cancellable
                            ? t("plugins.yes")
                            : t("plugins.no"),
                        })}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function PipelineHistory({
  snapshots,
  loading,
  error,
}: {
  snapshots: readonly PipelineRunSnapshot[];
  loading: boolean;
  error: string | null;
}) {
  const { t, formatDate } = useLocale();
  return (
    <section
      className="plugins-pipeline-history"
      aria-label={t("plugins.pipelineHistoryAria")}
    >
      <header>
        <div>
          <span className="surface-kicker">
            {t("plugins.pipelineHistoryKicker")}
          </span>
          <h3>{t("plugins.pipelineHistoryTitle")}</h3>
        </div>
        <span>
          {t("plugins.pipelineRunCount", { count: snapshots.length })}
        </span>
      </header>
      {error ? (
        <p className="plugins-panel__error" role="alert">
          {error}
        </p>
      ) : loading ? (
        <p className="plugins-panel__empty">
          {t("plugins.pipelineHistoryLoading")}
        </p>
      ) : snapshots.length === 0 ? (
        <p className="plugins-panel__empty">
          {t("plugins.pipelineHistoryEmpty")}
        </p>
      ) : (
        <div className="plugins-pipeline-runs">
          {snapshots.map((snapshot) => {
            const pluginSteps = snapshot.steps.filter(
              (step) => step.pluginBinding?.owner.kind === "plugin",
            );
            return (
              <article key={snapshot.run.id}>
                <header>
                  <div>
                    <strong>{snapshot.run.definitionId}</strong>
                    <code title={snapshot.run.id}>{snapshot.run.id}</code>
                  </div>
                  <span data-status={snapshot.run.status}>
                    {snapshot.run.status}
                  </span>
                  <time
                    dateTime={new Date(snapshot.run.createdAtMs).toISOString()}
                  >
                    {formatDate(snapshot.run.createdAtMs)}
                  </time>
                </header>
                {pluginSteps.length === 0 ? (
                  <p>{t("plugins.pipelineNoPluginSteps")}</p>
                ) : (
                  <div className="plugins-pipeline-steps">
                    {pluginSteps.map((step) => {
                      const owner = step.pluginBinding?.owner;
                      if (!owner || owner.kind !== "plugin") return null;
                      const failure =
                        step.latestPluginAttempt?.failure ?? step.error;
                      return (
                        <div key={step.id}>
                          <strong>{step.stepId}</strong>
                          <span>{owner.pluginId}</span>
                          <span>
                            {owner.contributionId} · {owner.contributionVersion}{" "}
                            · {owner.tier}
                          </span>
                          <span>
                            {t("plugins.activationRevision", {
                              revision: owner.activationRevision,
                            })}
                            {" · "}
                            {t("plugins.descriptorVersionShort", {
                              version: owner.descriptorVersion,
                            })}
                            {" · "}
                            {t("plugins.operationVersionShort", {
                              version: owner.operationProtocolVersion,
                            })}
                          </span>
                          <span data-status={step.status}>{step.status}</span>
                          {failure ? (
                            <p className="plugins-panel__error">
                              {failure.code}: {failure.message}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ScopeEditor({
  scope,
  requestedScope,
  disabled,
  label,
  emptyLabel,
  onChange,
}: {
  scope: PluginCapabilityScope;
  requestedScope: PluginCapabilityScope;
  disabled: boolean;
  label: string;
  emptyLabel: string;
  onChange(scope: PluginCapabilityScope): void;
}) {
  if (scope.kind === "unscoped") {
    return (
      <div className="plugins-scope-editor">
        <span>{label}</span>
        <p>{emptyLabel}</p>
      </div>
    );
  }
  const groups = scopeGroups(requestedScope);
  return (
    <fieldset className="plugins-scope-editor" disabled={disabled}>
      <legend>{label}</legend>
      {groups.map((group) => (
        <div key={group.key} className="plugins-scope-editor__group">
          {groups.length > 1 ? <span>{group.key}</span> : null}
          {group.values.map((value) => (
            <label key={value}>
              <input
                type="checkbox"
                checked={scopeValueSelected(scope, group.key, value)}
                onChange={() =>
                  onChange(
                    toggleScopeValue(scope, requestedScope, group.key, value),
                  )
                }
              />
              <span>{value}</span>
            </label>
          ))}
        </div>
      ))}
    </fieldset>
  );
}

function scopeGroups(
  scope: PluginCapabilityScope,
): Array<{ key: string; values: string[] }> {
  switch (scope.kind) {
    case "unscoped":
      return [];
    case "file":
      return [{ key: "areas", values: scope.areas }];
    case "network":
      return [{ key: "origins", values: scope.origins }];
    case "projects":
      return [{ key: "projects", values: scope.projectIds }];
    case "assets":
      return [
        { key: "projects", values: scope.projectIds },
        { key: "assets", values: scope.assetIds },
      ].filter((group) => group.values.length > 0);
    case "operations":
      return [{ key: "operations", values: scope.operations }];
    case "contributions":
      return [{ key: "contributions", values: scope.contributionIds }];
    case "diagnostics":
      return [{ key: "categories", values: scope.categories }];
  }
}

function removeScopeValue(
  scope: PluginCapabilityScope,
  group: string,
  value: string,
): PluginCapabilityScope {
  const without = <Value extends string>(values: Value[]): Value[] =>
    values.filter((item) => item !== value);
  switch (scope.kind) {
    case "unscoped":
      return scope;
    case "file":
      return { ...scope, areas: without(scope.areas) };
    case "network":
      return { ...scope, origins: without(scope.origins) };
    case "projects":
      return { ...scope, projectIds: without(scope.projectIds) };
    case "assets":
      return group === "projects"
        ? { ...scope, projectIds: without(scope.projectIds) }
        : { ...scope, assetIds: without(scope.assetIds) };
    case "operations":
      return { ...scope, operations: without(scope.operations) };
    case "contributions":
      return { ...scope, contributionIds: without(scope.contributionIds) };
    case "diagnostics":
      return { ...scope, categories: without(scope.categories) };
  }
}

function toggleScopeValue(
  scope: PluginCapabilityScope,
  requestedScope: PluginCapabilityScope,
  group: string,
  value: string,
): PluginCapabilityScope {
  if (scopeValueSelected(scope, group, value)) {
    return removeScopeValue(scope, group, value);
  }
  switch (scope.kind) {
    case "unscoped":
      return scope;
    case "file": {
      const area =
        requestedScope.kind === "file"
          ? requestedScope.areas.find((item) => item === value)
          : undefined;
      return area ? { ...scope, areas: [...scope.areas, area] } : scope;
    }
    case "network":
      return { ...scope, origins: [...scope.origins, value] };
    case "projects":
      return { ...scope, projectIds: [...scope.projectIds, value] };
    case "assets":
      return group === "projects"
        ? { ...scope, projectIds: [...scope.projectIds, value] }
        : { ...scope, assetIds: [...scope.assetIds, value] };
    case "operations":
      return { ...scope, operations: [...scope.operations, value] };
    case "contributions":
      return { ...scope, contributionIds: [...scope.contributionIds, value] };
    case "diagnostics":
      return { ...scope, categories: [...scope.categories, value] };
  }
}

function scopeValueSelected(
  scope: PluginCapabilityScope,
  group: string,
  value: string,
): boolean {
  return scopeGroups(scope).some(
    (candidate) => candidate.key === group && candidate.values.includes(value),
  );
}

function scopeHasAuthority(scope: PluginCapabilityScope): boolean {
  return (
    scope.kind === "unscoped" ||
    scopeGroups(scope).some((group) => group.values.length > 0)
  );
}

function previewBridgeMethods(
  methods:
    | Extract<PluginContributionDescriptor, { kind: "uiPanel" }>["methods"]
    | undefined,
): Array<
  | "panel.context"
  | "panel.activeSelection"
  | "panel.projectContext"
  | "panel.proposeReplacement"
> {
  const declared = methods?.length ? methods : ["panelContext"];
  const mapped = declared
    .map((method) => {
      switch (method) {
        case "panelContext":
          return "panel.context" as const;
        case "activeSelection":
          return "panel.activeSelection" as const;
        case "projectContext":
          return "panel.projectContext" as const;
        case "proposeReplacement":
          return "panel.proposeReplacement" as const;
        default:
          return null;
      }
    })
    .filter((method): method is NonNullable<typeof method> => method !== null);
  return mapped.length ? mapped : ["panel.context"];
}
