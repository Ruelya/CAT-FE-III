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
        `${result.run.mode === "provider" ? "Provider" : "Offline"} curation run completed for ${result.total} unit(s).`,
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
      setNotice(
        `Applied curation: ${result.quarantinedUnitCount} unit(s) quarantined.`,
      );
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
      setNotice(`Rollback restored ${result.restoredUnitCount} unit(s).`);
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
        `Exported ${result.rowCount} active unit(s) as ${result.format.toUpperCase()}.`,
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
      setNotice("Curation state refreshed from Engine.");
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
          eyebrow="Asset catalog"
          title="Unified asset catalog"
          actions={
            <button
              className="icon-button"
              type="button"
              title="Refresh curation state"
              aria-label="Refresh curation state"
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
            aria-label="Catalog scope"
          >
            <button
              type="button"
              aria-pressed={catalogDraft.scope === "project"}
              onClick={() => updateDraft("scope", "project")}
              disabled={isBusy}
            >
              <ShieldCheck size={13} /> Project
            </button>
            <button
              type="button"
              aria-pressed={catalogDraft.scope === "global"}
              onClick={() => updateDraft("scope", "global")}
              disabled={isBusy}
            >
              <Database size={13} /> Global
            </button>
          </div>
          <div className="asset-curation-filter-grid">
            <Field label="Asset kind">
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
                <option value="all">All assets</option>
                <option value="tm">Translation memory</option>
                <option value="termbase">Termbase</option>
                <option value="corpus">Reference corpus</option>
              </select>
            </Field>
            <Field label="Source locale">
              <input
                value={catalogDraft.sourceLocale}
                onChange={(event) =>
                  updateDraft("sourceLocale", event.currentTarget.value)
                }
                placeholder={snapshot.project.sourceLocale}
                disabled={isBusy}
              />
            </Field>
            <Field label="Target locale">
              <input
                value={catalogDraft.targetLocale}
                onChange={(event) =>
                  updateDraft("targetLocale", event.currentTarget.value)
                }
                placeholder={snapshot.project.targetLocale}
                disabled={isBusy}
              />
            </Field>
            <Field label="Domain">
              <input
                value={catalogDraft.domain}
                onChange={(event) =>
                  updateDraft("domain", event.currentTarget.value)
                }
                placeholder="Any domain"
                disabled={isBusy}
              />
            </Field>
            <Field label="Query">
              <input
                value={catalogDraft.query}
                onChange={(event) =>
                  updateDraft("query", event.currentTarget.value)
                }
                placeholder="Source or target text"
                disabled={isBusy}
              />
            </Field>
            <div className="asset-curation-filter-actions">
              <button
                className="button primary"
                type="submit"
                disabled={isBusy}
              >
                <Search size={14} /> Apply filters
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={resetCatalogFilters}
                disabled={isBusy}
              >
                <Filter size={14} /> Reset
              </button>
            </div>
            <Field label="Origin project ID">
              <input
                value={catalogDraft.originProjectId}
                onChange={(event) =>
                  updateDraft("originProjectId", event.currentTarget.value)
                }
                placeholder="Optional"
                disabled={isBusy}
              />
            </Field>
            <Field label="Origin document ID">
              <input
                value={catalogDraft.originDocumentId}
                onChange={(event) =>
                  updateDraft("originDocumentId", event.currentTarget.value)
                }
                placeholder="Optional"
                disabled={isBusy}
              />
            </Field>
            <Field label="Created after">
              <input
                type="date"
                value={catalogDraft.createdAfter}
                onChange={(event) =>
                  updateDraft("createdAfter", event.currentTarget.value)
                }
                disabled={isBusy}
              />
            </Field>
            <Field label="Created before">
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
          <LoadingState label="Loading asset catalog" />
        ) : !catalogHasItems ? (
          <EmptyState
            title="No catalog rows"
            detail="No assets match the current scope and filters."
          />
        ) : (
          <>
            <CatalogTable items={catalogPage?.items ?? []} />
            <Pagination
              ariaLabel="Asset catalog pages"
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
          eyebrow="Curation run"
          title="Analyze one TM library"
          actions={
            <span className="asset-curation-revision">
              {selectedLibrary
                ? `Library revision ${selectedLibrary.revision}`
                : "No library selected"}
            </span>
          }
        />
        <div className="asset-curation-run-controls">
          <Field label="TM library">
            <select
              value={libraryId}
              onChange={(event) => setLibraryId(event.currentTarget.value)}
              disabled={isBusy || loading}
            >
              <option value="">Select a TM library</option>
              {libraries.map((library) => (
                <option key={library.id} value={library.id}>
                  {library.name} · {library.sourceLocale} to{" "}
                  {library.targetLocale}
                  {library.writable ? "" : " · read only"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Semantic provider">
            <select
              value={providerProfileId}
              onChange={(event) =>
                setProviderProfileId(event.currentTarget.value)
              }
              disabled={isBusy || loading}
            >
              <option value="">Offline deterministic checks</option>
              {providerOptions.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name} · {provider.model}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Actor">
            <input
              value={actor}
              onChange={(event) => setActor(event.currentTarget.value)}
              maxLength={256}
              disabled={isBusy}
            />
          </Field>
          <Field label="Reason">
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
            <span className="surface-kicker">Policy</span>
            <strong>Deterministic thresholds</strong>
          </div>
          <span>All values are sent to Engine with this run.</span>
        </div>
        <div className="asset-curation-policy-grid">
          <NumberField
            label="Minimum chars"
            value={policy.minimumChars}
            min={1}
            max={1_000_000}
            onChange={(value) => updatePolicy("minimumChars", value)}
            disabled={isBusy}
          />
          <NumberField
            label="Minimum ratio %"
            value={policy.minimumLengthRatioPercent}
            min={1}
            max={10_000}
            onChange={(value) =>
              updatePolicy("minimumLengthRatioPercent", value)
            }
            disabled={isBusy}
          />
          <NumberField
            label="Maximum ratio %"
            value={policy.maximumLengthRatioPercent}
            min={1}
            max={10_000}
            onChange={(value) =>
              updatePolicy("maximumLengthRatioPercent", value)
            }
            disabled={isBusy}
          />
          <NumberField
            label="Near duplicate %"
            value={policy.nearDuplicateThreshold}
            min={1}
            max={99}
            onChange={(value) => updatePolicy("nearDuplicateThreshold", value)}
            disabled={isBusy}
          />
          <NumberField
            label="Semantic score bp"
            value={policy.semanticAlignmentThresholdBasisPoints}
            min={0}
            max={10_000}
            onChange={(value) =>
              updatePolicy("semanticAlignmentThresholdBasisPoints", value)
            }
            disabled={isBusy}
          />
          <NumberField
            label="Quarantine score bp"
            value={policy.quarantineThresholdBasisPoints}
            min={0}
            max={10_000}
            onChange={(value) =>
              updatePolicy("quarantineThresholdBasisPoints", value)
            }
            disabled={isBusy}
          />
          <NumberField
            label="Minimum term frequency"
            value={policy.minimumTermFrequency}
            min={2}
            max={10_000}
            onChange={(value) => updatePolicy("minimumTermFrequency", value)}
            disabled={isBusy}
          />
          <Field label="Created after">
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
          <Field label="Created before">
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
            Analyze library
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={() => void refreshAuthoritative()}
            disabled={isBusy}
          >
            <RefreshCw size={14} /> Refresh revisions
          </button>
        </div>
        {stale ? (
          <div className="asset-curation-stale" role="alert">
            <AlertTriangle size={15} />
            <span>
              Engine revisions changed. Refresh before retrying a mutation.
            </span>
            <button
              className="button secondary"
              type="button"
              onClick={() => void refreshAuthoritative()}
              disabled={isBusy}
            >
              Reload authoritative state
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
                {runStatus === "rolledBack" ? "Rolled back" : runStatus}
              </span>
              <span>
                {run.run.mode === "provider"
                  ? "Provider refinement"
                  : "Offline analysis"}
              </span>
              <span>Base library revision {run.run.baseLibraryRevision}</span>
              <span>Run revision {run.run.revision}</span>
              <span>Actor {run.run.actor}</span>
            </div>
          </section>

          <section className="insights-section asset-curation-findings-section">
            <PanelHeading
              icon={<ShieldCheck size={16} />}
              eyebrow="Explainable findings"
              title="Review and select changes"
              actions={
                <div className="asset-curation-section-actions">
                  <span>{selectedCount} selected</span>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={selectVisibleFindings}
                    disabled={isBusy || selectableFindings.length === 0}
                  >
                    <Check size={14} /> Select visible
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={clearSelection}
                    disabled={isBusy || selectedCount === 0}
                  >
                    <X size={14} /> Clear
                  </button>
                </div>
              }
            />
            {findingLoading ? (
              <LoadingState label="Loading curation findings" />
            ) : !runHasFindings ? (
              <EmptyState
                title="No findings on this page"
                detail="The run completed without findings in the current page."
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
                  ariaLabel="Curation finding pages"
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
                eyebrow="Score projection"
                title="Analyzed units"
              />
              {runLoading ? (
                <LoadingState label="Loading analyzed units" />
              ) : (
                <>
                  <RunUnitsTable units={run.units} />
                  <Pagination
                    ariaLabel="Analyzed unit pages"
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
              eyebrow="Revision-safe actions"
              title="Apply, rollback, and export"
            />
            <div className="asset-curation-action-grid">
              <div className="asset-curation-action-copy">
                <strong>Selected findings</strong>
                <span>
                  {selectedCount} quarantine candidate(s) selected across pages.
                </span>
              </div>
              <button
                className="button primary"
                type="button"
                onClick={() => setDialog("apply")}
                disabled={!canApply || isBusy}
              >
                <ShieldCheck size={14} /> Apply selected
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => setDialog("rollback")}
                disabled={!canRollback || isBusy}
              >
                <RotateCcw size={14} /> Rollback run
              </button>
              <Field label="Export format">
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
              <Field label="Minimum score bp">
                <input
                  type="number"
                  min={0}
                  max={10_000}
                  value={minimumScore}
                  onChange={(event) =>
                    setMinimumScore(event.currentTarget.value)
                  }
                  placeholder="All active"
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
                Export clean dataset
              </button>
            </div>
            {exportPath ? (
              <p className="asset-curation-export-status" role="status">
                Last export: {exportPath}
              </p>
            ) : null}
          </section>
        </>
      ) : (
        <section className="asset-curation-empty-run" aria-live="polite">
          <Sparkles size={22} />
          <strong>No curation run yet</strong>
          <span>
            Select a library and analyze it to inspect scores and findings.
          </span>
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
  return (
    <div className="asset-curation-table-wrap">
      <table className="asset-curation-table" aria-label="Asset catalog rows">
        <thead>
          <tr>
            <th>Kind</th>
            <th>Collection</th>
            <th>Source</th>
            <th>Target</th>
            <th>Locale</th>
            <th>State</th>
            <th>Quality</th>
            <th>Provenance</th>
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
                {item.sourceLocale} to {item.targetLocale || "-"}
              </td>
              <td>{item.curationState ?? "-"}</td>
              <td>{formatBasisPoints(item.qualityScoreBasisPoints)}</td>
              <td>
                <small>
                  {item.originProjectId
                    ? `Project ${shortId(item.originProjectId)}`
                    : "Global"}
                  {item.originDocumentId
                    ? ` / document ${shortId(item.originDocumentId)}`
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
  return (
    <div className="asset-curation-table-wrap">
      <table
        className="asset-curation-table asset-curation-findings-table"
        aria-label="Curation findings"
      >
        <thead>
          <tr>
            <th>Select</th>
            <th>Severity</th>
            <th>Rule</th>
            <th>Score</th>
            <th>Disposition</th>
            <th>Evidence</th>
            <th>Provenance</th>
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
                    aria-label={`Select ${findingKindLabel(finding.kind)} finding ${shortId(finding.id)}`}
                    onChange={(event) =>
                      onToggle(finding, event.currentTarget.checked)
                    }
                  />
                </td>
                <td>
                  <span
                    className={`asset-curation-severity is-${finding.severity}`}
                  >
                    {severityLabel(finding.severity)}
                  </span>
                </td>
                <td>
                  <strong>{findingKindLabel(finding.kind)}</strong>
                  <small>{shortId(finding.id)}</small>
                </td>
                <td>
                  <strong>
                    {formatBasisPoints(finding.qualityScoreBasisPoints)}
                  </strong>
                  <small>
                    -{formatBasisPoints(finding.penaltyBasisPoints)}
                  </small>
                </td>
                <td>
                  <span
                    className={`asset-curation-disposition is-${finding.disposition}`}
                  >
                    {recommendationLabel(finding.disposition)}
                  </span>
                </td>
                <td>
                  <ul className="asset-curation-evidence-list">
                    {formatEvidence(finding.evidence).map((value) => (
                      <li key={value}>{value}</li>
                    ))}
                  </ul>
                  <small>{finding.explanation}</small>
                </td>
                <td>
                  <small>
                    Unit {shortId(finding.unitId)}
                    {catalogItem?.originDocumentId
                      ? ` / document ${shortId(catalogItem.originDocumentId)}`
                      : ""}
                    {catalogItem?.structuralPath
                      ? ` / ${catalogItem.structuralPath}`
                      : ""}
                    {runUnit ? ` / ${runUnit.recommendedAction}` : ""}
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
  return (
    <div className="asset-curation-table-wrap">
      <table
        className="asset-curation-table"
        aria-label="Analyzed curation units"
      >
        <thead>
          <tr>
            <th>Unit</th>
            <th>Score</th>
            <th>Recommendation</th>
            <th>Explanation</th>
          </tr>
        </thead>
        <tbody>
          {units.map((unit) => (
            <tr key={unit.unitId}>
              <td>
                <strong>{shortId(unit.unitId)}</strong>
                <small>{unit.unitSnapshotHash.slice(0, 12)}</small>
              </td>
              <td>{formatBasisPoints(unit.qualityScoreBasisPoints)}</td>
              <td>{recommendationLabel(unit.recommendedAction)}</td>
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
  const summary = run.run.summary.analysis;
  return (
    <div className="asset-curation-metric-strip">
      <Metric label="Analyzed" value={summary.analyzedUnits} />
      <Metric label="With findings" value={summary.unitsWithFindings} />
      <Metric label="Findings" value={summary.findingCount} />
      <Metric
        label="Quarantine candidates"
        value={summary.quarantineCandidates}
      />
      <Metric label="Term candidates" value={summary.termCandidateCount} />
      <Metric label="Drift groups" value={summary.driftGroupCount} />
    </div>
  );
}

function TermsAndDrift({ run }: { run: CurationRunSnapshot }) {
  const terms = run.run.summary.termCandidates;
  const drift = run.run.summary.driftGroups;
  return (
    <section className="insights-section asset-curation-intelligence-section">
      <PanelHeading
        icon={<Sparkles size={16} />}
        eyebrow="Language intelligence"
        title="Terms and drift"
      />
      <div className="asset-curation-intelligence-block">
        <h3>Term candidates</h3>
        {terms.length === 0 ? (
          <span className="asset-curation-muted">No bounded candidates.</span>
        ) : (
          <ul className="asset-curation-term-list">
            {terms.slice(0, 12).map((term) => (
              <li key={`${term.sourceTerm}:${term.targetTerm}`}>
                <strong>{term.sourceTerm}</strong>
                <span>{term.targetTerm}</span>
                <small>
                  {term.frequency} uses ·{" "}
                  {formatBasisPoints(term.agreementBasisPoints)} agreement
                </small>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="asset-curation-intelligence-block">
        <h3>Drift groups</h3>
        {drift.length === 0 ? (
          <span className="asset-curation-muted">
            No competing translations.
          </span>
        ) : (
          <ul className="asset-curation-drift-list">
            {drift.slice(0, 12).map((group) => (
              <li key={group.sourceKey}>
                <strong>{group.sourceText}</strong>
                <span>{group.targetVariants.join(" / ")}</span>
                <small>{group.unitIds.length} related unit(s)</small>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
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
  return (
    <nav className="asset-curation-pagination" aria-label={ariaLabel}>
      <button
        className="icon-button"
        type="button"
        title="Previous page"
        aria-label="Previous page"
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
        )}
      </span>
      <button
        className="icon-button"
        type="button"
        title="Next page"
        aria-label="Next page"
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
  const applying = kind === "apply";
  const title = applying ? "Apply curation selection" : "Rollback curation run";
  const description = applying
    ? `Quarantine ${selectedCount} explicitly selected finding(s) and update the score projection.`
    : "Restore every unit changed by this run from its recorded before image.";
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
            <span className="surface-kicker">Revision-safe mutation</span>
            <h2 id="asset-curation-dialog-title">{title}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            title="Close dialog"
            aria-label="Close dialog"
            onClick={onCancel}
            disabled={busy}
          >
            <X size={15} />
          </button>
        </div>
        <p>{description}</p>
        <label className="asset-curation-field">
          <span>Actor</span>
          <input
            value={actor}
            onChange={(event) => onActor(event.currentTarget.value)}
            maxLength={256}
            disabled={busy}
          />
        </label>
        <label className="asset-curation-field">
          <span>Reason</span>
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
            Cancel
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
            {applying ? "Apply selection" : "Rollback run"}
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
