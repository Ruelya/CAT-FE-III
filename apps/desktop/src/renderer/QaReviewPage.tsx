import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  QaCategory,
  QaField,
  QaIssueDisposition,
  QaIssueView,
  QaProfile,
  QaProfileDefinition,
  QaRegexRule,
  QaReportFormat,
  QaRun,
  QaSeverity,
  ReviewQueueItem,
  ReviewStatistics,
} from "@translunar/contracts";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  ExternalLink,
  Filter,
  PencilLine,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Undo2,
} from "lucide-react";

import type { WorkspacePageProps } from "./WorkbenchPages";
import { fileName, formatError } from "./workbench-utils";
import { useLocale } from "./i18n/LocaleProvider";

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
const SEVERITIES: QaSeverity[] = ["error", "warning", "info"];
const DISPOSITIONS: QaIssueDisposition[] = ["open", "waived", "resolved"];

interface Filters {
  severity: "all" | QaSeverity;
  category: "all" | QaCategory;
  disposition: "all" | QaIssueDisposition;
}

export function QaReviewPage(props: WorkspacePageProps) {
  const { t } = useLocale();

  const { snapshot, document, onOpenSegment, onRefresh } = props;
  const projectId = snapshot.project.id;
  const [profiles, setProfiles] = useState<QaProfile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [scope, setScope] = useState<"document" | "project">("document");
  const [run, setRun] = useState<QaRun | null>(null);
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
        limit: 1,
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
    setRun(runPage.items[0] ?? null);
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
      setRun(next);
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

  return (
    <main className="surface-main qa-workspace" aria-busy={loading || busy}>
      <section className="qa-commandbar" aria-label={t("qa.controlsAria")}>
        <div>
          <span className="surface-kicker">{t("qa.kicker")}</span>
          <h1>{t("qa.title")}</h1>
          <p>{document.name}</p>
        </div>
        <label>
          <span>{t("common.profile")}</span>
          <select
            value={profileId}
            onChange={(event) => setProfileId(event.currentTarget.value)}
          >
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
                {profile.builtIn ? ` · ${t("qa.builtIn")}` : ""}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>{t("common.scope")}</legend>
          <button
            type="button"
            className={scope === "document" ? "active" : undefined}
            onClick={() => setScope("document")}
          >
            {t("qa.documentScope")}
          </button>
          <button
            type="button"
            className={scope === "project" ? "active" : undefined}
            onClick={() => setScope("project")}
          >
            {t("qa.projectScope")}
          </button>
        </fieldset>
        <button
          type="button"
          className="button primary"
          disabled={busy || !profileId}
          onClick={() => void runQa()}
        >
          <RefreshCw size={15} className={busy ? "spin" : undefined} />
          {t("qa.run")}
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={!profiles.find((item) => item.id === profileId)}
          onClick={() =>
            setEditorProfile(
              profiles.find((item) => item.id === profileId) ?? null,
            )
          }
        >
          <PencilLine size={14} />
          {t("qa.editProfile")}
        </button>
        <label className="qa-review-policy">
          <input
            type="checkbox"
            checked={reviewRequired}
            disabled={busy}
            onChange={(event) =>
              void updateReviewRequirement(event.currentTarget.checked)
            }
          />
          <span>{t("qa.mandatoryReview")}</span>
        </label>
      </section>

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

      <section className="qa-summary-strip" aria-label={t("qa.latestRunAria")}>
        <Summary label={t("qa.errors")} value={run?.errors ?? 0} tone="error" />
        <Summary
          label={t("qa.warnings")}
          value={run?.warnings ?? 0}
          tone="warning"
        />
        <Summary label={t("qa.info")} value={run?.info ?? 0} tone="info" />
        <Summary label={t("qa.waived")} value={run?.waived ?? 0} />
        <div className="qa-run-meta">
          <span>
            {run
              ? `${run.profileName} · ${t("common.revision", {
                  revision: run.profileRevision,
                })}`
              : t("qa.noCompletedRun")}
          </span>
          <strong>
            {run
              ? t("qa.checked", { count: run.checkedSegments })
              : t("qa.runToCreate")}
          </strong>
        </div>
        <div className="qa-report-actions">
          <button
            type="button"
            disabled={!run || busy}
            onClick={() => void exportReport("html")}
          >
            <Download size={14} />
            HTML
          </button>
          <button
            type="button"
            disabled={!run || busy}
            onClick={() => void exportReport("xlsx")}
          >
            <Download size={14} />
            XLSX
          </button>
        </div>
      </section>

      <section className="qa-layout">
        <aside className="qa-filter-rail" aria-label={t("qa.filtersAria")}>
          <header>
            <Filter size={15} />
            <strong>{t("qa.findings")}</strong>
            <span>{issueTotal}</span>
          </header>
          <FilterSelect
            label="Severity"
            value={filters.severity}
            values={SEVERITIES}
            onChange={(value) =>
              setFilters((current) => ({
                ...current,
                severity: value as Filters["severity"],
              }))
            }
          />
          <FilterSelect
            label="Category"
            value={filters.category}
            values={CATEGORIES}
            onChange={(value) =>
              setFilters((current) => ({
                ...current,
                category: value as Filters["category"],
              }))
            }
          />
          <FilterSelect
            label="Disposition"
            value={filters.disposition}
            values={DISPOSITIONS}
            onChange={(value) =>
              setFilters((current) => ({
                ...current,
                disposition: value as Filters["disposition"],
              }))
            }
          />
          <button
            type="button"
            className="qa-clear-filters"
            onClick={() =>
              setFilters({
                severity: "all",
                category: "all",
                disposition: "open",
              })
            }
          >
            {t("qa.resetFilters")}
          </button>
        </aside>

        <div className="qa-issue-column">
          {loading ? (
            <QaSkeleton />
          ) : issues.length ? (
            <div
              className="qa-issue-list"
              role="listbox"
              aria-label={t("qa.findingsAria")}
            >
              {issues.map((issue) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={issue.id === selectedId}
                  className={`qa-issue-row severity-${issue.severity}`}
                  key={issue.id}
                  onClick={() => setSelectedId(issue.id)}
                >
                  <span className="qa-severity-dot" />
                  <span className="qa-row-location">
                    {issue.documentName} · {issue.segmentOrdinal + 1}
                  </span>
                  <strong>{issue.message}</strong>
                  <span>
                    {issue.category} · {issue.ruleId}
                  </span>
                  <em>{issue.disposition}</em>
                </button>
              ))}
            </div>
          ) : (
            <div className="surface-empty">
              <CheckCircle2 size={24} />
              <strong>{t("qa.noMatch")}</strong>
              <span>{t("qa.changeFilters")}</span>
            </div>
          )}
          <footer className="qa-pagination">
            <span>
              {issueTotal
                ? t("common.pageRange", {
                    start: offset + 1,
                    end: Math.min(offset + PAGE_SIZE, issueTotal),
                    total: issueTotal,
                  })
                : t("qa.noMatch")}
            </span>
            <button
              type="button"
              aria-label={t("qa.prevIssuePage")}
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              <ArrowLeft size={14} />
            </button>
            <button
              type="button"
              aria-label={t("qa.nextIssuePage")}
              disabled={offset + PAGE_SIZE >= issueTotal}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              <ArrowRight size={14} />
            </button>
          </footer>
        </div>

        <aside className="qa-detail" aria-label={t("qa.detailAria")}>
          {selected ? (
            <>
              <header>
                <span
                  className={`qa-detail-severity severity-${selected.severity}`}
                >
                  <ShieldAlert size={15} />
                  {selected.severity}
                </span>
                <code>{selected.ruleId}</code>
              </header>
              <h2>{selected.message}</h2>
              <p>
                {selected.documentName} ·{" "}
                {t("qa.segmentOrdinal", {
                  ordinal: selected.segmentOrdinal + 1,
                })}
              </p>
              <Evidence issue={selected} />
              <button
                type="button"
                className="button primary"
                onClick={() => onOpenSegment(selected.segmentId)}
              >
                <ExternalLink size={14} />
                {t("qa.openSegment")}
              </button>
              {selected.disposition === "waived" && selected.waiver ? (
                <div className="qa-waiver">
                  <span>
                    {t("qa.waivedBy", { actor: selected.waiver.actor })}
                  </span>
                  <p>{selected.waiver.reason}</p>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void revokeIssue()}
                  >
                    <Undo2 size={14} />
                    {t("qa.revokeWaiver")}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy || selected.disposition !== "open"}
                  onClick={() => setWaiveOpen(true)}
                >
                  {t("qa.waiveFindingBtn")}
                </button>
              )}
            </>
          ) : (
            <div className="surface-empty">
              <ShieldAlert size={22} />
              <strong>{t("qa.selectFinding")}</strong>
              <span>{t("qa.evidenceHere")}</span>
            </div>
          )}
        </aside>
      </section>

      <section className="review-band" aria-label={t("qa.reviewBandAria")}>
        <div className="review-stats">
          <span className="surface-kicker">{t("qa.reviewState")}</span>
          <h2>
            {stats
              ? t("qa.reviewStats", {
                  signed: stats.signedSegments,
                  review: stats.reviewSegments,
                })
              : t("qa.loadingReview")}
          </h2>
          <dl>
            <div>
              <dt>{t("qa.translation")}</dt>
              <dd>{stats?.translationSegments ?? 0}</dd>
            </div>
            <div>
              <dt>{t("qa.pendingProposals")}</dt>
              <dd>{stats?.pendingRevisions ?? 0}</dd>
            </div>
            <div>
              <dt>{t("qa.accepted")}</dt>
              <dd>{stats?.acceptedRevisions ?? 0}</dd>
            </div>
            <div>
              <dt>{t("qa.rejected")}</dt>
              <dd>{stats?.rejectedRevisions ?? 0}</dd>
            </div>
            <div>
              <dt>{t("qa.reviewedChars")}</dt>
              <dd>{stats?.reviewedCharacters ?? 0}</dd>
            </div>
          </dl>
        </div>
        <div className="review-queue">
          <header>
            <div>
              <span className="surface-kicker">{t("qa.reviewerQueue")}</span>
              <h2>
                {queue.length
                  ? t("qa.pendingProposalCount", { count: queue.length })
                  : t("qa.queueClear")}
              </h2>
            </div>
          </header>
          {queue.length ? (
            queue.map((item) => (
              <button
                type="button"
                key={item.revision.id}
                onClick={() => onOpenSegment(item.revision.segmentId)}
              >
                <span>
                  {item.documentName} · {item.segmentOrdinal + 1}
                </span>
                <strong>{item.revision.author}</strong>
                <ArrowRight size={14} />
              </button>
            ))
          ) : (
            <p>{t("qa.noPendingProposals")}</p>
          )}
        </div>
      </section>

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
        <ProfileEditor
          profile={editorProfile}
          projectId={projectId}
          onClose={() => setEditorProfile(null)}
          onSaved={async (saved) => {
            setProfileId(saved.id);
            setEditorProfile(null);
            await onRefresh();
            await reload();
          }}
        />
      ) : null}
    </main>
  );
}

