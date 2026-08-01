import { useEffect, useMemo, useState } from "react";
import type {
  AiBatchItem,
  AiBatchRun,
  AiConnectorCatalogItem,
  AiProviderProfile,
  AiRun,
  AiSettings,
  AiUsageAggregate,
  Document,
  EngineConnectorConfigFieldV1,
  EngineConnectorSource,
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

import { formatEngineError } from "./workbench-utils";
import { useLocale } from "./i18n/LocaleProvider";

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
  const { t } = useLocale();

  const [tab, setTab] = useState<AiControlTab>("providers");
  const [catalog, setCatalog] = useState<AiConnectorCatalogItem[]>([]);
  const [profiles, setProfiles] = useState<AiProviderProfile[]>([]);
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [usage, setUsage] = useState<AiUsageAggregate[]>([]);
  const [batches, setBatches] = useState<AiBatchRun[]>([]);
  const [batchItems, setBatchItems] = useState<AiBatchItem[]>([]);
  const [activeBatch, setActiveBatch] = useState<AiBatchRun | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createConnectorId, setCreateConnectorId] = useState("openai");
  const [createName, setCreateName] = useState("OpenAI");
  const [createUrl, setCreateUrl] = useState("https://api.openai.com/v1");
  const [createModel, setCreateModel] = useState("gpt-4.1-mini");
  const [createConfiguration, setCreateConfiguration] =
    useState<ConnectorConfiguration>({});
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
    () => catalog.find((item) => item.id === createConnectorId),
    [catalog, createConnectorId],
  );
  const connectorAvailabilityLabel = (
    availability: AiConnectorCatalogItem["availability"],
  ) =>
    availability === "available"
      ? t("ai.connectorAvailable")
      : availability === "degraded"
        ? t("ai.connectorDegraded")
        : t("ai.connectorUnavailable");

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
    setCreateConnectorId((current) => {
      const selected = catalogResult.items.find((item) => item.id === current);
      const next =
        selected ??
        catalogResult.items.find((item) => item.availability === "available") ??
        catalogResult.items[0];
      if (next && !selected) {
        setCreateName(next.displayName);
        setCreateUrl(next.defaultBaseUrl);
        setCreateModel(next.defaultModel);
        setCreateConfiguration(defaultConnectorConfiguration(next));
      }
      return next?.id ?? current;
    });
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
        if (!cancelled) setError(formatEngineError(reason, t));
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
        if (!cancelled) setError(formatEngineError(reason, t));
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
      setError(formatEngineError(reason, t));
    } finally {
      setBusy(null);
    }
  };

  const chooseConnector = (connectorId: string) => {
    setCreateConnectorId(connectorId);
    const descriptor = catalog.find((item) => item.id === connectorId);
    if (!descriptor) return;
    setCreateName(descriptor.displayName);
    setCreateUrl(descriptor.defaultBaseUrl);
    setCreateModel(descriptor.defaultModel);
    setCreateConfiguration(defaultConnectorConfiguration(descriptor));
  };

  const updateCreateConfiguration = (
    key: string,
    value: string | number | boolean,
  ) => {
    setCreateConfiguration((current) => ({ ...current, [key]: value }));
  };

  const createProvider = () =>
    runAction("create", async () => {
      if (!selectedDescriptor) throw new Error(t("ai.chooseConnector"));
      const profile = await window.translunar.invoke("ai.provider.create", {
        name: createName,
        ...(selectedDescriptor.kind === undefined
          ? {}
          : { kind: selectedDescriptor.kind }),
        source: selectedDescriptor.source,
        baseUrl: createUrl,
        model: createModel,
        timeoutMs: 60_000,
        maxResponseBytes: 4_194_304,
        enabled: true,
        ...(selectedDescriptor.source.kind === "plugin"
          ? {
              configSchemaVersion: selectedDescriptor.configSchemaVersion,
              configuration: createConfiguration,
            }
          : {}),
      });
      setProfiles((current) => [...current, profile]);
      setBatchProfileId((current) => current || profile.id);
      setNotice(t("ai.profileCreated", { name: profile.name }));
    });

  const saveCredential = (profile: AiProviderProfile) =>
    runAction(`credential:${profile.id}`, async () => {
      const secret = credentials[profile.id]?.trim() ?? "";
      if (!secret) throw new Error(t("ai.enterCredential"));
      await window.translunar.setAiCredential(profile.id, secret);
      setCredentials((current) => ({ ...current, [profile.id]: "" }));
      const page = await window.translunar.invoke("ai.provider.list", {
        offset: 0,
        limit: 100,
      });
      setProfiles(page.items);
      setNotice(t("ai.credentialSaved"));
    });

  const testProvider = (profile: AiProviderProfile) =>
    runAction(`test:${profile.id}`, async () => {
      const result = await window.translunar.invoke("ai.provider.test", {
        profileId: profile.id,
      });
      const terminal = await waitForRun(result.run, t("ai.testTimeout"));
      if (terminal.status !== "succeeded") {
        throw new Error(terminal.errorMessage ?? t("ai.providerTestFailed"));
      }
      setNotice(t("ai.connectionSucceeded", { name: profile.name }));
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
      setNotice(t("ai.profileRemoved", { name: profile.name }));
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
      setNotice(t("ai.credentialRemoved"));
    });

  const saveProviderUpdate = () =>
    runAction("provider-update", async () => {
      if (!editingProfile) return;
      const updated = await window.translunar.invoke("ai.provider.update", {
        profileId: editingProfile.id,
        name: editingProfile.name,
        ...(editingProfile.kind === undefined
          ? {}
          : { kind: editingProfile.kind }),
        source: editingProfile.source,
        baseUrl: editingProfile.baseUrl,
        model: editingProfile.model,
        timeoutMs: editingProfile.timeoutMs,
        maxResponseBytes: editingProfile.maxResponseBytes,
        enabled: editingProfile.enabled,
        ...(editingProfile.source.kind === "plugin"
          ? {
              configSchemaVersion: editingProfile.configSchemaVersion,
              configuration: editingProfile.configuration,
            }
          : {}),
        expectedRevision: editingProfile.revision,
      });
      setProfiles((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setEditingProfile(null);
      setNotice(t("ai.profileUpdated", { name: updated.name }));
    });

  const saveSettings = () =>
    runAction("settings", async () => {
      if (!settings) return;
      const parsedBudget = budget.trim() ? Number(budget) : null;
      if (
        parsedBudget !== null &&
        (!Number.isSafeInteger(parsedBudget) || parsedBudget < 1)
      ) {
        throw new Error(t("ai.budgetInvalid"));
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
      setNotice(t("ai.policySaved"));
    });

  const startBatch = () =>
    runAction("batch:start", async () => {
      if (!batchProfileId) throw new Error(t("ai.chooseProviderProfile"));
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
      setNotice(t("ai.batchStarted"));
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
          <span className="surface-kicker">{t("ai.kicker")}</span>
          <h1 id="ai-policy-title">{t("ai.title")}</h1>
          <p>{t("ai.description")}</p>
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
              <span>{t("ai.enabled")}</span>
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
              <span>{t("ai.interactiveRuns")}</span>
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
              <span>{t("ai.batchRuns")}</span>
            </label>
            <label>
              {t("ai.defaultProfile")}
              <select
                value={settings.defaultProfileId ?? ""}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    defaultProfileId: event.currentTarget.value || null,
                  })
                }
              >
                <option value="">{t("common.none")}</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("ai.monthlyBudget")}
              <input
                inputMode="numeric"
                value={budget}
                placeholder={t("ai.budgetPlaceholder")}
                onChange={(event) => setBudget(event.currentTarget.value)}
              />
            </label>
            <label className="ai-origins-field">
              {t("ai.allowedOrigins")}
              <input
                value={origins}
                placeholder={t("ai.originsPlaceholder")}
                spellCheck={false}
                onChange={(event) => setOrigins(event.currentTarget.value)}
              />
            </label>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void saveSettings()}
            >
              <ShieldCheck size={15} /> {t("ai.savePolicy")}
            </button>
          </div>
        ) : null}
      </section>

      <div
        className="ai-control-tabs"
        role="tablist"
        aria-label={t("ai.viewsAria")}
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "providers"}
          onClick={() => setTab("providers")}
        >
          <Bot size={14} /> {t("ai.providersTab")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "batch"}
          onClick={() => setTab("batch")}
        >
          <Activity size={14} /> {t("ai.batchTab")}
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
          <RefreshCw size={14} /> {t("ai.usageTab")}
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
                <span>{t("ai.connectorCatalog")}</span>
                <h2 id="create-provider-title">{t("ai.addProvider")}</h2>
              </div>
              <strong>{catalog.length} kinds</strong>
            </div>
            <div className="ai-provider-form">
              <label>
                {t("ai.connector")}
                <select
                  value={createConnectorId}
                  onChange={(event) =>
                    chooseConnector(event.currentTarget.value)
                  }
                >
                  {catalog.map((item) => (
                    <option
                      key={item.id}
                      value={item.id}
                      disabled={item.availability !== "available"}
                    >
                      {item.displayName}
                      {` · ${
                        item.source.kind === "plugin"
                          ? `${t("ai.connectorPlugin")} · ${item.source.owner.pluginId}`
                          : t("ai.connectorBuiltin")
                      }`}
                    </option>
                  ))}
                </select>
              </label>
              {selectedDescriptor ? (
                <>
                  <div className="ai-connector-meta">
                    <span className="ai-connector-kind">
                      {selectedDescriptor.source.kind === "plugin"
                        ? t("ai.connectorPlugin")
                        : t("ai.connectorBuiltin")}
                    </span>
                    <span data-availability={selectedDescriptor.availability}>
                      {connectorAvailabilityLabel(
                        selectedDescriptor.availability,
                      )}
                    </span>
                    <code
                      title={connectorSourceLabel(selectedDescriptor.source)}
                    >
                      {connectorSourceLabel(selectedDescriptor.source)}
                    </code>
                    <small>
                      {t("ai.connectorSchemaVersion", {
                        version: selectedDescriptor.configSchemaVersion,
                      })}
                    </small>
                  </div>
                  {selectedDescriptor.safeFailure ? (
                    <p className="ai-connector-failure" role="status">
                      {selectedDescriptor.safeFailure}
                    </p>
                  ) : null}
                </>
              ) : null}
              <label>
                {t("ai.profileName")}
                <input
                  value={createName}
                  onChange={(event) => setCreateName(event.currentTarget.value)}
                />
              </label>
              <label>
                {t("ai.baseUrl")}
                <input
                  value={createUrl}
                  spellCheck={false}
                  onChange={(event) => setCreateUrl(event.currentTarget.value)}
                />
              </label>
              <label>
                {t("common.model")}
                <input
                  value={createModel}
                  spellCheck={false}
                  onChange={(event) =>
                    setCreateModel(event.currentTarget.value)
                  }
                />
              </label>
              {selectedDescriptor?.configSchema?.fields.map((field) => (
                <ConnectorConfigField
                  key={field.key}
                  field={field}
                  value={createConfiguration[field.key]}
                  onChange={(value) =>
                    updateCreateConfiguration(field.key, value)
                  }
                />
              ))}
              <p>
                <ShieldCheck size={14} />{" "}
                {selectedDescriptor?.credentialHint ??
                  t("ai.providerCredentialDefault")}
              </p>
              <button
                type="button"
                disabled={
                  busy !== null ||
                  !createName.trim() ||
                  (!createUrl.trim() &&
                    selectedDescriptor?.source.kind === "builtin") ||
                  !createModel.trim() ||
                  selectedDescriptor?.availability !== "available" ||
                  !connectorConfigurationComplete(
                    selectedDescriptor,
                    createConfiguration,
                  )
                }
                onClick={() => void createProvider()}
              >
                <Plus size={15} />
                {t("ai.addProvider")}
              </button>
            </div>
          </section>

          <section className="ai-profile-list" aria-labelledby="profiles-title">
            <div className="section-heading">
              <div>
                <span>{t("ai.configured")}</span>
                <h2 id="profiles-title">{t("ai.providerProfiles")}</h2>
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
                        <small title={connectorSourceLabel(profile.source)}>
                          {profile.source.kind === "plugin"
                            ? t("ai.connectorPlugin")
                            : t("ai.connectorBuiltin")}{" "}
                          · {connectorSourceLabel(profile.source)} ·{" "}
                          {profile.model}
                        </small>
                        <span
                          className="ai-connector-availability"
                          data-availability={profile.availability}
                        >
                          {connectorAvailabilityLabel(profile.availability)}
                        </span>
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
                      {profile.credentialPresent
                        ? t("ai.credentialStored")
                        : t("ai.credentialMissing")}
                    </span>
                    <div className="ai-credential-entry">
                      <input
                        type="password"
                        autoComplete="new-password"
                        aria-label={t("ai.credentialFor", {
                          name: profile.name,
                        })}
                        placeholder={t("ai.credentialPlaceholder")}
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
                        {t("ai.store")}
                      </button>
                    </div>
                    <div className="ai-profile-actions">
                      <button
                        type="button"
                        title={t("ai.testConnection")}
                        aria-label={t("ai.testNamed", { name: profile.name })}
                        disabled={
                          busy !== null ||
                          !profile.credentialPresent ||
                          profile.availability !== "available"
                        }
                        onClick={() => void testProvider(profile)}
                      >
                        <Play size={14} />
                      </button>
                      <button
                        type="button"
                        title={t("ai.editProfile")}
                        aria-label={t("ai.editNamed", { name: profile.name })}
                        disabled={busy !== null}
                        onClick={() => setEditingProfile({ ...profile })}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        title={t("ai.deleteCredential")}
                        aria-label={t("ai.deleteCredentialFor", {
                          name: profile.name,
                        })}
                        disabled={busy !== null || !profile.credentialPresent}
                        onClick={() => void removeCredential(profile)}
                      >
                        <KeyRound size={14} />
                      </button>
                      <button
                        type="button"
                        title={t("ai.deleteProfile")}
                        aria-label={t("ai.deleteNamed", { name: profile.name })}
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
                      aria-label={t("ai.editNamed", { name: profile.name })}
                    >
                      <label>
                        {t("ai.profileName")}
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
                        {t("ai.baseUrl")}
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
                        {t("common.model")}
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
                      {catalogDescriptorForSource(
                        catalog,
                        editingProfile.source,
                      )?.configSchema?.fields.map((field) => (
                        <ConnectorConfigField
                          key={field.key}
                          field={field}
                          value={
                            connectorConfiguration(
                              editingProfile.configuration,
                            )[field.key]
                          }
                          onChange={(value) =>
                            setEditingProfile({
                              ...editingProfile,
                              configuration: {
                                ...connectorConfiguration(
                                  editingProfile.configuration,
                                ),
                                [field.key]: value,
                              },
                            })
                          }
                        />
                      ))}
                      <label>
                        {t("ai.timeoutMs")}
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
                        <span>{t("ai.profileEnabled")}</span>
                      </label>
                      <div>
                        <button
                          type="button"
                          disabled={
                            busy !== null ||
                            editingProfile.availability !== "available" ||
                            !connectorConfigurationComplete(
                              catalogDescriptorForSource(
                                catalog,
                                editingProfile.source,
                              ),
                              connectorConfiguration(
                                editingProfile.configuration,
                              ),
                            )
                          }
                          onClick={() => void saveProviderUpdate()}
                        >
                          <ShieldCheck size={13} />
                          {t("common.save")}
                        </button>
                        <button
                          type="button"
                          title={t("ai.cancelEdit")}
                          aria-label={t("ai.cancelEditAria")}
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
                <strong>{t("ai.noProfiles")}</strong>
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
                <span>{t("ai.tmFirst")}</span>
                <h2>{t("ai.pretranslate")}</h2>
              </div>
            </div>
            <div className="ai-batch-form">
              <label>
                {t("common.provider")}
                <select
                  value={batchProfileId}
                  onChange={(event) =>
                    setBatchProfileId(event.currentTarget.value)
                  }
                >
                  <option value="">{t("ai.chooseProfile")}</option>
                  {profiles
                    .filter(
                      (profile) =>
                        profile.enabled && profile.availability === "available",
                    )
                    .map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                {t("ai.tmThreshold")}
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
                {t("ai.concurrency")}
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
                {t("ai.requestsPerMinute")}
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
                <span>{t("ai.replaceDrafts")}</span>
              </label>
              <button
                type="button"
                disabled={busy !== null || !batchProfileId}
                onClick={() => void startBatch()}
              >
                <Play size={15} /> {t("ai.startBatch")}
              </button>
            </div>
          </section>
          <section className="ai-batch-progress">
            <div className="section-heading">
              <div>
                <span>{t("ai.durableQueue")}</span>
                <h2>{t("ai.batchRuns")}</h2>
              </div>
              {activeBatch ? (
                <select
                  aria-label={t("ai.selectedBatchAria")}
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
                    <strong>{activeBatch.skipped}</strong>
                    {t("common.skipped")}
                  </span>
                  <span>
                    <strong>{activeBatch.failed}</strong>
                    {t("common.failed")}
                  </span>
                </div>
                <div className="batch-actions">
                  {!isBatchTerminal(activeBatch.status) ? (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void changeBatchState("cancel")}
                    >
                      <CircleStop size={14} />
                      {t("common.cancel")}
                    </button>
                  ) : activeBatch.status === "interrupted" ||
                    activeBatch.status === "failed" ||
                    activeBatch.status === "canceled" ? (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void changeBatchState("resume")}
                    >
                      <RotateCcw size={14} /> {t("ai.resume")}
                    </button>
                  ) : null}
                </div>
                <div
                  className="batch-item-list"
                  aria-label={t("ai.batchItemsAria")}
                >
                  {batchItems.map((item) => (
                    <div key={item.segmentId}>
                      <strong>#{item.ordinal + 1}</strong>
                      <span>{item.source ?? t("ai.pending")}</span>
                      <em data-status={item.status}>{item.status}</em>
                      {item.errorCode ? <small>{item.errorCode}</small> : null}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="surface-empty">
                <Activity size={22} />
                <strong>{t("ai.noBatchRuns")}</strong>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {tab === "usage" ? (
        <section className="ai-usage-section">
          <div className="section-heading">
            <div>
              <span>{t("ai.currentMonth")}</span>
              <h2>{t("ai.authoritativeUsage")}</h2>
            </div>
            <button
              type="button"
              aria-label={t("ai.refreshUsage")}
              title={t("ai.refreshUsage")}
              onClick={() => void runAction("usage", loadUsage)}
            >
              <RefreshCw size={14} />
            </button>
          </div>
          {usage.length ? (
            <div className="usage-table" role="table">
              <div role="row" className="usage-head">
                <span>{t("common.provider")}</span>
                <span>{t("common.requests")}</span>
                <span>{t("common.input")}</span>
                <span>{t("ai.cacheRead")}</span>
                <span>{t("ai.thinking")}</span>
                <span>{t("common.output")}</span>
                <span>{t("common.elapsed")}</span>
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
              <strong>{t("ai.noUsage")}</strong>
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}

async function waitForRun(
  initial: AiRun,
  timeoutMessage: string,
): Promise<AiRun> {
  let run = initial;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (isRunTerminal(run.status)) return run;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
    run = await window.translunar.invoke("ai.run.get", { runId: run.id });
  }
  throw new Error(timeoutMessage);
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

type ConnectorConfiguration = Record<string, string | number | boolean>;

function ConnectorConfigField({
  field,
  value,
  onChange,
}: {
  field: EngineConnectorConfigFieldV1;
  value: string | number | boolean | undefined;
  onChange: (value: string | number | boolean) => void;
}) {
  if (field.fieldType === "boolean") {
    return (
      <label className="switch-control ai-connector-config-field">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        <span>{field.label}</span>
      </label>
    );
  }
  if (field.fieldType === "select") {
    return (
      <label className="ai-connector-config-field">
        {field.label}
        <select
          required={field.required}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          <option value="" disabled={field.required}>
            {field.required ? field.label : ""}
          </option>
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {field.description ? <small>{field.description}</small> : null}
      </label>
    );
  }
  return (
    <label className="ai-connector-config-field">
      {field.label}
      <input
        type={field.fieldType === "integer" ? "number" : "text"}
        required={field.required}
        min={field.min ?? undefined}
        max={field.max ?? undefined}
        value={
          typeof value === "string" || typeof value === "number" ? value : ""
        }
        onChange={(event) =>
          onChange(
            field.fieldType === "integer" && event.currentTarget.value !== ""
              ? Number(event.currentTarget.value)
              : event.currentTarget.value,
          )
        }
      />
      {field.description ? <small>{field.description}</small> : null}
    </label>
  );
}

function defaultConnectorConfiguration(
  descriptor: AiConnectorCatalogItem,
): ConnectorConfiguration {
  const configuration: ConnectorConfiguration = {};
  for (const field of descriptor.configSchema?.fields ?? []) {
    if (field.defaultValue !== undefined && field.defaultValue !== null) {
      configuration[field.key] = field.defaultValue;
    }
  }
  return configuration;
}

function connectorConfiguration(value: unknown): ConnectorConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string | number | boolean] =>
        ["string", "number", "boolean"].includes(typeof entry[1]),
    ),
  );
}

function connectorConfigurationComplete(
  descriptor: AiConnectorCatalogItem | undefined,
  configuration: ConnectorConfiguration,
): boolean {
  return (descriptor?.configSchema?.fields ?? []).every(
    (field) =>
      !field.required ||
      (configuration[field.key] !== undefined &&
        configuration[field.key] !== ""),
  );
}

function connectorSourceLabel(source: EngineConnectorSource): string {
  return source.kind === "builtin"
    ? source.provider
    : `${source.owner.pluginId}@${source.owner.versionId}:${source.contributionId}/v${source.contractVersion}`;
}

function catalogDescriptorForSource(
  catalog: AiConnectorCatalogItem[],
  source: EngineConnectorSource,
): AiConnectorCatalogItem | undefined {
  const key = connectorSourceLabel(source);
  return catalog.find((item) => connectorSourceLabel(item.source) === key);
}
