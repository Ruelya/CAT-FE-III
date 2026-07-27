import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AiConnectorCatalogItem,
  AiProviderProfile,
  PluginCapabilityAuditEntry,
  PluginCapabilityChangeKind,
  PluginCapabilityId,
  PluginCapabilityRequestView,
  PluginCapabilityReview,
  PluginCapabilityScope,
  PluginContributionDescriptor,
  PluginSummary,
} from "@translunar/contracts";
import {
  Ban,
  Eye,
  PackagePlus,
  Puzzle,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  ShieldEllipsis,
  X,
} from "lucide-react";

import { formatError } from "./workbench-utils";
import { useFocusTrap } from "./useFocusTrap";

import "./PluginsPanel.css";
import { useLocale } from "./i18n/LocaleProvider";
import type { MessageKey } from "./i18n/messages";
import { PluginPanelHost } from "./PluginPanelHost";

interface PluginsPanelProps {
  onRefresh(): Promise<void>;
}

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

export function PluginsPanel({ onRefresh }: PluginsPanelProps) {
  const { t, formatDate } = useLocale();
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [providerProfiles, setProviderProfiles] = useState<AiProviderProfile[]>(
    [],
  );
  const [connectorCatalog, setConnectorCatalog] = useState<
    AiConnectorCatalogItem[]
  >([]);
  const [connectorPermissions, setConnectorPermissions] = useState<
    Record<string, PluginCapabilityRequestView[] | null>
  >({});
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
  const dialogRef = useRef<HTMLElement>(null);

  const closeReview = useCallback(() => {
    if (busyId === null) {
      setReview(null);
      setAudit([]);
      setReason("");
    }
  }, [busyId]);
  useFocusTrap(dialogRef, { active: review !== null, onEscape: closeReview });

  const load = useCallback(async (preserveError = false) => {
    setLoading(true);
    if (!preserveError) setError(null);
    try {
      const [page, profiles, catalog] = await Promise.all([
        window.translunar.invoke("plugin.list", {
          offset: 0,
          limit: 100,
        }),
        window.translunar.invoke("ai.provider.list", {
          offset: 0,
          limit: 100,
        }),
        window.translunar.invoke("ai.provider.catalog", {}),
      ]);
      const connectorPlugins = page.items.filter((plugin) =>
        (plugin.contributions ?? []).some(
          (contribution) => contribution.kind === "engineConnector",
        ),
      );
      const permissionEntries = await Promise.all(
        connectorPlugins.map(async (plugin) => {
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
      setConnectorPermissions(Object.fromEntries(permissionEntries));
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  const install = async () => {
    setError(null);
    try {
      const sourcePath = await window.translunar.selectPluginPackage();
      if (!sourcePath) return;
      setBusyId("install");
      const result = await window.translunar.invoke("plugin.install", {
        sourcePath,
        actor: "desktop",
        reason: "install from Plugins panel",
      });
      await load();
      await onRefresh();
      await openReview(result.plugin.id);
    } catch (cause) {
      const message = formatError(cause);
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
    <section className="plugins-panel" aria-labelledby="plugins-heading">
      <header className="plugins-panel__header">
        <div>
          <h2 id="plugins-heading">
            <Puzzle size={16} aria-hidden />
            {t("plugins.title")}
          </h2>
          <p className="plugins-panel__lede">{t("plugins.lede")}</p>
        </div>
        <div className="plugins-panel__actions">
          <button type="button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} aria-hidden />
            {t("common.refresh")}
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void install()}
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
            return (
              <li key={plugin.id} className="plugins-panel__item">
                <div className="plugins-panel__identity">
                  <strong>{plugin.displayName}</strong>
                  <div className="plugins-panel__meta">
                    <span>{plugin.id}</span>
                    <span>v{plugin.version}</span>
                    <span>{plugin.tier}</span>
                    <span data-status={plugin.status}>{plugin.status}</span>
                  </div>
                  <div className="plugins-panel__meta">
                    {t("plugins.permissions", {
                      list:
                        plugin.grantedPermissions.join(", ") ||
                        t("plugins.permissionsNone"),
                    })}
                  </div>
                  {plugin.lastError ? (
                    <p className="plugins-panel__error">{plugin.lastError}</p>
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
                          connectorPermissions[plugin.id];
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
