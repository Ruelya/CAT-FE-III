import { formatAiError } from "../lib/errors";
import type { AiControlSection } from "../state/app-state";
import { aiSectionAvailable } from "../state/p4-route-context";
import type { AiControllerApi } from "../state/use-ai-controller";
import type { P4ProjectContext } from "../state/p4-route-context";
import {
  canApplyRun,
  canCancelBatch,
  canCancelRun,
  canResumeBatch,
  canResumeRun,
  formatProviderSource,
} from "../state/ai-view";
import { SectionNav } from "../shell/SectionNav";
import { useDestructiveConfirm } from "../shell/use-destructive-confirm";
import { TableEmpty } from "../shell/TableEmpty";

export interface AiControlProps {
  ai: AiControllerApi;
  section: AiControlSection;
  context: P4ProjectContext | null;
  disabled?: boolean;
  onBack: () => void;
  onSectionChange: (section: AiControlSection) => void;
}

const ALL_SECTIONS: Array<{ id: AiControlSection; label: string }> = [
  { id: "providers", label: "Providers" },
  { id: "interactive", label: "Interactive" },
  { id: "batch", label: "Batch" },
  { id: "usage", label: "Usage" },
  { id: "quality", label: "Quality" },
];

const PAGE_SIZE = 50;

export function AiControl({
  ai,
  section,
  context,
  disabled,
  onBack,
  onSectionChange,
}: AiControlProps) {
  const { state } = ai;
  const busy = disabled === true || state.mutationPending;
  const sections = ALL_SECTIONS.filter((s) =>
    aiSectionAvailable(s.id, context),
  );
  const runnableProfiles = ai.runnableProfiles();

  const destructive = useDestructiveConfirm();

  return (
    <section className="surface p4-surface" data-testid="ai-control">
      <div className="surface__masthead">
        <h1 className="surface__title">AI Control</h1>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={busy}
          onClick={onBack}
          data-testid="ai-back"
        >
          Back
        </button>
      </div>

      <SectionNav
        label="AI sections"
        items={sections.map((s) => ({
          id: s.id,
          label: s.label,
          testId: `ai-tab-${s.id}`,
        }))}
        current={section}
        disabled={busy}
        onSelect={onSectionChange}
      />

      {state.error ? (
        <p className="status status--error" role="alert">
          {formatAiError(state.error)}
        </p>
      ) : null}
      {state.loading ? <p className="status">Loading</p> : null}

      {section === "providers" ? (
        <div className="p4-panel" data-testid="ai-providers">
          <div className="p4-toolbar">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={busy}
              onClick={() => void ai.reloadProviders()}
            >
              Reload
            </button>
          </div>
          <h2 className="p4-subtitle">Catalog</h2>
          {state.catalog.length === 0 && !state.loading ? (
            <p className="status" data-testid="ai-catalog-empty">
              Empty
            </p>
          ) : (
            <table className="p4-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Source</th>
                  <th>Availability</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.catalog.map((item) => (
                  <tr key={item.id}>
                    <td className="p4-wrap">{item.displayName}</td>
                    <td className="p4-wrap">
                      {formatProviderSource(item.source)}
                    </td>
                    <td>{item.availability}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busy || item.availability === "unavailable"}
                        onClick={() => ai.beginCreateProfile(item.id)}
                      >
                        Create
                      </button>
                    </td>
                  </tr>
                ))}
                {state.catalog.length === 0 ? <TableEmpty colSpan={4} /> : null}
              </tbody>
            </table>
          )}

          <h2 className="p4-subtitle">Profiles</h2>
          {state.profiles.length === 0 ? (
            <p className="status" data-testid="ai-profiles-empty">
              Empty
            </p>
          ) : (
            <table className="p4-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Model</th>
                  <th>Enabled</th>
                  <th>Credential</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.profiles.map((p) => (
                  <tr key={p.id}>
                    <td className="p4-wrap">{p.name}</td>
                    <td className="p4-wrap">{p.model}</td>
                    <td>{p.enabled ? "yes" : "no"}</td>
                    <td>{p.credentialPresent ? "present" : "missing"}</td>
                    <td className="p4-row-actions">
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busy}
                        onClick={() => {
                          ai.selectProfile(p.id);
                          ai.beginEditProfile(p.id);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busy}
                        onClick={() => void ai.testProfile(p.id)}
                      >
                        Test
                      </button>
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        disabled={busy}
                        onClick={() =>
                          destructive.request({
                            title: "Delete AI profile",
                            body: `${p.name} will be deleted.`,
                            confirmLabel: "Delete",
                            testId: "ai-profile-delete-confirm",
                            run: () => ai.deleteProfile(p.id, p.revision),
                          })
                        }
                        aria-label={`Delete AI profile ${p.name}`}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {state.profiles.length === 0 ? (
                  <TableEmpty colSpan={5} />
                ) : null}
              </tbody>
            </table>
          )}

          {state.providerForm ? (
            <div className="p4-form" data-testid="ai-provider-form">
              <h2 className="p4-subtitle">
                {state.selectedProfileId ? "Edit profile" : "Create profile"}
              </h2>
              {!state.providerForm.schemaOk ? (
                <p className="status status--error">
                  Unsupported schema
                  {state.providerForm.unsupported.length
                    ? `: ${state.providerForm.unsupported.join(", ")}`
                    : ""}
                </p>
              ) : null}
              <label className="field">
                <span>Name</span>
                <input
                  value={state.providerForm.name}
                  disabled={busy || !state.providerForm.schemaOk}
                  onChange={(e) =>
                    ai.patchProviderForm({ name: e.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>Model</span>
                <input
                  value={state.providerForm.model}
                  disabled={busy || !state.providerForm.schemaOk}
                  onChange={(e) =>
                    ai.patchProviderForm({ model: e.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>Base URL</span>
                <input
                  value={state.providerForm.baseUrl}
                  disabled={busy || !state.providerForm.schemaOk}
                  onChange={(e) =>
                    ai.patchProviderForm({ baseUrl: e.target.value })
                  }
                />
              </label>
              <label className="field field--inline">
                <input
                  type="checkbox"
                  checked={state.providerForm.enabled}
                  disabled={busy || !state.providerForm.schemaOk}
                  onChange={(e) =>
                    ai.patchProviderForm({ enabled: e.target.checked })
                  }
                />
                <span>Enabled</span>
              </label>
              {state.providerForm.configFields.map((f) => (
                <label key={f.key} className="field">
                  <span>{f.label}</span>
                  {f.fieldType === "boolean" ? (
                    <input
                      type="checkbox"
                      checked={Boolean(state.providerForm?.configValues[f.key])}
                      disabled={busy}
                      onChange={(e) =>
                        ai.setConfigValue(f.key, e.target.checked)
                      }
                    />
                  ) : f.fieldType === "select" ? (
                    <select
                      value={String(
                        state.providerForm?.configValues[f.key] ?? "",
                      )}
                      disabled={busy}
                      onChange={(e) => ai.setConfigValue(f.key, e.target.value)}
                    >
                      {f.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={f.fieldType === "integer" ? "number" : "text"}
                      value={String(
                        state.providerForm?.configValues[f.key] ?? "",
                      )}
                      disabled={busy}
                      onChange={(e) =>
                        ai.setConfigValue(
                          f.key,
                          f.fieldType === "integer"
                            ? Number(e.target.value)
                            : e.target.value,
                        )
                      }
                    />
                  )}
                </label>
              ))}
              <div className="dialog__actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={busy}
                  onClick={() => ai.clearProviderForm()}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={busy || !state.providerForm.schemaOk}
                  onClick={() =>
                    void (state.selectedProfileId
                      ? ai.updateProfile()
                      : ai.createProfile())
                  }
                >
                  Save
                </button>
              </div>
            </div>
          ) : null}

          {state.selectedProfileId ? (
            <div className="p4-form" data-testid="ai-credential">
              <h2 className="p4-subtitle">Credential</h2>
              <p className="status">
                Status:{" "}
                {state.credentialStatus
                  ? state.credentialStatus.present
                    ? "present"
                    : "missing"
                  : "-"}
              </p>
              <label className="field">
                <span>Secret</span>
                <input
                  type="password"
                  autoComplete="off"
                  value={state.credentialSecret}
                  disabled={busy}
                  onChange={(e) => ai.setCredentialSecret(e.target.value)}
                  data-testid="ai-credential-input"
                />
              </label>
              <div className="dialog__actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={busy || !state.credentialSecret}
                  onClick={() =>
                    void ai.saveCredential(state.selectedProfileId!)
                  }
                >
                  Set credential
                </button>
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={busy}
                  onClick={() =>
                    destructive.request({
                      title: "Delete credential",
                      body: "The stored credential for this profile will be removed from the OS keyring.",
                      confirmLabel: "Delete",
                      testId: "ai-credential-delete-confirm",
                      run: () => ai.deleteCredential(state.selectedProfileId!),
                    })
                  }
                >
                  Delete credential
                </button>
              </div>
            </div>
          ) : null}

          {state.settingsForm ? (
            <div className="p4-form" data-testid="ai-settings">
              <h2 className="p4-subtitle">AI settings</h2>
              <label className="field field--inline">
                <input
                  type="checkbox"
                  checked={state.settingsForm.enabled}
                  disabled={busy}
                  onChange={(e) =>
                    ai.patchSettingsForm({ enabled: e.target.checked })
                  }
                />
                <span>Enabled</span>
              </label>
              <label className="field field--inline">
                <input
                  type="checkbox"
                  checked={state.settingsForm.allowInteractive}
                  disabled={busy}
                  onChange={(e) =>
                    ai.patchSettingsForm({
                      allowInteractive: e.target.checked,
                    })
                  }
                />
                <span>Interactive</span>
              </label>
              <label className="field field--inline">
                <input
                  type="checkbox"
                  checked={state.settingsForm.allowBatch}
                  disabled={busy}
                  onChange={(e) =>
                    ai.patchSettingsForm({ allowBatch: e.target.checked })
                  }
                />
                <span>Batch</span>
              </label>
              <label className="field">
                <span>Default profile</span>
                <select
                  value={state.settingsForm.defaultProfileId ?? ""}
                  disabled={busy}
                  onChange={(e) =>
                    ai.patchSettingsForm({
                      defaultProfileId: e.target.value || null,
                    })
                  }
                  data-testid="ai-settings-default-profile"
                >
                  <option value="">None</option>
                  {state.profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Origin allowlist</span>
                <textarea
                  value={(state.settingsForm.allowedOrigins ?? []).join("\n")}
                  disabled={busy}
                  rows={3}
                  onChange={(e) =>
                    ai.patchSettingsForm({
                      allowedOrigins: e.target.value
                        .split("\n")
                        .map((line) => line.trim())
                        .filter(Boolean),
                    })
                  }
                  data-testid="ai-settings-origins"
                />
              </label>
              <label className="field">
                <span>Monthly token budget</span>
                <input
                  type="number"
                  min={0}
                  value={state.settingsForm.monthlyTokenBudget ?? ""}
                  disabled={busy}
                  onChange={(e) => {
                    const raw = e.target.value;
                    ai.patchSettingsForm({
                      monthlyTokenBudget:
                        raw === "" ? null : Number.parseInt(raw, 10),
                    });
                  }}
                  data-testid="ai-settings-budget"
                />
              </label>
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={() => void ai.saveSettings()}
                data-testid="ai-settings-save"
              >
                Save settings
              </button>
            </div>
          ) : null}

          {state.testResult ? (
            <p className="status" data-testid="ai-test-result">
              {state.testResult}
            </p>
          ) : null}
        </div>
      ) : null}

      {section === "interactive" ? (
        <div className="p4-panel" data-testid="ai-interactive">
          {runnableProfiles.length === 0 ? (
            <p className="status" data-testid="ai-no-credential-profile">
              Empty
            </p>
          ) : null}
          {runnableProfiles.length > 0 ? (
            <div className="p4-form">
              <label className="field">
                <span>Profile</span>
                <select
                  value={state.selectedProfileId ?? ""}
                  disabled={busy}
                  onChange={(e) => ai.selectProfile(e.target.value || null)}
                  data-testid="ai-run-profile"
                >
                  <option value="">Default</option>
                  {runnableProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Action</span>
                <select
                  value={state.action}
                  disabled={busy}
                  onChange={(e) =>
                    ai.setAction(e.target.value as typeof state.action)
                  }
                >
                  {(
                    [
                      "translate",
                      "improve",
                      "formal",
                      "conversational",
                      "shorten",
                      "expand",
                      "literal",
                      "freeform",
                    ] as const
                  ).map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Prompt</span>
                <textarea
                  value={state.prompt}
                  disabled={busy}
                  onChange={(e) => ai.setPrompt(e.target.value)}
                  rows={3}
                />
              </label>
              <div className="dialog__actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={busy}
                  onClick={() => void ai.previewGrounding()}
                  data-testid="ai-grounding"
                >
                  Grounding
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={busy}
                  onClick={() => void ai.startRun()}
                  data-testid="ai-run-start"
                >
                  Start run
                </button>
              </div>
            </div>
          ) : null}
          <>
            {state.groundingPreview ? (
              <pre className="p4-pre" data-testid="ai-grounding-preview">
                {state.groundingPreview}
              </pre>
            ) : null}
            {state.activeRun ? (
              <div className="p4-form" data-testid="ai-run-status">
                <p className="status">
                  Run {state.activeRun.id} · {state.activeRun.status}
                </p>
                <pre className="p4-pre">
                  {state.activeRun.proposalText ??
                    state.eventReplay.proposalText}
                </pre>
                <div className="dialog__actions">
                  {canCancelRun(state.activeRun.status) ? (
                    <button
                      type="button"
                      className="btn btn--secondary"
                      disabled={busy}
                      onClick={() => void ai.cancelRun()}
                    >
                      Cancel
                    </button>
                  ) : null}
                  {canResumeRun(state.activeRun.status) ? (
                    <button
                      type="button"
                      className="btn btn--secondary"
                      disabled={busy}
                      onClick={() => void ai.resumeRun()}
                    >
                      Resume
                    </button>
                  ) : null}
                  {canApplyRun(
                    state.activeRun.status,
                    state.activeRun.proposalText,
                  ) ? (
                    <button
                      type="button"
                      className="btn btn--primary"
                      disabled={busy}
                      onClick={() => void ai.applyResult()}
                      data-testid="ai-run-apply"
                    >
                      Apply
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={busy}
                    onClick={() => ai.discardProposal()}
                  >
                    Discard
                  </button>
                </div>
              </div>
            ) : null}
            <h2 className="p4-subtitle">Conversations</h2>
            <div className="p4-toolbar">
              <input
                value={state.conversationTitle}
                disabled={busy}
                onChange={(e) => ai.setConversationTitle(e.target.value)}
                placeholder="Title"
              />
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={busy}
                onClick={() => void ai.createConversation()}
              >
                Create
              </button>
            </div>
            <ul className="p4-list">
              {state.conversations.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={busy}
                    onClick={() => void ai.selectConversation(c.id)}
                  >
                    {c.title}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={busy}
                    onClick={() =>
                      void ai.archiveConversation(c.id, c.revision)
                    }
                  >
                    Archive
                  </button>
                </li>
              ))}
            </ul>
            {state.selectedConversationId ? (
              <div className="p4-form" data-testid="ai-messages">
                <div className="p4-toolbar">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={busy || state.messagesOffset <= 0}
                    onClick={() =>
                      void ai.loadMessages(
                        Math.max(0, state.messagesOffset - 50),
                      )
                    }
                  >
                    Prev
                  </button>
                  <span className="status">
                    {state.messagesOffset}/{state.messagesTotal}
                  </span>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={
                      busy ||
                      state.messagesOffset + state.messages.length >=
                        state.messagesTotal
                    }
                    onClick={() =>
                      void ai.loadMessages(state.messagesOffset + 50)
                    }
                  >
                    Next
                  </button>
                </div>
                <ul className="p4-list" data-testid="ai-message-list">
                  {state.messages.map((m) => (
                    <li key={m.id} className="p4-wrap">
                      <strong>{m.role}</strong>: {m.text}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <h2 className="p4-subtitle">Runs</h2>
            <div className="p4-toolbar">
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={busy}
                onClick={() => void ai.loadRuns(0)}
                data-testid="ai-run-list"
              >
                Reload runs
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={busy || state.runsOffset <= 0}
                onClick={() =>
                  void ai.loadRuns(Math.max(0, state.runsOffset - PAGE_SIZE))
                }
                data-testid="ai-runs-prev"
              >
                Prev
              </button>
              <span className="status" data-testid="ai-runs-page">
                {state.runsOffset}/{state.runsTotal}
              </span>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={
                  busy ||
                  state.runsOffset + state.runs.length >= state.runsTotal
                }
                onClick={() => void ai.loadRuns(state.runsOffset + PAGE_SIZE)}
                data-testid="ai-runs-next"
              >
                Next
              </button>
            </div>
            <ul className="p4-list" data-testid="ai-runs">
              {state.runs.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={busy}
                    onClick={() => void ai.reopenRun(r.id)}
                  >
                    {r.id} · {r.status}
                  </button>
                </li>
              ))}
            </ul>
            {state.lastApplyMutation ? (
              <p className="status" data-testid="ai-apply-mutation">
                Applied rows {state.lastApplyMutation.rows.length}
              </p>
            ) : null}
          </>
        </div>
      ) : null}

      {section === "batch" ? (
        <div className="p4-panel" data-testid="ai-batch">
          {runnableProfiles.length === 0 ? (
            <p className="status" data-testid="ai-batch-no-profile">
              Empty
            </p>
          ) : null}
          <div className="dialog__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || runnableProfiles.length === 0}
              onClick={() => void ai.startBatch()}
              data-testid="ai-batch-start"
            >
              Start batch
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy}
              onClick={() => void ai.loadBatches(0)}
            >
              Reload
            </button>
          </div>
          <div className="p4-toolbar">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={busy || state.batchRunsOffset <= 0}
              onClick={() =>
                void ai.loadBatches(
                  Math.max(0, state.batchRunsOffset - PAGE_SIZE),
                )
              }
              data-testid="ai-batch-prev"
            >
              Prev
            </button>
            <span className="status" data-testid="ai-batch-page">
              {state.batchRunsOffset}/{state.batchRunsTotal}
            </span>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={
                busy ||
                state.batchRunsOffset + state.batchRuns.length >=
                  state.batchRunsTotal
              }
              onClick={() =>
                void ai.loadBatches(state.batchRunsOffset + PAGE_SIZE)
              }
              data-testid="ai-batch-next"
            >
              Next
            </button>
          </div>
          {state.batchRuns.length === 0 ? (
            <p className="status">Empty</p>
          ) : (
            <table className="p4-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Status</th>
                  <th>Counts</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.batchRuns.map((b) => (
                  <tr key={b.id}>
                    <td className="p4-wrap">{b.id}</td>
                    <td>{b.status}</td>
                    <td className="p4-wrap">
                      {b.succeeded}/{b.failed}/{b.skipped}/{b.total}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busy}
                        onClick={() => void ai.selectBatch(b.id, 0)}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
                {state.batchRuns.length === 0 ? (
                  <TableEmpty colSpan={4} />
                ) : null}
              </tbody>
            </table>
          )}
          {state.selectedBatch ? (
            <div className="p4-form" data-testid="ai-batch-detail">
              <p className="status">
                {state.selectedBatch.id} · {state.selectedBatch.status} ·
                succeeded={state.selectedBatch.succeeded} failed=
                {state.selectedBatch.failed} skipped=
                {state.selectedBatch.skipped} total=
                {state.selectedBatch.total}
              </p>
              <div className="dialog__actions">
                {canCancelBatch(state.selectedBatch.status) ? (
                  <button
                    type="button"
                    className="btn btn--secondary"
                    disabled={busy}
                    onClick={() => void ai.cancelBatch()}
                  >
                    Cancel
                  </button>
                ) : null}
                {canResumeBatch(state.selectedBatch.status) ? (
                  <button
                    type="button"
                    className="btn btn--secondary"
                    disabled={busy}
                    onClick={() => void ai.resumeBatch()}
                  >
                    Resume
                  </button>
                ) : null}
              </div>
              <div className="p4-toolbar">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={busy || state.batchItemsOffset <= 0}
                  onClick={() =>
                    void ai.loadBatchItems(
                      Math.max(0, state.batchItemsOffset - PAGE_SIZE),
                    )
                  }
                  data-testid="ai-batch-items-prev"
                >
                  Prev
                </button>
                <span className="status" data-testid="ai-batch-items-page">
                  {state.batchItemsOffset}/{state.batchItemsTotal}
                </span>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={
                    busy ||
                    state.batchItemsOffset + state.batchItems.length >=
                      state.batchItemsTotal
                  }
                  onClick={() =>
                    void ai.loadBatchItems(state.batchItemsOffset + PAGE_SIZE)
                  }
                  data-testid="ai-batch-items-next"
                >
                  Next
                </button>
              </div>
              <table className="p4-table" data-testid="ai-batch-items">
                <thead>
                  <tr>
                    <th>Segment</th>
                    <th>Status</th>
                    <th>Error</th>
                    <th>Attempts</th>
                  </tr>
                </thead>
                <tbody>
                  {state.batchItems.map((item) => (
                    <tr key={`${item.segmentId}-${item.ordinal}`}>
                      <td className="p4-wrap">{item.segmentId}</td>
                      <td>{item.status}</td>
                      <td className="p4-wrap">{item.errorCode ?? ""}</td>
                      <td>{item.attempts}</td>
                    </tr>
                  ))}
                  {state.batchItems.length === 0 ? (
                    <TableEmpty colSpan={4} />
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      {section === "usage" ? (
        <div className="p4-panel" data-testid="ai-usage">
          <div className="p4-form">
            <label className="field">
              <span>Dimension</span>
              <select
                value={state.usageDimension}
                disabled={busy}
                onChange={(e) =>
                  ai.setUsageDimension(
                    e.target.value as typeof state.usageDimension,
                  )
                }
                data-testid="ai-usage-dimension"
              >
                {(
                  ["day", "month", "project", "provider", "model"] as const
                ).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Since (ms)</span>
              <input
                type="number"
                value={state.usageSinceMs}
                disabled={busy}
                onChange={(e) =>
                  ai.setUsageRange(
                    Number.parseInt(e.target.value, 10) || 0,
                    state.usageUntilMs,
                  )
                }
                data-testid="ai-usage-since"
              />
            </label>
            <label className="field">
              <span>Until (ms)</span>
              <input
                type="number"
                value={state.usageUntilMs}
                disabled={busy}
                onChange={(e) =>
                  ai.setUsageRange(
                    state.usageSinceMs,
                    Number.parseInt(e.target.value, 10) || 0,
                  )
                }
                data-testid="ai-usage-until"
              />
            </label>
          </div>
          <div className="dialog__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => void ai.loadUsage(0)}
              data-testid="ai-usage-query"
            >
              Query
            </button>
          </div>
          {state.usage ? (
            <>
              <div className="p4-toolbar">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={busy || state.usageOffset <= 0}
                  onClick={() =>
                    void ai.loadUsage(
                      Math.max(0, state.usageOffset - PAGE_SIZE),
                    )
                  }
                  data-testid="ai-usage-prev"
                >
                  Prev
                </button>
                <span className="status" data-testid="ai-usage-page">
                  {state.usage.offset}/{state.usage.total}
                </span>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={
                    busy ||
                    state.usage.offset + state.usage.records.length >=
                      state.usage.total
                  }
                  onClick={() =>
                    void ai.loadUsage(state.usageOffset + PAGE_SIZE)
                  }
                  data-testid="ai-usage-next"
                >
                  Next
                </button>
              </div>
              <pre className="p4-pre" data-testid="ai-usage-aggregates">
                {JSON.stringify(state.usage.aggregates, null, 2)}
              </pre>
              <table className="p4-table" data-testid="ai-usage-result">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Model</th>
                    <th>Status</th>
                    <th>Tokens</th>
                    <th>Elapsed</th>
                  </tr>
                </thead>
                <tbody>
                  {state.usage.records.map((r) => (
                    <tr key={r.id}>
                      <td className="p4-wrap">{r.id}</td>
                      <td className="p4-wrap">{r.model}</td>
                      <td>{r.status}</td>
                      <td className="p4-wrap">
                        in={r.usage.inputTokens ?? 0} out=
                        {r.usage.outputTokens ?? 0}
                      </td>
                      <td>{r.elapsedMs}</td>
                    </tr>
                  ))}
                  {state.usage.records.length === 0 ? (
                    <TableEmpty colSpan={5} />
                  ) : null}
                </tbody>
              </table>
            </>
          ) : (
            <p className="status">Empty</p>
          )}
        </div>
      ) : null}

      {section === "quality" ? (
        <div className="p4-panel" data-testid="ai-quality">
          <div className="dialog__actions">
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy}
              onClick={() => void ai.runQualityScore()}
              data-testid="ai-quality-score"
            >
              Score
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy}
              onClick={() => void ai.runSemanticQa()}
              data-testid="ai-quality-semantic"
            >
              Semantic QA
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy}
              onClick={() => void ai.runExtractTerms()}
              data-testid="ai-quality-terms"
            >
              Terms
            </button>
          </div>
          {state.qualityScore ? (
            <pre className="p4-pre" data-testid="ai-quality-score-result">
              {JSON.stringify(state.qualityScore, null, 2)}
            </pre>
          ) : null}
          {state.qualitySemantic ? (
            <pre className="p4-pre" data-testid="ai-quality-semantic-result">
              {JSON.stringify(state.qualitySemantic, null, 2)}
            </pre>
          ) : null}
          {state.qualityTerms ? (
            <pre className="p4-pre" data-testid="ai-quality-terms-result">
              {JSON.stringify(state.qualityTerms, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
      {destructive.dialog}
    </section>
  );
}
