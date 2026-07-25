import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type {
  AiProviderProfile,
  AssetCatalogItem,
  AssetCatalogKind,
  AssetCatalogPage,
  CurationExportFormat,
  CurationFinding,
  CurationFindingPage,
  CurationPolicy,
  CurationRunSnapshot,
  ProjectSnapshot,
  TmLibrary,
} from "@translunar/contracts";
import {
  AlertTriangle,
  ArchiveRestore,
  Check,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  FileOutput,
  Filter,
  LoaderCircle,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

import { formatError } from "./workbench-utils";
import {
  CURATION_CATALOG_PAGE_LIMIT,
  CURATION_FINDING_PAGE_LIMIT,
  CURATION_RUN_PAGE_LIMIT,
  DEFAULT_CURATION_POLICY,
  dateInputToMs,
  findingIsSelectable,
  findingKindLabel,
  formatBasisPoints,
  formatEvidence,
  isRevisionConflict,
  msToDateInput,
  nextPageOffset,
  pageRangeLabel,
  previousPageOffset,
  recommendationLabel,
  severityLabel,
} from "./asset-curation-utils";
import "./AssetCurationPanel.css";
import { useLocale } from "./i18n/LocaleProvider";

type CatalogScope = "project" | "global";
type MutationDialog = "apply" | "rollback";

interface AssetCurationPanelProps {
  snapshot: ProjectSnapshot;
  onRefresh(): Promise<void>;
}

interface CatalogFilterDraft {
  scope: CatalogScope;
  kind: AssetCatalogKind;
  sourceLocale: string;
  targetLocale: string;
  domain: string;
  query: string;
  originProjectId: string;
  originDocumentId: string;
  createdAfter: string;
  createdBefore: string;
}

type NumericPolicyKey =
  | "minimumChars"
  | "minimumLengthRatioPercent"
  | "maximumLengthRatioPercent"
  | "nearDuplicateThreshold"
  | "semanticAlignmentThresholdBasisPoints"
  | "quarantineThresholdBasisPoints"
  | "minimumTermFrequency";

const EMPTY_FILTERS: CatalogFilterDraft = {
  scope: "project",
  kind: "all",
  sourceLocale: "",
  targetLocale: "",
  domain: "",
  query: "",
  originProjectId: "",
  originDocumentId: "",
  createdAfter: "",
  createdBefore: "",
};

export function AssetCurationPanel({
  snapshot,
  onRefresh,
}: AssetCurationPanelProps) {
  const { t } = useLocale();

  const projectId = snapshot.project.id;
  const [catalogDraft, setCatalogDraft] =
    useState<CatalogFilterDraft>(EMPTY_FILTERS);
  const [catalogFilters, setCatalogFilters] =
    useState<CatalogFilterDraft>(EMPTY_FILTERS);
  const [catalogPage, setCatalogPage] = useState<AssetCatalogPage | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [libraries, setLibraries] = useState<TmLibrary[]>([]);
  const [libraryId, setLibraryId] = useState("");
  const [providers, setProviders] = useState<AiProviderProfile[]>([]);
  const [providerProfileId, setProviderProfileId] = useState("");
  const [run, setRun] = useState<CurationRunSnapshot | null>(null);
  const [findings, setFindings] = useState<CurationFindingPage | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [findingLoading, setFindingLoading] = useState(false);
  const [runOffset, setRunOffset] = useState(0);
  const [findingOffset, setFindingOffset] = useState(0);
  const [selectedFindingIds, setSelectedFindingIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [policy, setPolicy] = useState<CurationPolicy>(DEFAULT_CURATION_POLICY);
  const [actor, setActor] = useState("desktop-user");
  const [reason, setReason] = useState("Review translation assets");
  const [exportFormat, setExportFormat] =
    useState<CurationExportFormat>("jsonl");
  const [minimumScore, setMinimumScore] = useState("");
  const [exportPath, setExportPath] = useState("");
  const [dialog, setDialog] = useState<MutationDialog | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  const selectedLibrary = useMemo(
    () => libraries.find((library) => library.id === libraryId),
    [libraries, libraryId],
  );
  const providerOptions = useMemo(
    () =>
      providers.filter(
        (provider) =>
          provider.enabled &&
          provider.credentialPresent &&
          provider.kind !== "deepl",
      ),
    [providers],
  );
  const catalogItemsById = useMemo(
    () => new Map((catalogPage?.items ?? []).map((item) => [item.id, item])),
    [catalogPage],
  );
  const runUnitsById = useMemo(
    () => new Map((run?.units ?? []).map((unit) => [unit.unitId, unit])),
    [run],
  );
  const selectableFindings = useMemo(
    () =>
      (findings?.items ?? []).filter((finding) =>
        findingIsSelectable(finding, run?.run.status ?? null),
      ),
    [findings, run?.run.status],
  );
  const selectedCount = selectedFindingIds.size;
  const runStatus = run?.run.status ?? null;
  const isBusy = busy !== null;

  const catalogParams = useMemo(
    () => ({
      projectId: catalogFilters.scope === "project" ? projectId : null,
      kind: catalogFilters.kind,
      sourceLocale: catalogFilters.sourceLocale.trim() || null,
      targetLocale: catalogFilters.targetLocale.trim() || null,
      domain: catalogFilters.domain.trim() || null,
      query: catalogFilters.query.trim() || null,
      originProjectId: catalogFilters.originProjectId.trim() || null,
      originDocumentId: catalogFilters.originDocumentId.trim() || null,
      createdAfterMs: dateInputToMs(catalogFilters.createdAfter),
      createdBeforeMs: dateInputToMs(catalogFilters.createdBefore, true),
    }),
    [catalogFilters, projectId],
  );

  const loadCatalog = useCallback(
    async (offset: number) => {
      setCatalogLoading(true);
      try {
        const result = await window.translunar.invoke("asset.catalog.list", {
          ...catalogParams,
          offset,
          limit: CURATION_CATALOG_PAGE_LIMIT,
        });
        setCatalogPage(result);
        return result;
      } catch (reasonValue) {
        setError(formatError(reasonValue));
        if (isRevisionConflict(reasonValue)) setStale(true);
        throw reasonValue;
      } finally {
        setCatalogLoading(false);
      }
    },
    [catalogParams],
  );

  const loadLibraries = useCallback(async () => {
    const page = await window.translunar.invoke("tm.library.list", {
      projectId,
      offset: 0,
      limit: 500,
    });
    setLibraries(page.items);
    setLibraryId((current) =>
      page.items.some((library) => library.id === current)
        ? current
        : (page.items.find((library) => library.writable)?.id ??
          page.items[0]?.id ??
          ""),
    );
    return page.items;
  }, [projectId]);

  const loadProviders = useCallback(async () => {
    const page = await window.translunar.invoke("ai.provider.list", {
      offset: 0,
      limit: 100,
    });
    setProviders(page.items);
    setProviderProfileId((current) =>
      page.items.some((provider) => provider.id === current && provider.enabled)
        ? current
        : "",
    );
    return page.items;
  }, []);

  const loadFindings = useCallback(async (runId: string, offset: number) => {
    setFindingLoading(true);
    try {
      const result = await window.translunar.invoke("curation.finding.list", {
        runId,
        offset,
        limit: CURATION_FINDING_PAGE_LIMIT,
      });
      setFindings(result);
      setFindingOffset(result.offset);
      return result;
    } finally {
      setFindingLoading(false);
    }
  }, []);

  const loadRun = useCallback(async (runId: string, offset: number) => {
    setRunLoading(true);
    try {
      const result = await window.translunar.invoke("curation.run.get", {
        runId,
        offset,
        limit: CURATION_RUN_PAGE_LIMIT,
      });
      setRun(result);
      setRunOffset(result.offset);
      setPolicy(result.run.policy);
      setStale(false);
      return result;
    } finally {
      setRunLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog(0).catch(() => undefined);
  }, [loadCatalog]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void Promise.all([loadLibraries(), loadProviders()])
      .catch((reasonValue: unknown) => {
        if (active) setError(formatError(reasonValue));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadLibraries, loadProviders]);

  useEffect(() => {
    setRun(null);
    setFindings(null);
    setSelectedFindingIds(new Set());
    setStale(false);
    setNotice(null);
    setError(null);
  }, [libraryId]);

  useEffect(() => {
    if (!dialog) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isBusy) setDialog(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dialog, isBusy]);

  const runAction = async (
    key: string,
    action: () => Promise<void>,
  ): Promise<void> => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (reasonValue) {
      setError(formatError(reasonValue));
      if (isRevisionConflict(reasonValue)) setStale(true);
    } finally {
      setBusy(null);
    }
  };

  const submitCatalogFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCatalogFilters({ ...catalogDraft });
  };

  const resetCatalogFilters = () => {
    setCatalogDraft({ ...EMPTY_FILTERS });
    setCatalogFilters({ ...EMPTY_FILTERS });
  };

  const updateDraft = <Key extends keyof CatalogFilterDraft>(
    key: Key,
    value: CatalogFilterDraft[Key],
  ) => {
    setCatalogDraft((current) => ({ ...current, [key]: value }));
  };

  const updatePolicy = (key: NumericPolicyKey, value: number) => {
    setPolicy((current) => ({ ...current, [key]: value }));
  };

  const runCuration = async () => {
    if (!selectedLibrary || !actor.trim() || !reason.trim()) return;
    await runAction("curation-run", async () => {
      const result = await window.translunar.invoke("curation.run", {
        projectId,
        libraryId: selectedLibrary.id,
        expectedLibraryRevision: selectedLibrary.revision,
        policy,
        actor: actor.trim(),
        reason: reason.trim(),
        ...(providerProfileId ? { providerProfileId } : {}),
        offset: 0,
        limit: CURATION_RUN_PAGE_LIMIT,
      });
      setRun(result);
      setRunOffset(0);
      setFindings(null);
      setFindingOffset(0);
      setSelectedFindingIds(new Set());
      setStale(false);
      await loadFindings(result.run.id, 0);
      setNotice(
        t("curation.runCompleted", {
          mode:
            result.run.mode === "provider"
              ? t("curation.modeProvider")
              : t("curation.modeOffline"),
          count: result.total,
        }),
      );
    });
  };

  const refreshRunAndCatalog = async (runId: string) => {
    const [currentRun] = await Promise.all([
      loadRun(runId, 0),
      loadLibraries(),
      loadCatalog(catalogPage?.offset ?? 0),
      onRefresh(),
    ]);
    await loadFindings(runId, 0);
    setRun(currentRun);
  };

  const applyCuration = async () => {
    if (!run || !selectedLibrary || selectedCount === 0) return;
    await runAction("curation-apply", async () => {
      const result = await window.translunar.invoke("curation.apply", {
        runId: run.run.id,
        expectedRunRevision: run.run.revision,
        expectedLibraryRevision: selectedLibrary.revision,
        selectedFindingIds: [...selectedFindingIds],
        actor: actor.trim(),
        reason: reason.trim(),
      });
      setDialog(null);
      setSelectedFindingIds(new Set());
      await refreshRunAndCatalog(result.runId);
      setNotice(t("curation.applied", { count: result.quarantinedUnitCount }));
    });
  };

  const rollbackCuration = async () => {
    if (!run || !selectedLibrary) return;
    await runAction("curation-rollback", async () => {
      const result = await window.translunar.invoke("curation.rollback", {
        runId: run.run.id,
        expectedRunRevision: run.run.revision,
        expectedLibraryRevision: selectedLibrary.revision,
        actor: actor.trim(),
        reason: reason.trim(),
      });
      setDialog(null);
      setSelectedFindingIds(new Set());
      await refreshRunAndCatalog(result.runId);
      setNotice(
        t("curation.rollbackRestored", { count: result.restoredUnitCount }),
      );
    });
  };

  const exportCuration = async () => {
    if (!run || !selectedLibrary || runStatus !== "applied") return;
    const suggestedName = `curation-${selectedLibrary.name
      .replaceAll(/[^a-zA-Z0-9._-]+/gu, "-")
      .slice(0, 48)}.${exportFormat}`;
    await runAction("curation-export", async () => {
      const destination =
        await window.translunar.selectExportPath(suggestedName);
      if (!destination) return;
      const parsedMinimum = minimumScore.trim() ? Number(minimumScore) : null;
      const result = await window.translunar.invoke("curation.export", {
        runId: run.run.id,
        expectedRunRevision: run.run.revision,
        expectedLibraryRevision: selectedLibrary.revision,
        format: exportFormat,
        minimumScoreBasisPoints:
          parsedMinimum !== null && Number.isFinite(parsedMinimum)
            ? parsedMinimum
            : null,
        outputPath: destination,
      });
      setExportPath(result.outputPath);
      setNotice(
        t("curation.exported", {
          count: result.rowCount,
          format: result.format.toUpperCase(),
        }),
      );
    });
  };

  const refreshAuthoritative = async () => {
    await runAction("refresh", async () => {
      await Promise.all([
        loadLibraries(),
        loadCatalog(catalogPage?.offset ?? 0),
        run ? loadRun(run.run.id, runOffset) : Promise.resolve(),
        run ? loadFindings(run.run.id, findingOffset) : Promise.resolve(),
        onRefresh(),
      ]);
      setStale(false);
      setNotice(t("curation.refreshed"));
    });
  };

  const toggleFinding = (finding: CurationFinding, checked: boolean) => {
    if (!findingIsSelectable(finding, runStatus)) return;
    setSelectedFindingIds((current) => {
      const next = new Set(current);
      if (checked) next.add(finding.id);
      else next.delete(finding.id);
      return next;
    });
  };

  const selectVisibleFindings = () => {
    setSelectedFindingIds((current) => {
      const next = new Set(current);
      for (const finding of selectableFindings) next.add(finding.id);
      return next;
    });
  };

  const clearSelection = () => setSelectedFindingIds(new Set());

  const loadCatalogPage = async (offset: number) => {
    await runAction("catalog-page", async () => {
      await loadCatalog(offset);
    });
  };

  const loadFindingPage = async (offset: number) => {
    if (!run) return;
    await runAction("finding-page", async () => {
      await loadFindings(run.run.id, offset);
    });
  };

  const loadRunPage = async (offset: number) => {
    if (!run) return;
    await runAction("run-page", async () => {
      await loadRun(run.run.id, offset);
    });
  };

  const catalogHasItems = (catalogPage?.items.length ?? 0) > 0;
  const runHasFindings = (findings?.items.length ?? 0) > 0;
  const canAnalyze =
    !!selectedLibrary &&
    selectedLibrary.sourceLocale === snapshot.project.sourceLocale &&
    selectedLibrary.targetLocale === snapshot.project.targetLocale &&
    !!actor.trim() &&
    !!reason.trim();
  const canApply =
    !!run && runStatus === "open" && !!selectedLibrary && selectedCount > 0;
  const canRollback = !!run && runStatus === "applied" && !!selectedLibrary;

  return (
    <div className="asset-curation-layout" aria-busy={isBusy || loading}>
      {error ? (
        <div className="asset-curation-error" role="alert">
          <AlertTriangle size={15} /> <span>{error}</span>
        </div>
      ) : null}
      {notice ? (
        <div className="asset-curation-notice" role="status">
          <Check size={15} /> <span>{notice}</span>
        </div>
      ) : null}
      <section className="insights-section asset-curation-catalog-section">
        <PanelHeading
          icon={<Database size={16} />}
          eyebrow={t("curation.catalog")}
          title={t("curation.unifiedCatalog")}
          actions={
            <button
              className="icon-button"
              type="button"
              title={t("curation.refreshState")}
              aria-label={t("curation.refreshState")}
              onClick={() => void refreshAuthoritative()}
              disabled={isBusy}
            >
              <RefreshCw size={15} />
            </button>
          }
        />
        <form
          className="asset-curation-filter-form"
          onSubmit={submitCatalogFilters}
        >
          <div
            className="asset-curation-scope"
            role="group"
            aria-label={t("curation.catalogScope")}
          >
            <button
              type="button"
              aria-pressed={catalogDraft.scope === "project"}
              onClick={() => updateDraft("scope", "project")}
              disabled={isBusy}
            >
              <ShieldCheck size={13} />
              {t("common.project")}
            </button>
            <button
              type="button"
              aria-pressed={catalogDraft.scope === "global"}
              onClick={() => updateDraft("scope", "global")}
              disabled={isBusy}
            >
              <Database size={13} /> {t("curation.global")}
            </button>
          </div>
          <div className="asset-curation-filter-grid">
            <Field label={t("curation.assetKind")}>
              <select
                value={catalogDraft.kind}
                onChange={(event) =>
                  updateDraft(
                    "kind",
                    event.currentTarget.value as AssetCatalogKind,
                  )
                }
                disabled={isBusy}
              >
                <option value="all">{t("curation.allAssets")}</option>
                <option value="tm">{t("common.translationMemory")}</option>
                <option value="termbase">{t("common.termbase")}</option>
                <option value="corpus">{t("common.referenceCorpus")}</option>
              </select>
            </Field>
            <Field label={t("curation.sourceLocale")}>
              <input
                value={catalogDraft.sourceLocale}
                onChange={(event) =>
                  updateDraft("sourceLocale", event.currentTarget.value)
                }
                placeholder={snapshot.project.sourceLocale}
                disabled={isBusy}
              />
            </Field>
            <Field label={t("curation.targetLocale")}>
              <input
                value={catalogDraft.targetLocale}
                onChange={(event) =>
                  updateDraft("targetLocale", event.currentTarget.value)
                }
                placeholder={snapshot.project.targetLocale}
                disabled={isBusy}
              />
            </Field>
            <Field label={t("common.domain")}>
              <input
                value={catalogDraft.domain}
                onChange={(event) =>
                  updateDraft("domain", event.currentTarget.value)
                }
                placeholder={t("curation.anyDomain")}
                disabled={isBusy}
              />
            </Field>
            <Field label={t("curation.query")}>
              <input
                value={catalogDraft.query}
                onChange={(event) =>
                  updateDraft("query", event.currentTarget.value)
                }
                placeholder={t("curation.queryPlaceholder")}
                disabled={isBusy}
              />
            </Field>
            <div className="asset-curation-filter-actions">
              <button
                className="button primary"
                type="submit"
                disabled={isBusy}
              >
                <Search size={14} /> {t("curation.applyFilters")}
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={resetCatalogFilters}
                disabled={isBusy}
              >
                <Filter size={14} /> {t("curation.reset")}
              </button>
            </div>
            <Field label={t("curation.originProject")}>
              <input
                value={catalogDraft.originProjectId}
                onChange={(event) =>
                  updateDraft("originProjectId", event.currentTarget.value)
                }
                placeholder={t("common.optional")}
                disabled={isBusy}
              />
            </Field>
            <Field label={t("curation.originDocument")}>
              <input
                value={catalogDraft.originDocumentId}
                onChange={(event) =>
                  updateDraft("originDocumentId", event.currentTarget.value)
                }
                placeholder={t("common.optional")}
                disabled={isBusy}
              />
            </Field>
            <Field label={t("curation.createdAfter")}>
              <input
                type="date"
                value={catalogDraft.createdAfter}
                onChange={(event) =>
                  updateDraft("createdAfter", event.currentTarget.value)
                }
                disabled={isBusy}
              />
            </Field>
            <Field label={t("curation.createdBefore")}>
              <input
                type="date"
                value={catalogDraft.createdBefore}
                onChange={(event) =>
                  updateDraft("createdBefore", event.currentTarget.value)
                }
                disabled={isBusy}
              />
            </Field>
          </div>
        </form>
        {catalogLoading ? (
          <LoadingState label={t("curation.loadingCatalog")} />
        ) : !catalogHasItems ? (
          <EmptyState
            title={t("curation.noCatalogRows")}
            detail={t("curation.noCatalogMatch")}
          />
        ) : (
          <>
            <CatalogTable items={catalogPage?.items ?? []} />
            <Pagination
              ariaLabel={t("curation.catalogPages")}
              offset={catalogPage?.offset ?? 0}
              limit={catalogPage?.limit ?? CURATION_CATALOG_PAGE_LIMIT}
              total={catalogPage?.total ?? 0}
              onPrevious={() =>
                void loadCatalogPage(
                  previousPageOffset(
                    catalogPage?.offset ?? 0,
                    catalogPage?.limit ?? CURATION_CATALOG_PAGE_LIMIT,
                  ),
                )
              }
              onNext={() =>
                void loadCatalogPage(
                  nextPageOffset(
                    catalogPage?.offset ?? 0,
                    catalogPage?.limit ?? CURATION_CATALOG_PAGE_LIMIT,
                    catalogPage?.total ?? 0,
                  ),
                )
              }
            />
          </>
        )}
      </section>

      <section className="insights-section asset-curation-run-section">
        <PanelHeading
          icon={<Sparkles size={16} />}
          eyebrow={t("curation.runKicker")}
          title={t("curation.analyzeLibrary")}
          actions={
            <span className="asset-curation-revision">
              {selectedLibrary
                ? t("curation.libraryRevision", {
                    revision: selectedLibrary.revision,
                  })
                : t("curation.noLibrarySelected")}
            </span>
          }
        />
        <div className="asset-curation-run-controls">
          <Field label={t("curation.tmLibrary")}>
            <select
              value={libraryId}
              onChange={(event) => setLibraryId(event.currentTarget.value)}
              disabled={isBusy || loading}
            >
              <option value="">{t("curation.selectTm")}</option>
              {libraries.map((library) => (
                <option key={library.id} value={library.id}>
                  {library.name} · {library.sourceLocale} to{" "}
                  {library.targetLocale}
                  {library.writable ? "" : ` · ${t("curation.readOnly")}`}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("curation.semanticProvider")}>
            <select
              value={providerProfileId}
              onChange={(event) =>
                setProviderProfileId(event.currentTarget.value)
              }
              disabled={isBusy || loading}
            >
              <option value="">{t("curation.offlineChecks")}</option>
              {providerOptions.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name} · {provider.model}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("common.actor")}>
            <input
              value={actor}
              onChange={(event) => setActor(event.currentTarget.value)}
              maxLength={256}
              disabled={isBusy}
            />
          </Field>
          <Field label={t("common.reason")}>
            <input
              value={reason}
              onChange={(event) => setReason(event.currentTarget.value)}
              maxLength={4096}
              disabled={isBusy}
            />
          </Field>
        </div>
        <div className="asset-curation-policy-heading">
          <div>
            <span className="surface-kicker">{t("common.policy")}</span>
            <strong>{t("curation.thresholds")}</strong>
          </div>
          <span>{t("curation.thresholdsHelp")}</span>
        </div>
        <div className="asset-curation-policy-grid">
          <NumberField
            label={t("curation.minimumChars")}
            value={policy.minimumChars}
            min={1}
            max={1_000_000}
            onChange={(value) => updatePolicy("minimumChars", value)}
            disabled={isBusy}
          />
          <NumberField
            label={t("curation.minimumRatio")}
            value={policy.minimumLengthRatioPercent}
            min={1}
            max={10_000}
            onChange={(value) =>
              updatePolicy("minimumLengthRatioPercent", value)
            }
            disabled={isBusy}
          />
          <NumberField
            label={t("curation.maximumRatio")}
            value={policy.maximumLengthRatioPercent}
            min={1}
            max={10_000}
            onChange={(value) =>
              updatePolicy("maximumLengthRatioPercent", value)
            }
            disabled={isBusy}
          />
          <NumberField
            label={t("curation.nearDuplicate")}
            value={policy.nearDuplicateThreshold}
            min={1}
            max={99}
            onChange={(value) => updatePolicy("nearDuplicateThreshold", value)}
            disabled={isBusy}
          />
          <NumberField
            label={t("curation.semanticScore")}
            value={policy.semanticAlignmentThresholdBasisPoints}
            min={0}
            max={10_000}
            onChange={(value) =>
              updatePolicy("semanticAlignmentThresholdBasisPoints", value)
            }
            disabled={isBusy}
          />
          <NumberField
            label={t("curation.quarantineScore")}
            value={policy.quarantineThresholdBasisPoints}
            min={0}
            max={10_000}
            onChange={(value) =>
              updatePolicy("quarantineThresholdBasisPoints", value)
            }
            disabled={isBusy}
          />
          <NumberField
            label={t("curation.minimumTermFrequency")}
            value={policy.minimumTermFrequency}
            min={2}
            max={10_000}
            onChange={(value) => updatePolicy("minimumTermFrequency", value)}
            disabled={isBusy}
          />
          <Field label={t("curation.createdAfter")}>
            <input
              type="date"
              value={msToDateInput(policy.createdAfterMs)}
              onChange={(event) =>
                setPolicy((current) => ({
                  ...current,
                  createdAfterMs: dateInputToMs(event.currentTarget.value),
                }))
              }
              disabled={isBusy}
            />
          </Field>
          <Field label={t("curation.createdBefore")}>
            <input
              type="date"
              value={msToDateInput(policy.createdBeforeMs)}
              onChange={(event) =>
                setPolicy((current) => ({
                  ...current,
                  createdBeforeMs: dateInputToMs(
                    event.currentTarget.value,
                    true,
                  ),
                }))
              }
              disabled={isBusy}
            />
          </Field>
        </div>
        <div className="asset-curation-action-row">
          <button
            className="button primary"
            type="button"
            onClick={() => void runCuration()}
            disabled={!canAnalyze || isBusy}
          >
            {busy === "curation-run" ? (
              <LoaderCircle className="spin" size={14} />
            ) : (
              <Play size={14} />
            )}
            {t("curation.analyzeAction")}
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={() => void refreshAuthoritative()}
            disabled={isBusy}
          >
            <RefreshCw size={14} /> {t("curation.refreshRevisions")}
          </button>
        </div>
        {stale ? (
          <div className="asset-curation-stale" role="alert">
            <AlertTriangle size={15} />
            <span>{t("curation.staleRevisions")}</span>
            <button
              className="button secondary"
              type="button"
              onClick={() => void refreshAuthoritative()}
              disabled={isBusy}
            >
              {t("curation.reloadState")}
            </button>
          </div>
        ) : null}
      </section>

      {run ? (
        <>
          <section className="asset-curation-summary-section">
            <SummaryStrip run={run} />
            <div className="asset-curation-run-meta">
              <span className={`asset-curation-status is-${runStatus}`}>
                {runStatus === "rolledBack"
                  ? t("curation.rolledBack")
                  : runStatus}
              </span>
              <span>
                {run.run.mode === "provider"
                  ? t("curation.providerRefinement")
                  : t("curation.offlineAnalysis")}
              </span>
              <span>
                {t("curation.baseLibraryRevision", {
                  revision: run.run.baseLibraryRevision,
                })}
              </span>
              <span>
                {t("curation.runRevisionLabel", { revision: run.run.revision })}
              </span>
              <span>{t("curation.actor", { actor: run.run.actor })}</span>
            </div>
          </section>

          <section className="insights-section asset-curation-findings-section">
            <PanelHeading
              icon={<ShieldCheck size={16} />}
              eyebrow={t("curation.findingsKicker")}
              title={t("curation.reviewChanges")}
              actions={
                <div className="asset-curation-section-actions">
                  <span>
                    {t("curation.selectedCount", { count: selectedCount })}
                  </span>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={selectVisibleFindings}
                    disabled={isBusy || selectableFindings.length === 0}
                  >
                    <Check size={14} /> {t("curation.selectVisible")}
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={clearSelection}
                    disabled={isBusy || selectedCount === 0}
                  >
                    <X size={14} /> {t("curation.clear")}
                  </button>
                </div>
              }
            />
            {findingLoading ? (
              <LoadingState label={t("curation.loadingFindings")} />
            ) : !runHasFindings ? (
              <EmptyState
                title={t("curation.noFindingsPage")}
                detail={t("curation.noFindingsDetail")}
              />
            ) : (
              <>
                <FindingsTable
                  findings={findings?.items ?? []}
                  selectedIds={selectedFindingIds}
                  runStatus={runStatus}
                  catalogItemsById={catalogItemsById}
                  runUnitsById={runUnitsById}
                  onToggle={toggleFinding}
                />
                <Pagination
                  ariaLabel={t("curation.findingPages")}
                  offset={findings?.offset ?? 0}
                  limit={findings?.limit ?? CURATION_FINDING_PAGE_LIMIT}
                  total={findings?.total ?? 0}
                  onPrevious={() =>
                    void loadFindingPage(
                      previousPageOffset(
                        findings?.offset ?? 0,
                        findings?.limit ?? CURATION_FINDING_PAGE_LIMIT,
                      ),
                    )
                  }
                  onNext={() =>
                    void loadFindingPage(
                      nextPageOffset(
                        findings?.offset ?? 0,
                        findings?.limit ?? CURATION_FINDING_PAGE_LIMIT,
                        findings?.total ?? 0,
                      ),
                    )
                  }
                />
              </>
            )}
          </section>

          <div className="asset-curation-lower-grid">
            <section className="insights-section asset-curation-units-section">
              <PanelHeading
                icon={<Database size={16} />}
                eyebrow={t("curation.scoreProjection")}
                title={t("curation.analyzedUnits")}
              />
              {runLoading ? (
                <LoadingState label={t("curation.loadingUnits")} />
              ) : (
                <>
                  <RunUnitsTable units={run.units} />
                  <Pagination
                    ariaLabel={t("curation.unitPages")}
                    offset={run.offset}
                    limit={run.limit}
                    total={run.total}
                    onPrevious={() =>
                      void loadRunPage(
                        previousPageOffset(run.offset, run.limit),
                      )
                    }
                    onNext={() =>
                      void loadRunPage(
                        nextPageOffset(run.offset, run.limit, run.total),
                      )
                    }
                  />
                </>
              )}
            </section>
            <TermsAndDrift run={run} />
          </div>

          <section className="insights-section asset-curation-actions-section">
            <PanelHeading
              icon={<FileOutput size={16} />}
              eyebrow={t("curation.actionsKicker")}
              title={t("curation.applyRollbackExport")}
            />
            <div className="asset-curation-action-grid">
              <div className="asset-curation-action-copy">
                <strong>{t("curation.selectedFindings")}</strong>
                <span>
                  {t("curation.quarantineSelected", { count: selectedCount })}
                </span>
              </div>
              <button
                className="button primary"
                type="button"
                onClick={() => setDialog("apply")}
                disabled={!canApply || isBusy}
              >
                <ShieldCheck size={14} /> {t("curation.applySelected")}
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => setDialog("rollback")}
                disabled={!canRollback || isBusy}
              >
                <RotateCcw size={14} /> {t("curation.rollbackRun")}
              </button>
              <Field label={t("curation.exportFormat")}>
                <select
                  value={exportFormat}
                  onChange={(event) =>
                    setExportFormat(
                      event.currentTarget.value as CurationExportFormat,
                    )
                  }
                  disabled={isBusy || runStatus !== "applied"}
                >
                  <option value="jsonl">JSONL</option>
                  <option value="tsv">TSV</option>
                </select>
              </Field>
              <Field label={t("curation.minimumScore")}>
                <input
                  type="number"
                  min={0}
                  max={10_000}
                  value={minimumScore}
                  onChange={(event) =>
                    setMinimumScore(event.currentTarget.value)
                  }
                  placeholder={t("curation.allActive")}
                  disabled={isBusy || runStatus !== "applied"}
                />
              </Field>
              <button
                className="button secondary"
                type="button"
                onClick={() => void exportCuration()}
                disabled={runStatus !== "applied" || isBusy}
              >
                {busy === "curation-export" ? (
                  <LoaderCircle className="spin" size={14} />
                ) : (
                  <Download size={14} />
                )}
                {t("curation.cleanDataset")}
              </button>
            </div>
            {exportPath ? (
              <p className="asset-curation-export-status" role="status">
                {t("curation.lastExport", { path: exportPath })}
              </p>
            ) : null}
          </section>
        </>
      ) : (
        <section className="asset-curation-empty-run" aria-live="polite">
          <Sparkles size={22} />
          <strong>{t("curation.noRun")}</strong>
          <span>{t("curation.selectAndAnalyze")}</span>
        </section>
      )}

      {dialog ? (
        <MutationDialog
          kind={dialog}
          selectedCount={selectedCount}
          actor={actor}
          reason={reason}
          busy={isBusy}
          onActor={setActor}
          onReason={setReason}
          onCancel={() => setDialog(null)}
          onConfirm={() =>
            void (dialog === "apply" ? applyCuration() : rollbackCuration())
          }
        />
      ) : null}
    </div>
  );
}

function PanelHeading({
  icon,
  eyebrow,
  title,
  actions,
}: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  actions?: ReactNode;
}) {
  return (
    <div className="insights-section-heading asset-curation-heading">
      <div>
        <span className="surface-kicker">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      <div className="asset-curation-heading-actions">
        {icon}
        {actions}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="asset-curation-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange(value: number): void;
  disabled: boolean;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(event) => {
          const next = event.currentTarget.valueAsNumber;
          if (Number.isFinite(next)) onChange(next);
        }}
        disabled={disabled}
      />
    </Field>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <p className="asset-curation-loading" role="status">
      <LoaderCircle className="spin" size={16} /> {label}
    </p>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="asset-curation-empty-state">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function CatalogTable({ items }: { items: AssetCatalogItem[] }) {
  const { t, formatNumber } = useLocale();
  return (
    <div className="asset-curation-table-wrap">
      <table
        className="asset-curation-table"
        aria-label={t("curation.catalogRowsAria")}
      >
        <thead>
          <tr>
            <th>{t("common.kind")}</th>
            <th>{t("common.collection")}</th>
            <th>{t("common.source")}</th>
            <th>{t("common.target")}</th>
            <th>{t("common.locale")}</th>
            <th>{t("common.state")}</th>
            <th>{t("common.quality")}</th>
            <th>{t("common.provenance")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={`${item.kind}:${item.collectionId}:${item.id}`}>
              <td>
                <span className="asset-curation-kind">{item.kind}</span>
              </td>
              <td>
                <strong title={item.collectionName}>
                  {item.collectionName}
                </strong>
                <small>{shortId(item.id)}</small>
              </td>
              <td title={item.sourceText}>{truncate(item.sourceText)}</td>
              <td title={item.targetText}>{truncate(item.targetText)}</td>
              <td>
                {item.sourceLocale} → {item.targetLocale || "-"}
              </td>
              <td>{item.curationState ?? "-"}</td>
              <td>
                {formatBasisPoints(
                  item.qualityScoreBasisPoints,
                  formatNumber,
                  t,
                )}
              </td>
              <td>
                <small>
                  {item.originProjectId
                    ? t("curation.projectOrigin", {
                        id: shortId(item.originProjectId),
                      })
                    : t("curation.globalOrigin")}
                  {item.originDocumentId
                    ? t("curation.documentOrigin", {
                        id: shortId(item.originDocumentId),
                      })
                    : ""}
                  {item.structuralPath ? ` / ${item.structuralPath}` : ""}
                </small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FindingsTable({
  findings,
  selectedIds,
  runStatus,
  catalogItemsById,
  runUnitsById,
  onToggle,
}: {
  findings: CurationFinding[];
  selectedIds: ReadonlySet<string>;
  runStatus: CurationRunSnapshot["run"]["status"] | null;
  catalogItemsById: ReadonlyMap<string, AssetCatalogItem>;
  runUnitsById: ReadonlyMap<string, CurationRunSnapshot["units"][number]>;
  onToggle(finding: CurationFinding, checked: boolean): void;
}) {
  const { t, formatNumber } = useLocale();
  return (
    <div className="asset-curation-table-wrap">
      <table
        className="asset-curation-table asset-curation-findings-table"
        aria-label={t("curation.findingsAria")}
      >
        <thead>
          <tr>
            <th>{t("common.select")}</th>
            <th>{t("common.severity")}</th>
            <th>{t("common.rule")}</th>
            <th>{t("common.score")}</th>
            <th>{t("common.disposition")}</th>
            <th>{t("common.evidence")}</th>
            <th>{t("common.provenance")}</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((finding) => {
            const selectable = findingIsSelectable(finding, runStatus);
            const catalogItem = catalogItemsById.get(finding.unitId);
            const runUnit = runUnitsById.get(finding.unitId);
            return (
              <tr key={finding.id} data-selected={selectedIds.has(finding.id)}>
                <td>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(finding.id)}
                    disabled={!selectable}
                    aria-label={t("curation.selectFinding", {
                      kind: findingKindLabel(finding.kind, t),
                      id: shortId(finding.id),
                    })}
                    onChange={(event) =>
                      onToggle(finding, event.currentTarget.checked)
                    }
                  />
                </td>
                <td>
                  <span
                    className={`asset-curation-severity is-${finding.severity}`}
                  >
                    {severityLabel(finding.severity, t)}
                  </span>
                </td>
                <td>
                  <strong>{findingKindLabel(finding.kind, t)}</strong>
                  <small>{shortId(finding.id)}</small>
                </td>
                <td>
                  <strong>
                    {formatBasisPoints(
                      finding.qualityScoreBasisPoints,
                      formatNumber,
                      t,
                    )}
                  </strong>
                  <small>
                    -
                    {formatBasisPoints(
                      finding.penaltyBasisPoints,
                      formatNumber,
                      t,
                    )}
                  </small>
                </td>
                <td>
                  <span
                    className={`asset-curation-disposition is-${finding.disposition}`}
                  >
                    {recommendationLabel(finding.disposition, t)}
                  </span>
                </td>
                <td>
                  <ul className="asset-curation-evidence-list">
                    {formatEvidence(finding.evidence, t).map((value) => (
                      <li key={value}>{value}</li>
                    ))}
                  </ul>
                  <small>{finding.explanation}</small>
                </td>
                <td>
                  <small>
                    {t("curation.unitOrigin", { id: shortId(finding.unitId) })}
                    {catalogItem?.originDocumentId
                      ? t("curation.documentOrigin", {
                          id: shortId(catalogItem.originDocumentId),
                        })
                      : ""}
                    {catalogItem?.structuralPath
                      ? ` / ${catalogItem.structuralPath}`
                      : ""}
                    {runUnit
                      ? ` / ${recommendationLabel(runUnit.recommendedAction, t)}`
                      : ""}
                  </small>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RunUnitsTable({ units }: { units: CurationRunSnapshot["units"] }) {
  const { t, formatNumber } = useLocale();
  return (
    <div className="asset-curation-table-wrap">
      <table
        className="asset-curation-table"
        aria-label={t("curation.unitsAria")}
      >
        <thead>
          <tr>
            <th>{t("common.unit")}</th>
            <th>{t("common.score")}</th>
            <th>{t("common.recommendation")}</th>
            <th>{t("common.explanation")}</th>
          </tr>
        </thead>
        <tbody>
          {units.map((unit) => (
            <tr key={unit.unitId}>
              <td>
                <strong>{shortId(unit.unitId)}</strong>
                <small>{unit.unitSnapshotHash.slice(0, 12)}</small>
              </td>
              <td>
                {formatBasisPoints(
                  unit.qualityScoreBasisPoints,
                  formatNumber,
                  t,
                )}
              </td>
              <td>{recommendationLabel(unit.recommendedAction, t)}</td>
              <td>
                <ul className="asset-curation-explanation-list">
                  {unit.explanation.slice(0, 4).map((value) => (
                    <li key={value}>{value}</li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryStrip({ run }: { run: CurationRunSnapshot }) {
  const { t, formatNumber } = useLocale();
  const summary = run.run.summary.analysis;
  return (
    <div className="asset-curation-metric-strip">
      <Metric
        label={t("curation.metricAnalyzed")}
        value={formatNumber(summary.analyzedUnits)}
      />
      <Metric
        label={t("curation.metricWithFindings")}
        value={formatNumber(summary.unitsWithFindings)}
      />
      <Metric
        label={t("curation.metricFindings")}
        value={formatNumber(summary.findingCount)}
      />
      <Metric
        label={t("curation.metricQuarantine")}
        value={formatNumber(summary.quarantineCandidates)}
      />
      <Metric
        label={t("curation.metricTerms")}
        value={formatNumber(summary.termCandidateCount)}
      />
      <Metric
        label={t("curation.metricDrift")}
        value={formatNumber(summary.driftGroupCount)}
      />
    </div>
  );
}

function TermsAndDrift({ run }: { run: CurationRunSnapshot }) {
  const { t, formatNumber } = useLocale();
  const terms = run.run.summary.termCandidates;
  const drift = run.run.summary.driftGroups;
  return (
    <section className="insights-section asset-curation-intelligence-section">
      <PanelHeading
        icon={<Sparkles size={16} />}
        eyebrow={t("curation.languageIntelligence")}
        title={t("curation.termsDrift")}
      />
      <div className="asset-curation-intelligence-block">
        <h3>{t("curation.termCandidates")}</h3>
        {terms.length === 0 ? (
          <span className="asset-curation-muted">
            {t("curation.noCandidates")}
          </span>
        ) : (
          <ul className="asset-curation-term-list">
            {terms.slice(0, 12).map((term) => (
              <li key={`${term.sourceTerm}:${term.targetTerm}`}>
                <strong>{term.sourceTerm}</strong>
                <span>{term.targetTerm}</span>
                <small>
                  {t("curation.termUses", { count: term.frequency })} ·{" "}
                  {formatBasisPoints(
                    term.agreementBasisPoints,
                    formatNumber,
                    t,
                  )}{" "}
                  {t("curation.agreement")}
                </small>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="asset-curation-intelligence-block">
        <h3>{t("curation.driftGroups")}</h3>
        {drift.length === 0 ? (
          <span className="asset-curation-muted">
            {t("curation.noCompeting")}
          </span>
        ) : (
          <ul className="asset-curation-drift-list">
            {drift.slice(0, 12).map((group) => (
              <li key={group.sourceKey}>
                <strong>{group.sourceText}</strong>
                <span>{group.targetVariants.join(" / ")}</span>
                <small>
                  {t("curation.relatedUnitCount", {
                    count: group.unitIds.length,
                  })}
                </small>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="asset-curation-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Pagination({
  ariaLabel,
  offset,
  limit,
  total,
  onPrevious,
  onNext,
}: {
  ariaLabel: string;
  offset: number;
  limit: number;
  total: number;
  onPrevious(): void;
  onNext(): void;
}) {
  const { t } = useLocale();
  return (
    <nav className="asset-curation-pagination" aria-label={ariaLabel}>
      <button
        className="icon-button"
        type="button"
        title={t("common.previousPage")}
        aria-label={t("common.previousPage")}
        onClick={onPrevious}
        disabled={offset === 0}
      >
        <ChevronLeft size={15} />
      </button>
      <span>
        {pageRangeLabel(
          offset,
          Math.min(limit, Math.max(0, total - offset)),
          total,
          (start, end, count) =>
            t("common.pageRange", { start, end, total: count }),
        )}
      </span>
      <button
        className="icon-button"
        type="button"
        title={t("common.nextPage")}
        aria-label={t("common.nextPage")}
        onClick={onNext}
        disabled={offset + limit >= total}
      >
        <ChevronRight size={15} />
      </button>
    </nav>
  );
}

function MutationDialog({
  kind,
  selectedCount,
  actor,
  reason,
  busy,
  onActor,
  onReason,
  onCancel,
  onConfirm,
}: {
  kind: MutationDialog;
  selectedCount: number;
  actor: string;
  reason: string;
  busy: boolean;
  onActor(value: string): void;
  onReason(value: string): void;
  onCancel(): void;
  onConfirm(): void;
}) {
  const { t } = useLocale();
  const applying = kind === "apply";
  const title = applying
    ? t("curation.applyDialogTitle")
    : t("curation.rollbackDialogTitle");
  const description = applying
    ? t("curation.applyDialogBody", { count: selectedCount })
    : t("curation.rollbackDialogBody");
  return (
    <div className="asset-curation-dialog-backdrop" role="presentation">
      <section
        className="asset-curation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="asset-curation-dialog-title"
      >
        <div className="asset-curation-dialog-heading">
          <div>
            <span className="surface-kicker">{t("curation.revisionSafe")}</span>
            <h2 id="asset-curation-dialog-title">{title}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            title={t("aria.closeDialog")}
            aria-label={t("aria.closeDialog")}
            onClick={onCancel}
            disabled={busy}
          >
            <X size={15} />
          </button>
        </div>
        <p>{description}</p>
        <label className="asset-curation-field">
          <span>{t("common.actor")}</span>
          <input
            value={actor}
            onChange={(event) => onActor(event.currentTarget.value)}
            maxLength={256}
            disabled={busy}
          />
        </label>
        <label className="asset-curation-field">
          <span>{t("common.reason")}</span>
          <textarea
            value={reason}
            onChange={(event) => onReason(event.currentTarget.value)}
            maxLength={4096}
            rows={3}
            disabled={busy}
          />
        </label>
        <div className="asset-curation-dialog-actions">
          <button
            className="button secondary"
            type="button"
            onClick={onCancel}
            disabled={busy}
          >
            {t("common.cancel")}
          </button>
          <button
            className="button primary"
            type="button"
            onClick={onConfirm}
            disabled={busy || !actor.trim() || !reason.trim()}
          >
            {busy ? (
              <LoaderCircle className="spin" size={14} />
            ) : applying ? (
              <ArchiveRestore size={14} />
            ) : (
              <RotateCcw size={14} />
            )}
            {applying
              ? t("curation.applyAction")
              : t("curation.rollbackAction")}
          </button>
        </div>
      </section>
    </div>
  );
}

function truncate(value: string): string {
  return value.length > 100 ? `${value.slice(0, 97)}...` : value;
}

function shortId(value: string): string {
  return value.length > 12 ? value.slice(0, 8) : value;
}
