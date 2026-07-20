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
      setNotice(
        `QA checked ${next.checkedSegments.toLocaleString("en-US")} segments.`,
      );
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
        `Saved ${format.toUpperCase()} report as ${fileName(report.outputPath)}.`,
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
      setNotice(
        required
          ? "Mandatory review is enabled."
          : "Direct sign-off is enabled with actor and reason required.",
      );
    } catch (reasonValue) {
      setError(formatError(reasonValue));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="surface-main qa-workspace" aria-busy={loading || busy}>
      <section className="qa-commandbar" aria-label="QA controls">
        <div>
          <span className="surface-kicker">Quality system</span>
          <h1>QA and review</h1>
          <p>{document.name}</p>
        </div>
        <label>
          <span>Profile</span>
          <select
            value={profileId}
            onChange={(event) => setProfileId(event.currentTarget.value)}
          >
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
                {profile.builtIn ? " · built-in" : ""}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>Scope</legend>
          <button
            type="button"
            className={scope === "document" ? "active" : undefined}
            onClick={() => setScope("document")}
          >
            Document
          </button>
          <button
            type="button"
            className={scope === "project" ? "active" : undefined}
            onClick={() => setScope("project")}
          >
            Project
          </button>
        </fieldset>
        <button
          type="button"
          className="button primary"
          disabled={busy || !profileId}
          onClick={() => void runQa()}
        >
          <RefreshCw size={15} className={busy ? "spin" : undefined} />
          Run QA
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
          Edit profile
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
          <span>Mandatory review</span>
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

      <section className="qa-summary-strip" aria-label="Latest QA run">
        <Summary label="Errors" value={run?.errors ?? 0} tone="error" />
        <Summary label="Warnings" value={run?.warnings ?? 0} tone="warning" />
        <Summary label="Info" value={run?.info ?? 0} tone="info" />
        <Summary label="Waived" value={run?.waived ?? 0} />
        <div className="qa-run-meta">
          <span>
            {run
              ? `${run.profileName} · revision ${run.profileRevision}`
              : "No completed run"}
          </span>
          <strong>
            {run
              ? `${run.checkedSegments.toLocaleString("en-US")} checked`
              : "Run QA to create a snapshot"}
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
        <aside className="qa-filter-rail" aria-label="Issue filters">
          <header>
            <Filter size={15} />
            <strong>Findings</strong>
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
            Reset filters
          </button>
        </aside>

        <div className="qa-issue-column">
          {loading ? (
            <QaSkeleton />
          ) : issues.length ? (
            <div
              className="qa-issue-list"
              role="listbox"
              aria-label="QA findings"
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
              <strong>No findings match</strong>
              <span>Change filters or run QA again.</span>
            </div>
          )}
          <footer className="qa-pagination">
            <span>
              {issueTotal
                ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, issueTotal)} of ${issueTotal}`
                : "0 findings"}
            </span>
            <button
              type="button"
              aria-label="Previous issue page"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              <ArrowLeft size={14} />
            </button>
            <button
              type="button"
              aria-label="Next issue page"
              disabled={offset + PAGE_SIZE >= issueTotal}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              <ArrowRight size={14} />
            </button>
          </footer>
        </div>

        <aside className="qa-detail" aria-label="Finding detail">
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
                {selected.documentName} · Segment {selected.segmentOrdinal + 1}
              </p>
              <Evidence issue={selected} />
              <button
                type="button"
                className="button primary"
                onClick={() => onOpenSegment(selected.segmentId)}
              >
                <ExternalLink size={14} />
                Open segment
              </button>
              {selected.disposition === "waived" && selected.waiver ? (
                <div className="qa-waiver">
                  <span>Waived by {selected.waiver.actor}</span>
                  <p>{selected.waiver.reason}</p>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void revokeIssue()}
                  >
                    <Undo2 size={14} />
                    Revoke waiver
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy || selected.disposition !== "open"}
                  onClick={() => setWaiveOpen(true)}
                >
                  Waive finding
                </button>
              )}
            </>
          ) : (
            <div className="surface-empty">
              <ShieldAlert size={22} />
              <strong>Select a finding</strong>
              <span>Evidence and actions appear here.</span>
            </div>
          )}
        </aside>
      </section>

      <section className="review-band" aria-label="Review statistics and queue">
        <div className="review-stats">
          <span className="surface-kicker">Review state</span>
          <h2>
            {stats
              ? `${stats.signedSegments} signed · ${stats.reviewSegments} in review`
              : "Loading review state"}
          </h2>
          <dl>
            <div>
              <dt>Translation</dt>
              <dd>{stats?.translationSegments ?? 0}</dd>
            </div>
            <div>
              <dt>Pending proposals</dt>
              <dd>{stats?.pendingRevisions ?? 0}</dd>
            </div>
            <div>
              <dt>Accepted</dt>
              <dd>{stats?.acceptedRevisions ?? 0}</dd>
            </div>
            <div>
              <dt>Rejected</dt>
              <dd>{stats?.rejectedRevisions ?? 0}</dd>
            </div>
            <div>
              <dt>Reviewed chars</dt>
              <dd>{stats?.reviewedCharacters ?? 0}</dd>
            </div>
          </dl>
        </div>
        <div className="review-queue">
          <header>
            <div>
              <span className="surface-kicker">Reviewer queue</span>
              <h2>
                {queue.length
                  ? `${queue.length} pending proposals`
                  : "Queue clear"}
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
            <p>No pending revision proposals in this document.</p>
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
            <span className="surface-kicker">False positive decision</span>
            <h2 id="waive-title">Waive this finding</h2>
            <p>{selected.message}</p>
            <label>
              Actor
              <input
                autoFocus
                value={actor}
                onChange={(event) => setActor(event.currentTarget.value)}
              />
            </label>
            <label>
              Reason
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
                Cancel
              </button>
              <button
                type="button"
                className="button primary"
                disabled={!actor.trim() || !reason.trim() || busy}
                onClick={() => void waiveIssue()}
              >
                Record waiver
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
  return (
    <label>
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        <option value="all">All</option>
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
  return (
    <div className="qa-skeleton" aria-label="Loading findings">
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}
function Evidence({ issue }: { issue: QaIssueView }) {
  const values = [
    ...(issue.evidence.sourceValues ?? []),
    ...(issue.evidence.targetValues ?? []),
    ...(issue.evidence.sourceNumbers ?? []),
    ...(issue.evidence.targetNumbers ?? []),
  ];
  return (
    <div className="qa-evidence-detail">
      <span>Evidence</span>
      {values.length ? (
        values
          .slice(0, 8)
          .map((value, index) => <code key={`${value}-${index}`}>{value}</code>)
      ) : (
        <p>No text evidence is required for this rule.</p>
      )}
      {issue.evidence.relatedSegmentIds?.length ? (
        <p>{issue.evidence.relatedSegmentIds.length} related segment(s)</p>
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
              {profile.builtIn ? "Clone profile" : "Custom profile"}
            </span>
            <h2 id="profile-title">Profile rules</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close profile editor"
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
          Name
          <input
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <label>
          Maximum target characters
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
          <p className="profile-note">
            Built-in profiles are immutable. Saving creates a project-owned
            clone that you can edit.
          </p>
        ) : (
          <>
            <div className="profile-rules-heading">
              <strong>Custom regex rules</strong>
              <button
                type="button"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    regexRules: [
                      ...(current.regexRules ?? []),
                      newRegexRule(current.regexRules?.length ?? 0),
                    ],
                  }))
                }
              >
                <Plus size={13} />
                Add rule
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
                    Label
                    <input
                      value={rule.label}
                      onChange={(event) =>
                        updateRule(index, { label: event.currentTarget.value })
                      }
                    />
                  </label>
                  <label>
                    Field
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
                    Severity
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
                    Pattern
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
                    Message
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
                    Replacement hint
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
                    aria-label={`Remove ${rule.label}`}
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
            Cancel
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!name.trim() || busy}
            onClick={() => void save()}
          >
            {profile.builtIn ? "Clone profile" : "Save profile"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function newRegexRule(index: number): QaRegexRule {
  return {
    id: `custom.rule.${index + 1}`,
    label: "Custom rule",
    field: "target",
    pattern: "",
    severity: "warning",
    message: "Custom pattern matched",
    replacementHint: null,
  };
}
