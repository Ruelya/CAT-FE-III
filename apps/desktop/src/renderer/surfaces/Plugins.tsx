import { formatUiError } from "../lib/errors";
import { ConfirmDialog } from "../shell/ConfirmDialog";
import { InlineEmpty } from "../shell/InlineState";
import { SectionNav } from "../shell/SectionNav";
import { useDestructiveConfirm } from "../shell/use-destructive-confirm";
import { TableEmpty } from "../shell/TableEmpty";
import type { PluginsSection } from "../state/app-state";
import { projectConnectorSchema } from "../state/ai-view";
import {
  isContributionOpenable,
  projectAiActionSchema,
} from "../state/plugin-view";
import { safeJsonPreview } from "../state/external-connector-request";
import type { PluginControllerApi } from "../state/use-plugin-controller";
import type { PluginCapabilityRequestView } from "@translunar/contracts";
import { useMemo, useState } from "react";

export interface PluginsProps {
  plugins: PluginControllerApi;
  section: PluginsSection;
  disabled?: boolean;
  onBack: () => void;
  onSectionChange: (section: PluginsSection) => void;
}

const SECTIONS: Array<{ id: PluginsSection; label: string }> = [
  { id: "installed", label: "Installed" },
  { id: "bundled", label: "Bundled" },
  { id: "permissions", label: "Permissions" },
  { id: "aiActions", label: "AI actions" },
  { id: "uiPanels", label: "UI panels" },
  { id: "connectors", label: "Connectors" },
];

