import { useEffect, useMemo, useState } from "react";
import type {
  AiBatchItem,
  AiBatchRun,
  AiProviderDescriptor,
  AiProviderKind,
  AiProviderProfile,
  AiRun,
  AiSettings,
  AiUsageAggregate,
  Document,
  GroundingOptions,
  ProjectSnapshot,
} from "@translunar/contracts";
import {
  Activity,
  Bot,
  CircleStop,
  KeyRound,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";

import { formatError } from "./workbench-utils";

interface AiControlPageProps {
  snapshot: ProjectSnapshot;
  document: Document;
}

type AiControlTab = "providers" | "batch" | "usage";

const DEFAULT_GROUNDING: GroundingOptions = {
  includeTerms: true,
  includeTm: true,
  includeContext: true,
  includeStyle: true,
  tmTopN: 5,
  contextBefore: 2,
  contextAfter: 2,
  maxChars: 24_000,
  systemInstruction: "",
  styleInstruction: "",
};

export function AiControlPage({ snapshot, document }: AiControlPageProps) {
  const [tab, setTab] = useState<AiControlTab>("providers");
  const [catalog, setCatalog] = useState<AiProviderDescriptor[]>([]);
  const [profiles, setProfiles] = useState<AiProviderProfile[]>([]);
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [usage, setUsage] = useState<AiUsageAggregate[]>([]);
  const [batches, setBatches] = useState<AiBatchRun[]>([]);
  const [batchItems, setBatchItems] = useState<AiBatchItem[]>([]);
  const [activeBatch, setActiveBatch] = useState<AiBatchRun | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createKind, setCreateKind] = useState<AiProviderKind>("openai");
  const [createName, setCreateName] = useState("OpenAI");
  const [createUrl, setCreateUrl] = useState("https://api.openai.com/v1");
  const [createModel, setCreateModel] = useState("gpt-4.1-mini");
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [budget, setBudget] = useState("");
  const [origins, setOrigins] = useState("");
  const [editingProfile, setEditingProfile] =
    useState<AiProviderProfile | null>(null);
  const [batchProfileId, setBatchProfileId] = useState("");
  const [tmThreshold, setTmThreshold] = useState(85);
  const [concurrency, setConcurrency] = useState(3);
  const [requestsPerMinute, setRequestsPerMinute] = useState(60);
  const [replaceDrafts, setReplaceDrafts] = useState(false);

  const selectedDescriptor = useMemo(
    () => catalog.find((item) => item.kind === createKind),
    [catalog, createKind],
  );

  const load = async () => {
    setError(null);
    const [catalogResult, providerResult, settingResult, batchResult] =
      await Promise.all([
        window.translunar.invoke("ai.provider.catalog", {}),
        window.translunar.invoke("ai.provider.list", { offset: 0, limit: 100 }),
        window.translunar.invoke("ai.settings.get", {}),
        window.translunar.invoke("ai.batch.list", {
          projectId: snapshot.project.id,
          offset: 0,
          limit: 50,
        }),
      ]);
    setCatalog(catalogResult.items);
    setProfiles(providerResult.items);
    setSettings(settingResult);
    setBudget(
      settingResult.monthlyTokenBudget === null ||
        settingResult.monthlyTokenBudget === undefined
        ? ""
        : String(settingResult.monthlyTokenBudget),
    );
    setOrigins(settingResult.allowedOrigins.join(", "));
    setBatches(batchResult.items);
    setBatchProfileId((current) =>
      providerResult.items.some((item) => item.id === current)
        ? current
        : (settingResult.defaultProfileId ?? providerResult.items[0]?.id ?? ""),
    );
    setActiveBatch(
      batchResult.items.find((item) => !isBatchTerminal(item.status)) ??
        batchResult.items[0] ??
        null,
    );
  };

  const loadUsage = async () => {
    const now = Date.now();
    const result = await window.translunar.invoke("ai.usage.query", {
      projectId: snapshot.project.id,
      sinceMs: startOfMonth(now),
      untilMs: now,
      dimension: "provider",
      offset: 0,
      limit: 200,
    });
    setUsage(result.aggregates);
  };

  useEffect(() => {
    let cancelled = false;
    void load()
      .then(() => loadUsage())
      .catch((reason: unknown) => {
        if (!cancelled) setError(formatError(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [snapshot.project.id]);

  useEffect(() => {
    if (!activeBatch) {
      setBatchItems([]);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const [batch, items] = await Promise.all([
          window.translunar.invoke("ai.batch.get", {
            batchId: activeBatch.id,
          }),
          window.translunar.invoke("ai.batch.items", {
            batchId: activeBatch.id,
            offset: 0,
            limit: 200,
          }),
        ]);
        if (cancelled) return;
        setActiveBatch(batch);
        setBatchItems(items.items);
        setBatches((current) =>
          current.map((item) => (item.id === batch.id ? batch : item)),
        );
      } catch (reason) {
        if (!cancelled) setError(formatError(reason));
      }
    };
    void refresh();
    if (isBatchTerminal(activeBatch.status)) {
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setInterval(() => void refresh(), 700);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeBatch?.id, activeBatch?.status]);

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setBusy(null);
    }
  };

  const chooseKind = (kind: AiProviderKind) => {
    setCreateKind(kind);
    const descriptor = catalog.find((item) => item.kind === kind);
    if (!descriptor) return;
    setCreateName(descriptor.displayName);
    setCreateUrl(descriptor.defaultBaseUrl);
    setCreateModel(descriptor.defaultModel);
  };

  const createProvider = () =>
    runAction("create", async () => {
      const profile = await window.translunar.invoke("ai.provider.create", {
        name: createName,
        kind: createKind,
        baseUrl: createUrl,
        model: createModel,
        timeoutMs: 60_000,
        maxResponseBytes: 4_194_304,
        enabled: true,
      });
      setProfiles((current) => [...current, profile]);
      setBatchProfileId((current) => current || profile.id);
      setNotice(`${profile.name} profile created.`);
    });

  const saveCredential = (profile: AiProviderProfile) =>
    runAction(`credential:${profile.id}`, async () => {
      const secret = credentials[profile.id]?.trim() ?? "";
      if (!secret) throw new Error("Enter a credential first.");
      await window.translunar.setAiCredential(profile.id, secret);
      setCredentials((current) => ({ ...current, [profile.id]: "" }));
      const page = await window.translunar.invoke("ai.provider.list", {
        offset: 0,
        limit: 100,
      });
      setProfiles(page.items);
      setNotice(`Credential saved to the operating-system keyring.`);
    });

  const testProvider = (profile: AiProviderProfile) =>
    runAction(`test:${profile.id}`, async () => {
      const result = await window.translunar.invoke("ai.provider.test", {
        profileId: profile.id,
      });
      const terminal = await waitForRun(result.run);
      if (terminal.status !== "succeeded") {
        throw new Error(terminal.errorMessage ?? "Provider test failed.");
      }
      setNotice(`${profile.name} connection succeeded.`);
    });

  const removeProvider = (profile: AiProviderProfile) =>
    runAction(`delete:${profile.id}`, async () => {
      await window.translunar.invoke("ai.provider.delete", {
        profileId: profile.id,
        expectedRevision: profile.revision,
      });
      const refreshedSettings = await window.translunar.invoke(
        "ai.settings.get",
        {},
      );
      setProfiles((current) =>
        current.filter((item) => item.id !== profile.id),
      );
      setSettings(refreshedSettings);
      setBatchProfileId((current) => (current === profile.id ? "" : current));
      setNotice(`${profile.name} removed.`);
    });

  const removeCredential = (profile: AiProviderProfile) =>
    runAction(`credential-delete:${profile.id}`, async () => {
      await window.translunar.invoke("ai.credential.delete", {
        profileId: profile.id,
      });
      setProfiles((current) =>
        current.map((item) =>
          item.id === profile.id ? { ...item, credentialPresent: false } : item,
        ),
      );
      setNotice(`Credential removed from the operating-system keyring.`);
    });

  const saveProviderUpdate = () =>
    runAction("provider-update", async () => {
      if (!editingProfile) return;
      const updated = await window.translunar.invoke("ai.provider.update", {
        profileId: editingProfile.id,
        name: editingProfile.name,
        kind: editingProfile.kind,
        baseUrl: editingProfile.baseUrl,
        model: editingProfile.model,
        timeoutMs: editingProfile.timeoutMs,
        maxResponseBytes: editingProfile.maxResponseBytes,
        enabled: editingProfile.enabled,
        expectedRevision: editingProfile.revision,
      });
      setProfiles((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setEditingProfile(null);
      setNotice(`${updated.name} profile updated.`);
    });

  const saveSettings = () =>
    runAction("settings", async () => {
      if (!settings) return;
      const parsedBudget = budget.trim() ? Number(budget) : null;
      if (
        parsedBudget !== null &&
        (!Number.isSafeInteger(parsedBudget) || parsedBudget < 1)
      ) {
        throw new Error(
          "Monthly token budget must be a positive whole number.",
        );
      }
      const updated = await window.translunar.invoke("ai.settings.update", {
        enabled: settings.enabled,
        defaultProfileId: settings.defaultProfileId ?? null,
        monthlyTokenBudget: parsedBudget,
        allowInteractive: settings.allowInteractive,
        allowBatch: settings.allowBatch,
        allowedOrigins: origins
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        expectedRevision: settings.revision,
      });
      setSettings(updated);
      setNotice("AI workspace policy saved.");
    });

  const startBatch = () =>
    runAction("batch:start", async () => {
      if (!batchProfileId) throw new Error("Choose a provider profile.");
      const batch = await window.translunar.invoke("ai.batch.start", {
        projectId: snapshot.project.id,
        documentId: document.id,
        profileId: batchProfileId,
        tmThreshold,
        concurrency,
        requestsPerMinute,
        maxAttempts: 3,
        replaceDrafts,
        options: DEFAULT_GROUNDING,
      });
      setBatches((current) => [batch, ...current]);
      setActiveBatch(batch);
      setNotice("Batch pretranslation started.");
    });

  const changeBatchState = (action: "cancel" | "resume") =>
    runAction(`batch:${action}`, async () => {
      if (!activeBatch) return;
      const batch = await window.translunar.invoke(
        action === "cancel" ? "ai.batch.cancel" : "ai.batch.resume",
        { batchId: activeBatch.id, expectedRevision: activeBatch.revision },
      );
      setActiveBatch(batch);
    });

  return (
    <main className="surface-main ai-control-surface">
      <section className="ai-policy-band" aria-labelledby="ai-policy-title">
        <div>
          <span className="surface-kicker">Workspace policy</span>
          <h1 id="ai-policy-title">AI control</h1>
          <p>
            Credentials stay in the operating-system keyring. Grounding, runs,
            usage, and target writes remain Engine-owned.
          </p>
        </div>
        {settings ? (
          <div className="ai-policy-controls">
            <label className="switch-control">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    enabled: event.currentTarget.checked,
                  })
                }
              />
              <span>AI enabled</span>
            </label>
            <label className="switch-control">
              <input
                type="checkbox"
                checked={settings.allowInteractive}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    allowInteractive: event.currentTarget.checked,
                  })
                }
              />
              <span>Interactive runs</span>
            </label>
            <label className="switch-control">
              <input
                type="checkbox"
                checked={settings.allowBatch}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    allowBatch: event.currentTarget.checked,
                  })
                }
              />
              <span>Batch runs</span>
            </label>
            <label>
              Default profile
              <select
                value={settings.defaultProfileId ?? ""}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    defaultProfileId: event.currentTarget.value || null,
                  })
                }
              >
                <option value="">None</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Monthly token budget
              <input
                inputMode="numeric"
                value={budget}
                placeholder="Unlimited"
                onChange={(event) => setBudget(event.currentTarget.value)}
              />
            </label>
            <label className="ai-origins-field">
              Allowed origins
              <input
                value={origins}
                placeholder="Empty allows validated profile origins"
                spellCheck={false}
                onChange={(event) => setOrigins(event.currentTarget.value)}
              />
            </label>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void saveSettings()}
            >
              <ShieldCheck size={15} /> Save policy
            </button>
          </div>
        ) : null}
      </section>

      <div
        className="ai-control-tabs"
        role="tablist"
        aria-label="AI control views"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "providers"}
          onClick={() => setTab("providers")}
        >
          <Bot size={14} /> Providers
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "batch"}
          onClick={() => setTab("batch")}
        >
          <Activity size={14} /> Batch
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "usage"}
          onClick={() => {
            setTab("usage");
            void loadUsage();
          }}
        >
          <RefreshCw size={14} /> Usage
        </button>
      </div>

      {error ? (
        <div className="surface-error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="surface-notice" role="status">
          {notice}
        </div>
      ) : null}

      {tab === "providers" ? (
        <div className="ai-provider-layout">
          <section
            className="ai-create-provider"
            aria-labelledby="create-provider-title"
          >
            <div className="section-heading">
              <div>
                <span>Connector catalog</span>
                <h2 id="create-provider-title">Add provider</h2>
              </div>
              <strong>{catalog.length} kinds</strong>
            </div>
            <div className="ai-provider-form">
              <label>
                Connector
                <select
                  value={createKind}
                  onChange={(event) =>
                    chooseKind(event.currentTarget.value as AiProviderKind)
                  }
                >
                  {catalog.map((item) => (
                    <option key={item.kind} value={item.kind}>
                      {item.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Profile name
                <input
                  value={createName}
                  onChange={(event) => setCreateName(event.currentTarget.value)}
                />
              </label>
              <label>
                Base URL
                <input
                  value={createUrl}
                  spellCheck={false}
                  onChange={(event) => setCreateUrl(event.currentTarget.value)}
                />
              </label>
              <label>
                Model
                <input
                  value={createModel}
                  spellCheck={false}
                  onChange={(event) =>
                    setCreateModel(event.currentTarget.value)
                  }
                />
              </label>
              <p>
                <ShieldCheck size={14} />{" "}
                {selectedDescriptor?.credentialHint ?? "Provider credential"}
              </p>
              <button
                type="button"
                disabled={
                  busy !== null ||
                  !createName.trim() ||
                  !createUrl.trim() ||
                  !createModel.trim()
                }
                onClick={() => void createProvider()}
              >
                <Plus size={15} /> Add provider
              </button>
            </div>
          </section>

          <section className="ai-profile-list" aria-labelledby="profiles-title">
            <div className="section-heading">
              <div>
                <span>Configured</span>
                <h2 id="profiles-title">Provider profiles</h2>
              </div>
              <strong>{profiles.length}</strong>
            </div>
            {profiles.length ? (
              profiles.map((profile) => (
                <div className="ai-profile-block" key={profile.id}>
                  <article className="ai-profile-row" key={profile.id}>
                    <div className="ai-profile-identity">
                      <span className="provider-glyph">
                        {profile.name.slice(0, 2).toUpperCase()}
                      </span>
                      <div>
                        <strong>{profile.name}</strong>
                        <small>
                          {profile.kind} · {profile.model}
                        </small>
                      </div>
                    </div>
                    <div
                      className="ai-profile-endpoint"
                      title={profile.baseUrl}
                    >
                      {profile.baseUrl}
                    </div>
                    <span
                      className={
                        profile.credentialPresent
                          ? "credential-state ready"
                          : "credential-state"
                      }
                    >
                      <KeyRound size={13} />
                      {profile.credentialPresent ? "Stored" : "Missing"}
                    </span>
                    <div className="ai-credential-entry">
                      <input
                        type="password"
                        autoComplete="new-password"
                        aria-label={`Credential for ${profile.name}`}
                        placeholder="Write-only credential"
                        value={credentials[profile.id] ?? ""}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setCredentials((current) => ({
                            ...current,
                            [profile.id]: value,
                          }));
                        }}
                      />
                      <button
                        type="button"
                        disabled={
                          busy !== null || !credentials[profile.id]?.trim()
                        }
                        onClick={() => void saveCredential(profile)}
                      >
                        Store
                      </button>
                    </div>
                    <div className="ai-profile-actions">
                      <button
                        type="button"
                        title="Test connection"
                        aria-label={`Test ${profile.name}`}
                        disabled={busy !== null || !profile.credentialPresent}
                        onClick={() => void testProvider(profile)}
                      >
                        <Play size={14} />
                      </button>
                      <button
                        type="button"
                        title="Edit profile"
                        aria-label={`Edit ${profile.name}`}
                        disabled={busy !== null}
                        onClick={() => setEditingProfile({ ...profile })}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        title="Delete credential"
                        aria-label={`Delete credential for ${profile.name}`}
                        disabled={busy !== null || !profile.credentialPresent}
                        onClick={() => void removeCredential(profile)}
                      >
                        <KeyRound size={14} />
                      </button>
                      <button
                        type="button"
                        title="Delete profile"
                        aria-label={`Delete ${profile.name}`}
                        disabled={busy !== null}
                        onClick={() => void removeProvider(profile)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </article>
                  {editingProfile?.id === profile.id ? (
                    <div
                      className="ai-profile-edit"
                      aria-label={`Edit ${profile.name}`}
                    >
                      <label>
                        Name
                        <input
                          value={editingProfile.name}
                          onChange={(event) =>
                            setEditingProfile({
                              ...editingProfile,
                              name: event.currentTarget.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Base URL
                        <input
                          value={editingProfile.baseUrl}
                          spellCheck={false}
                          onChange={(event) =>
                            setEditingProfile({
                              ...editingProfile,
                              baseUrl: event.currentTarget.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Model
                        <input
                          value={editingProfile.model}
                          spellCheck={false}
                          onChange={(event) =>
                            setEditingProfile({
                              ...editingProfile,
                              model: event.currentTarget.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Timeout (ms)
                        <input
                          type="number"
                          value={editingProfile.timeoutMs}
                          onChange={(event) =>
                            setEditingProfile({
                              ...editingProfile,
                              timeoutMs: Number(event.currentTarget.value),
                            })
                          }
                        />
                      </label>
                      <label className="switch-control">
                        <input
                          type="checkbox"
                          checked={editingProfile.enabled}
                          onChange={(event) =>
                            setEditingProfile({
                              ...editingProfile,
                              enabled: event.currentTarget.checked,
                            })
                          }
                        />
                        <span>Profile enabled</span>
                      </label>
                      <div>
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void saveProviderUpdate()}
                        >
                          <ShieldCheck size={13} /> Save
                        </button>
                        <button
                          type="button"
                          title="Cancel edit"
                          aria-label="Cancel profile edit"
                          onClick={() => setEditingProfile(null)}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="surface-empty">
                <Bot size={22} />
                <strong>No provider profiles</strong>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {tab === "batch" ? (
        <div className="ai-batch-layout">
          <section className="ai-batch-config">
            <div className="section-heading">
              <div>
                <span>TM-first</span>
                <h2>Pretranslate document</h2>
              </div>
            </div>
            <div className="ai-batch-form">
              <label>
                Provider
                <select
                  value={batchProfileId}
                  onChange={(event) =>
                    setBatchProfileId(event.currentTarget.value)
                  }
                >
                  <option value="">Choose profile</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                TM threshold
                <input
                  type="number"
                  min={0}
                  max={101}
                  value={tmThreshold}
                  onChange={(event) =>
                    setTmThreshold(Number(event.currentTarget.value))
                  }
                />
              </label>
              <label>
                Concurrency
                <input
                  type="number"
                  min={1}
                  max={16}
                  value={concurrency}
                  onChange={(event) =>
                    setConcurrency(Number(event.currentTarget.value))
                  }
                />
              </label>
              <label>
                Requests / minute
                <input
                  type="number"
                  min={1}
                  max={600}
                  value={requestsPerMinute}
                  onChange={(event) =>
                    setRequestsPerMinute(Number(event.currentTarget.value))
                  }
                />
              </label>
              <label className="switch-control">
                <input
                  type="checkbox"
                  checked={replaceDrafts}
                  onChange={(event) =>
                    setReplaceDrafts(event.currentTarget.checked)
                  }
                />
                <span>Replace existing drafts</span>
              </label>
              <button
                type="button"
                disabled={busy !== null || !batchProfileId}
                onClick={() => void startBatch()}
              >
                <Play size={15} /> Start batch
              </button>
            </div>
          </section>
          <section className="ai-batch-progress">
            <div className="section-heading">
              <div>
                <span>Durable queue</span>
                <h2>Batch runs</h2>
              </div>
              {activeBatch ? (
                <select
                  aria-label="Selected batch"
                  value={activeBatch.id}
                  onChange={(event) =>
                    setActiveBatch(
                      batches.find(
                        (item) => item.id === event.currentTarget.value,
                      ) ?? null,
                    )
                  }
                >
                  {batches.map((batch) => (
                    <option key={batch.id} value={batch.id}>
                      {batch.id.slice(0, 8)} · {batch.status}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
            {activeBatch ? (
              <>
                <div className="batch-meter">
                  <div>
                    <strong>
                      {activeBatch.completed}/{activeBatch.total}
                    </strong>
                    <span>{activeBatch.status}</span>
                  </div>
                  <progress
                    max={Math.max(activeBatch.total, 1)}
                    value={activeBatch.completed}
                  />
                </div>
                <div className="batch-stat-grid">
                  <span>
                    <strong>{activeBatch.tmApplied}</strong>TM
                  </span>
                  <span>
                    <strong>{activeBatch.succeeded}</strong>AI
                  </span>
                  <span>
                    <strong>{activeBatch.skipped}</strong>Skipped
                  </span>
                  <span>
                    <strong>{activeBatch.failed}</strong>Failed
                  </span>
                </div>
                <div className="batch-actions">
                  {!isBatchTerminal(activeBatch.status) ? (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void changeBatchState("cancel")}
                    >
                      <CircleStop size={14} /> Cancel
                    </button>
                  ) : activeBatch.status === "interrupted" ||
                    activeBatch.status === "failed" ||
                    activeBatch.status === "canceled" ? (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void changeBatchState("resume")}
                    >
                      <RotateCcw size={14} /> Resume
                    </button>
                  ) : null}
                </div>
                <div className="batch-item-list" aria-label="Batch items">
                  {batchItems.map((item) => (
                    <div key={item.segmentId}>
                      <strong>#{item.ordinal + 1}</strong>
                      <span>{item.source ?? "pending"}</span>
                      <em data-status={item.status}>{item.status}</em>
                      {item.errorCode ? <small>{item.errorCode}</small> : null}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="surface-empty">
                <Activity size={22} />
                <strong>No batch runs</strong>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {tab === "usage" ? (
        <section className="ai-usage-section">
          <div className="section-heading">
            <div>
              <span>Current month</span>
              <h2>Authoritative usage</h2>
            </div>
            <button
              type="button"
              aria-label="Refresh usage"
              title="Refresh usage"
              onClick={() => void runAction("usage", loadUsage)}
            >
              <RefreshCw size={14} />
            </button>
          </div>
          {usage.length ? (
            <div className="usage-table" role="table">
              <div role="row" className="usage-head">
                <span>Provider</span>
                <span>Requests</span>
                <span>Input</span>
                <span>Cache read</span>
                <span>Thinking</span>
                <span>Output</span>
                <span>Elapsed</span>
              </div>
              {usage.map((item) => (
                <div role="row" key={item.key}>
                  <strong>{item.key}</strong>
                  <span>{item.requestCount.toLocaleString()}</span>
                  <span>{item.inputTokens.toLocaleString()}</span>
                  <span>{item.cacheReadTokens.toLocaleString()}</span>
                  <span>{item.reasoningTokens.toLocaleString()}</span>
                  <span>{item.outputTokens.toLocaleString()}</span>
                  <span>{formatDuration(item.elapsedMs)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="surface-empty">
              <Activity size={22} />
              <strong>No AI usage this month</strong>
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}

async function waitForRun(initial: AiRun): Promise<AiRun> {
  let run = initial;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (isRunTerminal(run.status)) return run;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
    run = await window.translunar.invoke("ai.run.get", { runId: run.id });
  }
  throw new Error("Provider test did not finish within 30 seconds.");
}

function isRunTerminal(status: AiRun["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "canceled";
}

function isBatchTerminal(status: AiBatchRun["status"]): boolean {
  return (
    status === "succeeded" ||
    status === "completedWithErrors" ||
    status === "failed" ||
    status === "canceled"
  );
}

function startOfMonth(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  return `${(milliseconds / 1_000).toFixed(1)} s`;
}