function Summary({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div className={tone ? `qa-summary-${tone}` : undefined}>
      <span>{label}</span>
      <strong>{value.toLocaleString("en-US")}</strong>
    </div>
  );
}
function FilterSelect({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string;
  values: readonly string[];
  onChange(value: string): void;
}) {
  const { t } = useLocale();
  return (
    <label>
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        <option value="all">{t("common.all")}</option>
        {values.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
    </label>
  );
}
function QaSkeleton() {
  const { t } = useLocale();
  return (
    <div className="qa-skeleton" aria-label={t("qa.loadingFindings")}>
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}
function Evidence({ issue }: { issue: QaIssueView }) {
  const { t } = useLocale();
  const values = [
    ...(issue.evidence.sourceValues ?? []),
    ...(issue.evidence.targetValues ?? []),
    ...(issue.evidence.sourceNumbers ?? []),
    ...(issue.evidence.targetNumbers ?? []),
  ];
  return (
    <div className="qa-evidence-detail">
      <span>{t("common.evidence")}</span>
      {values.length ? (
        values
          .slice(0, 8)
          .map((value, index) => <code key={`${value}-${index}`}>{value}</code>)
      ) : (
        <p>{t("qa.noEvidence")}</p>
      )}
      {issue.evidence.relatedSegmentIds?.length ? (
        <p>
          {t("qa.relatedSegmentCount", {
            count: issue.evidence.relatedSegmentIds.length,
          })}
        </p>
      ) : null}
    </div>
  );
}

function ProfileEditor({
  profile,
  projectId,
  onClose,
  onSaved,
}: {
  profile: QaProfile;
  projectId: string;
  onClose(): void;
  onSaved(saved: QaProfile): Promise<void>;
}) {
  const { t } = useLocale();
  const [draft, setDraft] = useState<QaProfileDefinition>(() =>
    structuredClone(profile.definition),
  );
  const [name, setName] = useState(
    profile.builtIn ? `${profile.name} custom` : profile.name,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rules = draft.regexRules ?? [];
  const updateRule = (index: number, patchValue: Partial<QaRegexRule>) =>
    setDraft((current) => ({
      ...current,
      regexRules: (current.regexRules ?? []).map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...patchValue } : rule,
      ),
    }));
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const saved = profile.builtIn
        ? await window.translunar.invoke("qa.profile.clone", {
            profileId: profile.id,
            ownerProjectId: projectId,
            name: name.trim(),
          })
        : await window.translunar.invoke("qa.profile.update", {
            profileId: profile.id,
            expectedRevision: profile.revision,
            name: name.trim(),
            definition: { ...draft, name: name.trim() },
          });
      await onSaved(saved);
    } catch (reasonValue) {
      setError(formatError(reasonValue));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="surface-dialog-backdrop">
      <section
        className="surface-dialog profile-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-title"
      >
        <header>
          <div>
            <span className="surface-kicker">
              {profile.builtIn ? t("qa.cloneProfile") : t("qa.customProfile")}
            </span>
            <h2 id="profile-title">{t("qa.profileRules")}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={t("qa.closeEditor")}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {error ? (
          <p className="surface-error" role="alert">
            {error}
          </p>
        ) : null}
        <label>
          {t("qa.name")}
          <input
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <label>
          {t("qa.maxTargetChars")}
          <input
            type="number"
            min="1"
            value={draft.settings.maxTargetChars ?? ""}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                settings: {
                  ...current.settings,
                  maxTargetChars: event.currentTarget.value
                    ? Number(event.currentTarget.value)
                    : null,
                },
              }))
            }
          />
        </label>
        {profile.builtIn ? (
          <p className="profile-note">{t("qa.builtinImmutable")}</p>
        ) : (
          <>
            <div className="profile-rules-heading">
              <strong>{t("qa.customRegex")}</strong>
              <button
                type="button"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    regexRules: [
                      ...(current.regexRules ?? []),
                      newRegexRule(
                        current.regexRules?.length ?? 0,
                        t("qa.customRule"),
                        t("qa.customPattern"),
                      ),
                    ],
                  }))
                }
              >
                <Plus size={13} />
                {t("qa.addRule")}
              </button>
            </div>
            <div className="profile-rules">
              {rules.map((rule, index) => (
                <article key={`${rule.id}-${index}`}>
                  <label>
                    ID
                    <input
                      value={rule.id}
                      onChange={(event) =>
                        updateRule(index, { id: event.currentTarget.value })
                      }
                    />
                  </label>
                  <label>
                    {t("qa.label")}
                    <input
                      value={rule.label}
                      onChange={(event) =>
                        updateRule(index, { label: event.currentTarget.value })
                      }
                    />
                  </label>
                  <label>
                    {t("qa.field")}
                    <select
                      value={rule.field}
                      onChange={(event) =>
                        updateRule(index, {
                          field: event.currentTarget.value as QaField,
                        })
                      }
                    >
                      <option value="source">source</option>
                      <option value="target">target</option>
                      <option value="both">both</option>
                    </select>
                  </label>
                  <label>
                    {t("common.severity")}
                    <select
                      value={rule.severity}
                      onChange={(event) =>
                        updateRule(index, {
                          severity: event.currentTarget.value as QaSeverity,
                        })
                      }
                    >
                      {SEVERITIES.map((severity) => (
                        <option key={severity}>{severity}</option>
                      ))}
                    </select>
                  </label>
                  <label className="wide">
                    {t("qa.pattern")}
                    <input
                      value={rule.pattern}
                      onChange={(event) =>
                        updateRule(index, {
                          pattern: event.currentTarget.value,
                        })
                      }
                    />
                  </label>
                  <label className="wide">
                    {t("qa.message")}
                    <input
                      value={rule.message}
                      onChange={(event) =>
                        updateRule(index, {
                          message: event.currentTarget.value,
                        })
                      }
                    />
                  </label>
                  <label className="wide">
                    {t("qa.replacementHint")}
                    <input
                      value={rule.replacementHint ?? ""}
                      onChange={(event) =>
                        updateRule(index, {
                          replacementHint: event.currentTarget.value || null,
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="profile-remove-rule"
                    aria-label={t("qa.removeRule", { label: rule.label })}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        regexRules: (current.regexRules ?? []).filter(
                          (_, ruleIndex) => ruleIndex !== index,
                        ),
                      }))
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </article>
              ))}
            </div>
          </>
        )}
        <footer>
          <button type="button" className="button secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!name.trim() || busy}
            onClick={() => void save()}
          >
            {profile.builtIn ? t("qa.cloneProfile") : t("qa.saveProfile")}
          </button>
        </footer>
      </section>
    </div>
  );
}

function newRegexRule(
  index: number,
  label: string,
  message: string,
): QaRegexRule {
  return {
    id: `custom.rule.${index + 1}`,
    label,
    field: "target",
    pattern: "",
    severity: "warning",
    message,
    replacementHint: null,
  };
}
