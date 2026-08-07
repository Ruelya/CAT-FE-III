import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  QaCategory,
  QaIssueDisposition,
  QaIssueView,
  QaProfile,
  QaReportFormat,
  QaRun,
  ReviewQueueItem,
  ReviewStatistics,
  Segment,
} from "@translunar/contracts";
import { CheckCircle2, Download, RefreshCw } from "lucide-react";

import { QaDistributionColumn } from "./components/quality/QaDistributionColumn";
import { QaEvidencePanel } from "./components/quality/QaEvidencePanel";
import { QaIssueList } from "./components/quality/QaIssueList";
import { QaProfileDrawer } from "./components/quality/QaProfileDrawer";
import { QaRunHistoryPopover } from "./components/quality/QaRunHistoryPopover";
import {
  buildSeverityMatrix,
  countSeverities,
  nextOpenIssueId,
} from "./components/quality/qa-presenters";
import type { WorkspacePageProps } from "./WorkbenchPages";
import { fileName, formatError } from "./workbench-utils";
import { useLocale } from "./i18n/LocaleProvider";
import type { MessageKey } from "./i18n/messages";
import { findQaRuleSnapshot } from "./plugin-provenance-utils";

const PAGE_SIZE = 30;
const CATEGORIES: QaCategory[] = [
  "completeness",
  "numbers",
  "tags",
  "punctuation",
  "whitespace",
  "repetition",
  "length",
  "terminology",
  "consistency",
  "custom",
];

interface Filters {
  severity: "all" | "error" | "warning" | "info";
  category: "all" | QaCategory;
  disposition: "all" | QaIssueDisposition;
}