export function Plugins({
  plugins,
  section,
  disabled,
  onBack,
  onSectionChange,
}: PluginsProps) {
  const { state } = plugins;
  const busy = disabled === true || state.mutationPending;
  const [uninstallId, setUninstallId] = useState<{
    id: string;
    revision: number;
  } | null>(null);
  const [permissionDecision, setPermissionDecision] = useState<{
    request: PluginCapabilityRequestView;
    action: "grant" | "deny" | "revoke";
  } | null>(null);
  const [versionsFor, setVersionsFor] = useState<string | null>(null);
  const [selectedActionKey, setSelectedActionKey] = useState<string | null>(
    null,
  );

  const selectedProfile = useMemo(
    () => state.profiles.find((p) => p.id === state.selectedProfileId) ?? null,
    [state.profiles, state.selectedProfileId],
  );
  const selectedCatalog = useMemo(() => {
    if (!selectedProfile) return null;
    return (
      state.connectors.find(
        (c) =>
          c.owner.contributionId === selectedProfile.contributionId &&
          c.owner.pluginId === selectedProfile.pluginId,
      ) ?? null
    );
  }, [selectedProfile, state.connectors]);
  const selectedDescriptor = useMemo(() => {
    if (!selectedProfile) return null;
    return (
      state.connectorDescriptors[
        `${selectedProfile.pluginId}:${selectedProfile.contributionId}`
      ] ?? null
    );
  }, [selectedProfile, state.connectorDescriptors]);
  const declaredOps = selectedProfile?.operations?.length
    ? selectedProfile.operations
    : (selectedCatalog?.operations ?? []);
  const credentialSlots = useMemo(() => {
    if (selectedDescriptor?.credentialSlots?.length) {
      return selectedDescriptor.credentialSlots.map((s) => ({
        id: s.id,
        label: s.label,
      }));
    }
    if (selectedProfile?.credentialSlots?.length) {
      return selectedProfile.credentialSlots.map((s) => ({
        id: s.slotId,
        label: s.slotId,
      }));
    }
    if (selectedCatalog?.credentialSlots?.length) {
      return selectedCatalog.credentialSlots.map((id) => ({
        id,
        label: id,
      }));
    }
    return [] as Array<{ id: string; label: string }>;
  }, [selectedDescriptor, selectedProfile, selectedCatalog]);
  const profileForm = state.profileForm;
  const selectedAction = useMemo(() => {
    if (!selectedActionKey) return null;
    return (
      state.aiActions.find(
        (a) =>
          `${a.owner.pluginId}:${a.owner.contributionId}` === selectedActionKey,
      ) ?? null
    );
  }, [selectedActionKey, state.aiActions]);
  const actionSchema = useMemo(() => {
    if (!selectedAction) return null;
    const raw = selectedAction.descriptor.configSchema?.fields;
    if (!raw) return projectAiActionSchema(null);
    const fields = raw.map((field) => {
      const base = {
        key: field.key,
        label: field.label,
        fieldType: field.fieldType,
        required: field.required,
        defaultValue:
          typeof field.defaultValue === "string" ||
          typeof field.defaultValue === "number" ||
          typeof field.defaultValue === "boolean"
            ? field.defaultValue
            : null,
      };
      return field.options
        ? {
            ...base,
            options: field.options.map((o) => ({
              label: o.label,
              value: o.value,
            })),
          }
        : base;
    });
    return projectAiActionSchema(fields);
  }, [selectedAction]);

  const destructive = useDestructiveConfirm();

  return (
    <section className="surface p4-surface" data-testid="plugins">
      <div className="surface__masthead">
        <h1 className="surface__title">Plugins</h1>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={busy}
          onClick={onBack}
          data-testid="plugins-back"
        >
          Back
        </button>
      </div>

      <SectionNav
        label="Plugin sections"
        items={SECTIONS.map((s) => ({
          id: s.id,
          label: s.label,
          testId: `plugins-tab-${s.id}`,
        }))}
        current={section}
        disabled={busy}
        onSelect={onSectionChange}
      />

      {state.error ? (
        <p className="status status--error" role="alert">
          {formatUiError(state.error)}
        </p>
      ) : null}

      {(section === "installed" ||
        section === "bundled" ||
        section === "permissions") && (
        <div className="p4-toolbar">
          <label className="field field--inline">
            <span>Actor</span>
            <input
              value={state.actor}
              disabled={busy}
              onChange={(e) => plugins.setActor(e.target.value)}
              data-testid="plugin-actor"
            />
          </label>
          <label className="field field--inline">
            <span>Reason</span>
            <input
              value={state.reason}
              disabled={busy}
              onChange={(e) => plugins.setReason(e.target.value)}
              data-testid="plugin-reason"
            />
          </label>
        </div>
      )}

      {section === "installed" ? (
        <div className="p4-panel" data-testid="plugins-installed">
          <div className="dialog__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => void plugins.pickAndInspect()}
              data-testid="plugin-install-pick"
            >
              Install package
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy}
              onClick={() => void plugins.reloadInstalled(0)}
            >
              Reload
            </button>
          </div>
          {state.installed.length === 0 && !state.loading ? (
            <InlineEmpty
              label="No installed plugins"
              testId="plugins-installed-empty"
            />
          ) : (
            <table className="p4-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Version</th>
                  <th>Status</th>
                  <th>Tier</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {state.installed.map((p) => (
                  <tr key={p.id}>
                    <td className="p4-wrap">{p.displayName}</td>
                    <td>{p.version}</td>
                    <td>{p.status}</td>
                    <td>{p.tier}</td>
                    <td className="p4-row-actions">
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busy}
                        onClick={() => void plugins.selectPlugin(p.id)}
                      >
                        Select
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busy}
                        onClick={() => {
                          setVersionsFor(p.id);
                          void plugins.loadVersions(p.id);
                        }}
                        data-testid="plugin-versions"
                      >
                        Versions
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busy}
                        onClick={() =>
                          void plugins.enablePlugin(p.id, p.revision)
                        }
                      >
                        Enable
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busy}
                        onClick={() =>
                          void plugins.disablePlugin(p.id, p.revision)
                        }
                      >
                        Disable
                      </button>
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        disabled={busy}
                        onClick={() =>
                          setUninstallId({ id: p.id, revision: p.revision })
                        }
                      >
                        Uninstall
                      </button>
                    </td>
                  </tr>
                ))}
                {state.installed.length === 0 ? (
                  <TableEmpty colSpan={5} />
                ) : null}
              </tbody>
            </table>
          )}
          {versionsFor && state.versions.length > 0 ? (
            <div className="p4-form" data-testid="plugin-versions-panel">
              <h2 className="p4-subtitle">Versions</h2>
              <table className="p4-table">
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>State</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {state.versions.map((v) => (
                    <tr key={v.id}>
                      <td className="p4-wrap">{v.version}</td>
                      <td>{v.state}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={busy}
                          onClick={() => {
                            const plugin = state.installed.find(
                              (p) => p.id === versionsFor,
                            );
                            if (!plugin) return;
                            void plugins.rollbackVersion(
                              versionsFor,
                              v.id,
                              plugin.revision,
                            );
                          }}
                        >
                          Rollback
                        </button>
                      </td>
                    </tr>
                  ))}
                  {state.versions.length === 0 ? (
                    <TableEmpty colSpan={3} />
                  ) : null}
                </tbody>
              </table>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={busy}
                onClick={() => setVersionsFor(null)}
              >
                Close versions
              </button>
            </div>
          ) : null}
          {state.inspection ? (
            <div className="p4-form" data-testid="plugin-inspect">
              <h2 className="p4-subtitle">Inspection</h2>
              <p className="status">
                {state.inspection.normalizedManifest.displayName} · canInstall=
                {String(state.inspection.canInstall)}
              </p>
              <pre className="p4-pre">
                {safeJsonPreview({
                  compatibility: state.inspection.compatibility,
                  diagnostics: state.inspection.diagnostics,
                  sourceKind: state.inspection.sourceKind,
                })}
              </pre>
              <div className="dialog__actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={busy}
                  onClick={() => plugins.clearInspection()}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={busy || !state.inspection.canInstall}
                  onClick={() => void plugins.confirmInstall()}
                  data-testid="plugin-install-confirm"
                >
                  Install
                </button>
                {state.selectedPluginId ? (
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={busy}
                    onClick={() =>
                      void plugins.confirmUpgrade(state.selectedPluginId!)
                    }
                    data-testid="plugin-upgrade-confirm"
                  >
                    Upgrade selected
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {section === "bundled" ? (
        <div className="p4-panel" data-testid="plugins-bundled">
          {state.bundled.length === 0 ? (
            <InlineEmpty
              label="No bundled plugins"
              testId="plugins-bundled-empty"
            />
          ) : (
            <table className="p4-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Version</th>
                  <th>State</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {state.bundled.map((b) => (
                  <tr key={b.pluginId}>
                    <td className="p4-wrap">{b.displayName}</td>
                    <td>{b.version}</td>
                    <td>{b.installState}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        disabled={busy}
                        onClick={() => void plugins.applyBundled(b.pluginId)}
                      >
                        Apply
                      </button>
                    </td>
                  </tr>
                ))}
                {state.bundled.length === 0 ? <TableEmpty colSpan={4} /> : null}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      {section === "permissions" ? (
        <div className="p4-panel" data-testid="plugins-permissions">
          <div className="p4-toolbar">
            <select
              value={state.selectedPluginId ?? ""}
              disabled={busy}
              onChange={(e) => {
                const id = e.target.value || null;
                void plugins.selectPlugin(id);
                if (id) void plugins.loadPermissions(id);
              }}
              aria-label="Plugin"
              data-testid="permission-plugin"
            >
              <option value="">Plugin</option>
              {state.installed.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={busy || !state.selectedPluginId}
              onClick={() =>
                state.selectedPluginId &&
                void plugins.reviewPermissions(state.selectedPluginId)
              }
              data-testid="permission-review"
            >
              Review
            </button>
          </div>
          {state.permissionReview ? (
            <pre className="p4-pre" data-testid="permission-review-result">
              {safeJsonPreview({
                versionId: state.permissionReview.versionId,
                changes: state.permissionReview.changes,
              })}
            </pre>
          ) : null}
          {state.permissionRequests.length === 0 ? (
            <InlineEmpty label="No permission requests" />
          ) : (
            <table className="p4-table">
              <thead>
                <tr>
                  <th>Capability</th>
                  <th>Decision</th>
                  <th>Risk</th>
                  <th>Required</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {state.permissionRequests.map((r) => (
                  <tr key={r.id}>
                    <td className="p4-wrap">{r.capabilityId}</td>
                    <td>{r.decision}</td>
                    <td>{r.risk}</td>
                    <td>{r.required ? "yes" : "no"}</td>
                    <td className="p4-row-actions">
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busy}
                        onClick={() =>
                          setPermissionDecision({ request: r, action: "grant" })
                        }
                      >
                        Grant
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busy}
                        onClick={() =>
                          setPermissionDecision({ request: r, action: "deny" })
                        }
                      >
                        Deny
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busy}
                        onClick={() =>
                          setPermissionDecision({
                            request: r,
                            action: "revoke",
                          })
                        }
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
                {state.permissionRequests.length === 0 ? (
                  <TableEmpty colSpan={5} />
                ) : null}
              </tbody>
            </table>
          )}
          {state.audit.length > 0 ? (
            <pre className="p4-pre" data-testid="permission-audit">
              {safeJsonPreview(state.audit.slice(0, 20))}
            </pre>
          ) : null}
        </div>
      ) : null}

      {section === "aiActions" ? (
        <div className="p4-panel" data-testid="plugins-ai-actions">
          {state.aiActions.length === 0 ? (
            <InlineEmpty label="No AI actions" />
          ) : (
            <table className="p4-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>State</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {state.aiActions.map((a) => {
                  const key = `${a.owner.pluginId}:${a.owner.contributionId}`;
                  return (
                    <tr key={key}>
                      <td className="p4-wrap">{a.descriptor.displayName}</td>
                      <td>{a.state}</td>
                      <td className="p4-row-actions">
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={busy}
                          onClick={() => setSelectedActionKey(key)}
                        >
                          Configure
                        </button>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={
                            busy ||
                            !isContributionOpenable(a.state) ||
                            (actionSchema !== null &&
                              selectedActionKey === key &&
                              !actionSchema.ok)
                          }
                          onClick={() => void plugins.invokeAiAction(a)}
                        >
                          Invoke
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {state.aiActions.length === 0 ? (
                  <TableEmpty colSpan={3} />
                ) : null}
              </tbody>
            </table>
          )}
          {selectedAction && actionSchema ? (
            <div className="p4-form" data-testid="plugin-action-form">
              {actionSchema.ok ? (
                actionSchema.fields.map((field) => (
                  <label key={field.key} className="field">
                    <span>{field.label}</span>
                    {field.fieldType === "boolean" ? (
                      <input
                        type="checkbox"
                        checked={Boolean(state.actionConfig[field.key])}
                        disabled={busy}
                        onChange={(e) =>
                          plugins.setActionConfigValue(
                            field.key,
                            e.target.checked,
                          )
                        }
                      />
                    ) : field.fieldType === "select" ? (
                      <select
                        value={String(state.actionConfig[field.key] ?? "")}
                        disabled={busy}
                        onChange={(e) =>
                          plugins.setActionConfigValue(
                            field.key,
                            e.target.value,
                          )
                        }
                      >
                        {field.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={
                          field.fieldType === "integer" ||
                          field.fieldType === "number"
                            ? "number"
                            : "text"
                        }
                        value={String(state.actionConfig[field.key] ?? "")}
                        disabled={busy}
                        onChange={(e) => {
                          const v = e.target.value;
                          plugins.setActionConfigValue(
                            field.key,
                            field.fieldType === "integer" ||
                              field.fieldType === "number"
                              ? Number(v)
                              : v,
                          );
                        }}
                      />
                    )}
                  </label>
                ))
              ) : (
                <p className="status" data-testid="plugin-action-unsupported">
                  Unsupported schema
                </p>
              )}
              <div className="dialog__actions">
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={busy}
                  onClick={() => setSelectedActionKey(null)}
                >
                  Close
                </button>
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={busy || !state.activeInvocationId}
                  onClick={() => void plugins.cancelAiAction()}
                  data-testid="plugin-action-cancel"
                >
                  Cancel invocation
                </button>
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={busy}
                  onClick={() =>
                    void plugins.loadAiActionHistory(
                      selectedAction.owner.pluginId,
                    )
                  }
                  data-testid="plugin-action-history"
                >
                  History
                </button>
              </div>
              {state.activeInvocationId ? (
                <p className="status" data-testid="plugin-action-invocation">
                  {state.activeInvocationId}
                </p>
              ) : null}
            </div>
          ) : null}
          {state.actionResult ? (
            <pre className="p4-pre" data-testid="plugin-action-result">
              {state.actionResult}
            </pre>
          ) : null}
          {state.actionHistory.length > 0 ? (
            <pre className="p4-pre" data-testid="plugin-action-history-list">
              {safeJsonPreview(state.actionHistory.slice(0, 20))}
            </pre>
          ) : null}
        </div>
      ) : null}

      {section === "uiPanels" ? (
        <div className="p4-panel" data-testid="plugins-ui-panels">
          {state.uiPanels.length === 0 ? (
            <InlineEmpty label="No UI panels" />
          ) : (
            <table className="p4-table">
              <thead>
                <tr>
                  <th>Panel</th>
                  <th>State</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {state.uiPanels.map((p) => (
                  <tr key={`${p.owner.pluginId}:${p.owner.contributionId}`}>
                    <td className="p4-wrap">{p.descriptor.displayName}</td>
                    <td>{p.state}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        disabled={busy || !isContributionOpenable(p.state)}
                        onClick={() => void plugins.openUiPanel(p)}
                        data-testid="plugin-panel-open"
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
                {state.uiPanels.length === 0 ? (
                  <TableEmpty colSpan={3} />
                ) : null}
              </tbody>
            </table>
          )}
          {state.panelSession ? (
            <div className="p4-panel-host" data-testid="plugin-panel-host">
              <div className="p4-toolbar">
                <span className="p4-wrap">
                  {state.panelSession.contributionId}
                </span>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => void plugins.closeUiPanel()}
                  data-testid="plugin-panel-close"
                >
                  Close
                </button>
              </div>
              <iframe
                title={state.panelSession.contributionId}
                src={state.panelSession.url}
                sandbox="allow-scripts"
                className="p4-plugin-frame"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {section === "connectors" ? (
        <div className="p4-panel" data-testid="plugins-connectors">
          <h2 className="p4-subtitle">Catalog</h2>
          {state.connectors.length === 0 ? (
            <InlineEmpty label="No connectors" testId="connectors-empty" />
          ) : (
            <table className="p4-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>State</th>
                  <th>Operations</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {state.connectors.map((c) => {
                  const desc =
                    state.connectorDescriptors[
                      `${c.owner.pluginId}:${c.owner.contributionId}`
                    ] ?? null;
                  const schemaOk = desc
                    ? projectConnectorSchema(desc.configSchema).ok
                    : false;
                  return (
                    <tr key={`${c.owner.pluginId}:${c.owner.contributionId}`}>
                      <td className="p4-wrap">{c.displayName}</td>
                      <td>{c.state}</td>
                      <td className="p4-wrap">{c.operations.join(", ")}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={busy || c.state !== "active" || !schemaOk}
                          onClick={() => plugins.beginCreateProfile(c)}
                          data-testid="connector-profile-create"
                        >
                          Create profile
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {state.connectors.length === 0 ? (
                  <TableEmpty colSpan={4} />
                ) : null}
              </tbody>
            </table>
          )}
          {profileForm ? (
            <div className="p4-form" data-testid="connector-profile-form">
              <label className="field">
                <span>Display name</span>
                <input
                  value={profileForm.displayName}
                  disabled={busy}
                  onChange={(e) =>
                    plugins.patchProfileForm({ displayName: e.target.value })
                  }
                  data-testid="connector-profile-name"
                />
              </label>
              <label className="field">
                <span>Enabled</span>
                <input
                  type="checkbox"
                  checked={profileForm.enabled}
                  disabled={busy}
                  onChange={(e) =>
                    plugins.patchProfileForm({ enabled: e.target.checked })
                  }
                />
              </label>
              {profileForm.schemaOk ? (
                profileForm.configFields.map((field) => (
                  <label key={field.key} className="field">
                    <span>{field.label}</span>
                    {field.fieldType === "boolean" ? (
                      <input
                        type="checkbox"
                        checked={Boolean(profileForm.configValues[field.key])}
                        disabled={busy}
                        onChange={(e) =>
                          plugins.setProfileConfigValue(
                            field.key,
                            e.target.checked,
                          )
                        }
                      />
                    ) : field.fieldType === "select" ? (
                      <select
                        value={String(
                          profileForm.configValues[field.key] ?? "",
                        )}
                        disabled={busy}
                        onChange={(e) =>
                          plugins.setProfileConfigValue(
                            field.key,
                            e.target.value,
                          )
                        }
                      >
                        {field.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={field.fieldType === "integer" ? "number" : "text"}
                        value={String(
                          profileForm.configValues[field.key] ?? "",
                        )}
                        disabled={busy}
                        onChange={(e) => {
                          const v = e.target.value;
                          plugins.setProfileConfigValue(
                            field.key,
                            field.fieldType === "integer" ? Number(v) : v,
                          );
                        }}
                      />
                    )}
                  </label>
                ))
              ) : (
                <p
                  className="status"
                  data-testid="connector-profile-unsupported"
                >
                  Unsupported schema
                </p>
              )}
              <div className="dialog__actions">
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={busy}
                  onClick={() => plugins.clearProfileForm()}
                >
                  Cancel
                </button>
                {profileForm.mode === "create" ? (
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={busy || !profileForm.schemaOk}
                    onClick={() => void plugins.createProfile()}
                    data-testid="connector-profile-save"
                  >
                    Create
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={busy || !profileForm.schemaOk}
                    onClick={() => void plugins.updateProfile()}
                    data-testid="connector-profile-save"
                  >
                    Update
                  </button>
                )}
              </div>
            </div>
          ) : null}
          <h2 className="p4-subtitle">Profiles</h2>
          <table className="p4-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Enabled</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {state.profiles.map((p) => (
                <tr key={p.id}>
                  <td className="p4-wrap">{p.displayName}</td>
                  <td>{p.enabled ? "yes" : "no"}</td>
                  <td className="p4-row-actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={busy}
                      onClick={() => plugins.selectProfile(p.id)}
                    >
                      Select
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={busy}
                      onClick={() => plugins.beginEditProfile(p.id)}
                      data-testid="connector-profile-edit"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn--danger btn--sm"
                      disabled={busy}
                      onClick={() =>
                        destructive.request({
                          title: "Delete connector profile",
                          body: `${p.displayName} will be deleted.`,
                          confirmLabel: "Delete",
                          testId: "connector-profile-delete-confirm",
                          run: () => plugins.deleteProfile(p.id, p.revision),
                        })
                      }
                      aria-label={`Delete connector profile ${p.displayName}`}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {state.profiles.length === 0 ? <TableEmpty colSpan={3} /> : null}
            </tbody>
          </table>
          {state.selectedProfileId ? (
            <div className="p4-form" data-testid="connector-console">
              <label className="field">
                <span>Operation</span>
                <select
                  value={state.connectorOp}
                  disabled={busy || declaredOps.length === 0}
                  onChange={(e) =>
                    plugins.setConnectorOp(
                      e.target.value as typeof state.connectorOp,
                    )
                  }
                  data-testid="connector-operation"
                >
                  {declaredOps.map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Stream</span>
                <input
                  value={state.connectorForm.streamId}
                  disabled={busy}
                  onChange={(e) =>
                    plugins.patchConnectorForm({ streamId: e.target.value })
                  }
                />
              </label>
              {credentialSlots.length > 0 ? (
                <>
                  <label className="field">
                    <span>Credential slot</span>
                    <select
                      value={state.credentialSlot}
                      disabled={busy}
                      onChange={(e) =>
                        plugins.setCredentialSlot(e.target.value)
                      }
                      data-testid="connector-credential-slot"
                    >
                      <option value="">Select slot</option>
                      {credentialSlots.map((slot) => (
                        <option key={slot.id} value={slot.id}>
                          {slot.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedProfile?.credentialSlots ? (
                    <p
                      className="status"
                      data-testid="connector-credential-status"
                    >
                      {selectedProfile.credentialSlots
                        .map(
                          (s) =>
                            `${s.slotId}:${s.present ? "present" : "missing"}`,
                        )
                        .join(" · ")}
                    </p>
                  ) : null}
                  <label className="field">
                    <span>Secret</span>
                    <input
                      type="password"
                      autoComplete="off"
                      value={state.credentialSecret}
                      disabled={busy}
                      onChange={(e) =>
                        plugins.setCredentialSecret(e.target.value)
                      }
                    />
                  </label>
                  <div className="dialog__actions">
                    <button
                      type="button"
                      className="btn btn--secondary"
                      disabled={busy || !state.credentialSlot}
                      onClick={() => void plugins.setCredential()}
                    >
                      Set credential
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      disabled={busy || !state.credentialSlot}
                      onClick={() =>
                        destructive.request({
                          title: "Delete credential",
                          body: "The stored connector credential will be removed from the OS keyring.",
                          confirmLabel: "Delete",
                          testId: "connector-credential-delete-confirm",
                          run: () => plugins.deleteCredential(),
                        })
                      }
                      data-testid="connector-credential-delete"
                    >
                      Delete credential
                    </button>
                  </div>
                </>
              ) : null}
              <div className="dialog__actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={busy || declaredOps.length === 0}
                  onClick={() => void plugins.invokeConnector()}
                  data-testid="connector-invoke"
                >
                  Invoke
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={busy || !state.connectorForm.streamId}
                  onClick={() =>
                    void plugins.loadCheckpoint(state.connectorForm.streamId)
                  }
                >
                  Checkpoint
                </button>
              </div>
              {state.invokeResult ? (
                <pre className="p4-pre" data-testid="connector-result">
                  {safeJsonPreview(state.invokeResult)}
                </pre>
              ) : null}
              {state.checkpoint ? (
                <pre className="p4-pre">
                  {safeJsonPreview({
                    streamId: state.checkpoint.streamId,
                    revision: state.checkpoint.revision,
                    cursor: state.checkpoint.cursor,
                    payloadHash: state.checkpoint.payloadHash,
                  })}
                </pre>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {uninstallId ? (
        <ConfirmDialog
          title="Uninstall plugin"
          body="Uninstall this plugin from the local registry."
          confirmLabel="Uninstall"
          pending={busy}
          onCancel={() => setUninstallId(null)}
          onConfirm={() => {
            void plugins
              .uninstallPlugin(uninstallId.id, uninstallId.revision)
              .then(() => setUninstallId(null));
          }}
        />
      ) : null}

      {permissionDecision ? (
        <ConfirmDialog
          title={`${permissionDecision.action} permission`}
          body={`${permissionDecision.request.capabilityId} · ${permissionDecision.request.risk}`}
          confirmLabel={
            permissionDecision.action === "grant"
              ? "Grant"
              : permissionDecision.action === "deny"
                ? "Deny"
                : "Revoke"
          }
          pending={busy}
          onCancel={() => setPermissionDecision(null)}
          onConfirm={() => {
            const { request, action } = permissionDecision;
            const run =
              action === "grant"
                ? plugins.grantPermission(request)
                : action === "deny"
                  ? plugins.denyPermission(request)
                  : plugins.revokePermission(request);
            void run.then((ok) => {
              if (ok) setPermissionDecision(null);
            });
          }}
        />
      ) : null}
      {destructive.dialog}
    </section>
  );
}