export function QaReviewPage(props: WorkspacePageProps) {
  const { t, formatDate } = useLocale();
  const { snapshot, document, segments, onOpenSegment, onRefresh } = props;
  const projectId = snapshot.project.id;

  const [profiles, setProfiles] = useState<QaProfile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [scope, setScope] = useState<"document" | "project">("document");
  const [runs, setRuns] = useState<QaRun[]>([]);
  const [issues, setIssues] = useState<QaIssueView[]>([]);
  const [issueTotal, setIssueTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState<Filters>({
    severity: "all",
    category: "all",
    disposition: "open",
  });
  const [stats, setStats] = useState<ReviewStatistics | null>(null);
  const [queue, setQueue] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [waiveOpen, setWaiveOpen] = useState(false);
  const [actor, setActor] = useState("");
  const [reason, setReason] = useState("");
  const [editorProfile, setEditorProfile] = useState<QaProfile | null>(null);
  const [reviewRequired, setReviewRequired] = useState(
    snapshot.project.configuration.reviewRequired ?? true,
  );
  const [advanceAfterFix, setAdvanceAfterFix] = useState(false);

  const loadOverview = useCallback(async () => {
    const [profilePage, runPage, reviewStats, reviewQueue] = await Promise.all([
      window.translunar.invoke("qa.profile.list", {
        projectId,
        offset: 0,
        limit: 100,
      }),
      window.translunar.invoke("qa.run.list", {
        projectId,
        documentId: document.id,
        offset: 0,
        limit: 20,
      }),
      window.translunar.invoke("review.stats", {
        projectId,
        documentId: document.id,
      }),
      window.translunar.invoke("review.queue", {
        projectId,
        documentId: document.id,
        status: "pending",
        offset: 0,
        limit: 8,
      }),
    ]);
    setProfiles(profilePage.items);
    setProfileId(
      (current) =>
        current ||
        snapshot.project.configuration.qaProfileId ||
        profilePage.items[0]?.id ||
        "",
    );
    setRuns(runPage.items);
    setStats(reviewStats);
    setQueue(reviewQueue.items);
  }, [document.id, projectId, snapshot.project.configuration.qaProfileId]);

  const loadIssues = useCallback(async () => {
    const page = await window.translunar.invoke("qa.issue.list", {
      projectId,
      ...(scope === "document" ? { documentId: document.id } : {}),
      ...(filters.severity !== "all" ? { severity: filters.severity } : {}),
      ...(filters.category !== "all" ? { category: filters.category } : {}),
      ...(filters.disposition !== "all"
        ? { disposition: filters.disposition }
        : {}),
      offset,
      limit: PAGE_SIZE,
    });
    setIssues(page.items);
    setIssueTotal(page.total);
    setSelectedId((current) =>
      page.items.some((item) => item.id === current)
        ? current
        : (page.items[0]?.id ?? null),
    );
  }, [document.id, filters, offset, projectId, scope]);

  const reload = useCallback(async () => {
    setError(null);
    try {
      await Promise.all([loadOverview(), loadIssues()]);
    } catch (reasonValue) {
      setError(formatError(reasonValue));
    } finally {
      setLoading(false);
    }
  }, [loadIssues, loadOverview]);

  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    setOffset(0);
  }, [filters, scope]);

  const selected = useMemo(
    () => issues.find((item) => item.id === selectedId) ?? null,
    [issues, selectedId],
  );
  const run = runs[0] ?? null;
  const selectedPluginRule = useMemo(
    () => findQaRuleSnapshot(runs, selected),
    [runs, selected],
  );

  const matrixCells = useMemo(
    () =>
      buildSeverityMatrix(
        document.segmentCount || segments.length,
        issues,
        { maxCells: 2_000 },
      ),
    [document.segmentCount, issues, segments.length],
  );
  const severityCounts = useMemo(() => countSeverities(issues), [issues]);

  useEffect(() => {
    if (!advanceAfterFix) return;
    setAdvanceAfterFix(false);
    const next = nextOpenIssueId(issues, selectedId);
    if (next) setSelectedId(next);
  }, [advanceAfterFix, issues, selectedId]);

  async function runQa() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await window.translunar.invoke("qa.run", {
        projectId,
        ...(scope === "document" ? { documentId: document.id } : {}),
        ...(profileId ? { profileId } : {}),
      });
      await reload();
      setNotice(t("qa.checkedSegments", { count: next.checkedSegments }));
    } catch (reasonValue) {
      setError(formatError(reasonValue));
    } finally {
      setBusy(false);
    }
  }

  async function exportReport(format: QaReportFormat) {
    if (!run) return;
    const outputPath = await window.translunar.selectExportPath(
      `qa-${fileName(document.name)}-${run.id.slice(0, 8)}.${format}`,
    );
    if (!outputPath) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const report = await window.translunar.invoke("qa.report.export", {
        runId: run.id,
        format,
        outputPath,
      });
      setNotice(
        t("qa.reportSaved", {
          format: format.toUpperCase(),
          name: fileName(report.outputPath),
        }),
      );
    } catch (reasonValue) {
      setError(formatError(reasonValue));
    } finally {
      setBusy(false);
    }
  }

  async function waiveIssue() {
    if (!selected || !actor.trim() || !reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await window.translunar.invoke("qa.issue.waive", {
        issueId: selected.id,
        actor: actor.trim(),
        reason: reason.trim(),
      });
      setWaiveOpen(false);
      setReason("");
      await reload();
    } catch (reasonValue) {
      setError(formatError(reasonValue));
    } finally {
      setBusy(false);
    }
  }

  async function revokeIssue() {
    if (!selected?.waiver) return;
    setBusy(true);
    setError(null);
    try {
      await window.translunar.invoke("qa.issue.revoke", {
        issueId: selected.id,
        expectedRevision: selected.waiver.revision,
      });
      await reload();
    } catch (reasonValue) {
      setError(formatError(reasonValue));
    } finally {
      setBusy(false);
    }
  }

  async function updateReviewRequirement(required: boolean) {
    setBusy(true);
    setError(null);
    try {
      await window.translunar.invoke("project.update", {
        projectId,
        name: snapshot.project.name,
        sourceLocale: snapshot.project.sourceLocale,
        targetLocale: snapshot.project.targetLocale,
        domain: snapshot.project.domain,
        expectedRevision: snapshot.project.revision,
        actor: "QA review settings",
        configuration: {
          ...snapshot.project.configuration,
          reviewRequired: required,
        },
      });
      setReviewRequired(required);
      await onRefresh();
      setNotice(required ? t("qa.mandatoryEnabled") : t("qa.directSignOff"));
    } catch (reasonValue) {
      setError(formatError(reasonValue));
    } finally {
      setBusy(false);
    }
  }

  async function saveTarget(segment: Segment, targetText: string) {
    setBusy(true);
    setError(null);
    try {
      await window.translunar.invoke("segment.updateTarget", {
        segmentId: segment.id,
        targetText,
        expectedRevision: segment.revision,
      });
      await onRefresh();
      await loadIssues();
      setAdvanceAfterFix(true);
      setNotice(t("qa.fixSaved"));
    } catch (reasonValue) {
      const message = formatError(reasonValue);
      setError(message);
      throw new Error(message);
    } finally {
      setBusy(false);
    }
  }

  function onSelectOrdinal(ordinal: number) {
    const match = issues.find((item) => item.segmentOrdinal === ordinal);
    if (match) setSelectedId(match.id);
  }

  const noRun = !loading && !run;

  return (
    <main className="surface-main qa-ortho" aria-busy={loading || busy}>
      <header className="qa-ortho__header">
        <div>
          <h1>{t("qa.title")}</h1>
          <p className="qa-ortho__meta">
            {run
              ? t("qa.lastRunMeta", {
                  time: formatDate(run.createdAtMs),
                  count: run.checkedSegments,
                })
              : t("qa.noCompletedRun")}
          </p>
        </div>
        <div className="qa-ortho__header-actions">
          <QaRunHistoryPopover
            runs={runs}
            formatDate={formatDate}
            labels={{
              trigger: t("qa.runHistory"),
              title: t("qa.runHistoryTitle"),
              empty: t("qa.runHistoryEmpty"),
              errors: t("qa.errors"),
              warnings: t("qa.warnings"),
              info: t("qa.info"),
              checked: t("qa.checked"),
            }}
          />
          <button
            type="button"
            className="button secondary"
            disabled={!run || busy}
            onClick={() => void exportReport("html")}
          >
            <Download size={14} aria-hidden="true" />
            HTML
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={!run || busy}
            onClick={() => void exportReport("xlsx")}
          >
            <Download size={14} aria-hidden="true" />
            XLSX
          </button>
          <button
            type="button"
            className="button primary"
            disabled={busy || !profileId}
            onClick={() => void runQa()}
          >
            <RefreshCw size={15} aria-hidden="true" />
            {t("qa.run")}
          </button>
        </div>
      </header>

      {error ? (
        <p className="surface-error qa-banner" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="surface-success qa-banner" role="status">
          {notice}
        </p>
      ) : null}

      {noRun ? (
        <div className="surface-empty qa-ortho__empty">
          <CheckCircle2 size={28} aria-hidden="true" />
          <strong>{t("qa.noCompletedRun")}</strong>
          <span>{t("qa.runToCreate")}</span>
          <button
            type="button"
            className="button primary"
            disabled={busy || !profileId}
            onClick={() => void runQa()}
          >
            {t("qa.run")}
          </button>
        </div>
      ) : (
        <div className="qa-ortho__body">
          <QaDistributionColumn
            cells={matrixCells}
            counts={severityCounts}
            severityFilter={filters.severity}
            dispositionFilter={filters.disposition}
            categoryFilter={filters.category}
            scope={scope}
            categories={CATEGORIES}
            profiles={profiles}
            profileId={profileId}
            selectedOrdinal={selected?.segmentOrdinal ?? null}
            matrixTitle={t("qa.matrixTitle")}
            matrixCaption={t("qa.matrixCaption")}
            matrixAria={t("qa.matrixAria")}
            legend={{
              none: t("qa.matrixNone"),
              warn: t("qa.matrixWarn"),
              error: t("qa.matrixError"),
              waived: t("qa.matrixWaived"),
            }}
            labels={{
              distribution: t("qa.distribution"),
              errors: t("qa.errors"),
              warnings: t("qa.warnings"),
              info: t("qa.info"),
              waived: t("qa.waived"),
              scope: t("common.scope"),
              documentScope: t("qa.documentScope"),
              projectScope: t("qa.projectScope"),
              category: t("qa.category"),
              all: t("common.all"),
              profile: t("common.profile"),
              editProfile: t("qa.editProfile"),
              builtIn: t("qa.builtIn"),
            }}
            onSeverityFilter={(severity) =>
              setFilters((current) => ({ ...current, severity }))
            }
            onDispositionFilter={(disposition) =>
              setFilters((current) => ({ ...current, disposition }))
            }
            onCategoryFilter={(category) =>
              setFilters((current) => ({ ...current, category }))
            }
            onScope={setScope}
            onProfileId={setProfileId}
            onSelectOrdinal={onSelectOrdinal}
            onEditProfile={() =>
              setEditorProfile(
                profiles.find((item) => item.id === profileId) ?? null,
              )
            }
          />

          <QaIssueList
            issues={issues}
            selectedId={selectedId}
            issueTotal={issueTotal}
            offset={offset}
            pageSize={PAGE_SIZE}
            loading={loading}
            queue={queue}
            pluginRuleFor={(issue) => findQaRuleSnapshot(runs, issue)}
            categoryLabel={(category) =>
              t(`qa.category.${category}` as MessageKey)
            }
            severityLabel={(severity) =>
              t(`qa.severity.${severity}` as MessageKey)
            }
            labels={{
              findingsAria: t("qa.findingsAria"),
              noMatch: t("qa.noMatch"),
              changeFilters: t("qa.changeFilters"),
              prevPage: t("qa.prevIssuePage"),
              nextPage: t("qa.nextIssuePage"),
              pageRange: t("common.pageRange"),
              waived: t("qa.waived"),
              pluginFrom: t("qa.pluginFrom"),
              pendingProposals: t("qa.pendingProposals"),
              queueClear: t("qa.queueClear"),
              loading: t("qa.loadingFindings"),
            }}
            onSelect={setSelectedId}
            onOpenSegment={onOpenSegment}
            onOffset={setOffset}
            formatPageRange={(start, end, total) =>
              t("common.pageRange", { start, end, total })
            }
            pendingProposalCountLabel={(count) =>
              t("qa.pendingProposalCount", { count })
            }
          />

          <QaEvidencePanel
            issue={selected}
            segments={segments}
            pluginRule={selectedPluginRule}
            busy={busy}
            severityLabel={(severity) =>
              t(`qa.severity.${severity}` as MessageKey)
            }
            categoryLabel={(category) =>
              t(`qa.category.${category}` as MessageKey)
            }
            labels={{
              detailAria: t("qa.detailAria"),
              selectFinding: t("qa.selectFinding"),
              evidenceHere: t("qa.evidenceHere"),
              source: t("qa.sourceText"),
              target: t("qa.targetText"),
              noSource: t("qa.noSourceLoaded"),
              noTarget: t("qa.noTargetLoaded"),
              rule: t("qa.ruleMeta"),
              severity: t("common.severity"),
              locate: t("qa.locateSegment"),
              fixInPlace: t("qa.fixInPlace"),
              saveFix: t("qa.saveFix"),
              cancelFix: t("common.cancel"),
              waive: t("qa.waiveFindingBtn"),
              revokeWaiver: t("qa.revokeWaiver"),
              openRelated: t("qa.openRelated"),
              noEvidenceText: t("qa.noEvidence"),
              pluginOwner: t("qa.pluginOwner"),
              contribution: t("plugins.contribution"),
              fixHint: t("qa.fixHint"),
            }}
            formatWaivedBy={(actor) => t("qa.waivedBy", { actor })}
            formatRelated={(count) => t("qa.relatedSegmentCount", { count })}
            onOpenSegment={onOpenSegment}
            onStartWaive={() => setWaiveOpen(true)}
            onRevoke={() => void revokeIssue()}
            onSaveTarget={saveTarget}
          />
        </div>
      )}

      {stats ? (
        <p className="qa-ortho__review-meta micro">
          {t("qa.reviewStats", {
            signed: stats.signedSegments,
            review: stats.reviewSegments,
          })}
        </p>
      ) : null}

      {waiveOpen && selected ? (
        <div className="surface-dialog-backdrop" role="presentation">
          <section
            className="surface-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="waive-title"
          >
            <span className="surface-kicker">{t("qa.falsePositive")}</span>
            <h2 id="waive-title">{t("qa.waiveFinding")}</h2>
            <p>{selected.message}</p>
            <label>
              {t("common.actor")}
              <input
                autoFocus
                value={actor}
                onChange={(event) => setActor(event.currentTarget.value)}
              />
            </label>
            <label>
              {t("common.reason")}
              <textarea
                value={reason}
                onChange={(event) => setReason(event.currentTarget.value)}
              />
            </label>
            <footer>
              <button
                type="button"
                className="button secondary"
                onClick={() => setWaiveOpen(false)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="button primary"
                disabled={!actor.trim() || !reason.trim() || busy}
                onClick={() => void waiveIssue()}
              >
                {t("qa.recordWaiver")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {editorProfile ? (
        <QaProfileDrawer
          profile={editorProfile}
          projectId={projectId}
          reviewRequired={reviewRequired}
          busy={busy}
          labels={{
            title: t("qa.profileRules"),
            cloneProfile: t("qa.cloneProfile"),
            customProfile: t("qa.customProfile"),
            name: t("qa.name"),
            maxTargetChars: t("qa.maxTargetChars"),
            builtinImmutable: t("qa.builtinImmutable"),
            customRegex: t("qa.customRegex"),
            addRule: t("qa.addRule"),
            label: t("qa.label"),
            field: t("qa.field"),
            severity: t("common.severity"),
            pattern: t("qa.pattern"),
            message: t("qa.message"),
            replacementHint: t("qa.replacementHint"),
            removeRule: t("qa.removeRule"),
            cancel: t("common.cancel"),
            save: t("qa.saveProfile"),
            clone: t("qa.cloneProfile"),
            close: t("qa.closeEditor"),
            mandatoryReview: t("qa.mandatoryReview"),
            customRule: t("qa.customRule"),
            customPattern: t("qa.customPattern"),
          }}
          onClose={() => setEditorProfile(null)}
          onSaved={async (saved) => {
            setProfileId(saved.id);
            setEditorProfile(null);
            await onRefresh();
            await reload();
          }}
          onReviewRequired={(required) => void updateReviewRequirement(required)}
        />
      ) : null}
    </main>
  );
}
