import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import type {
  AiProviderProfile,
  AiRun,
  AlignmentLink,
  AlignmentManualLink,
  AlignmentSessionGetResult,
  AlignmentSessionPage,
  CorpusSearchResult,
  Document,
  ProjectSnapshot,
  ReferenceCorpus,
  ReferenceCorpusKind,
  ReferenceCorpusPage,
  ReferenceCorpusStatus,
  TmLibrary,
} from "@translunar/contracts";
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleX,
  Combine,
  Database,
  FileSearch,
  FolderOpen,
  GitCompareArrows,
  Link2,
  LoaderCircle,
  RefreshCw,
  Search,
  Sparkles,
  Split,
  Trash2,
  Unlink2,
  UploadCloud,
  X,
} from "lucide-react";

import {
  areLinksContiguous,
  formatCorpusProvenance,
  isTerminalAiRunStatus,
  mergedAlignmentReplacement,
  orderedSelectedLinks,
  splitAlignmentReplacement,
  unlinkedAlignmentReplacement,
} from "./alignment-corpus-utils";
import { fileName, formatError } from "./workbench-utils";
import "./AlignmentCorpusPanel.css";

type AlignmentCorpusMode = "alignment" | "corpora";
type AlignmentReplacementCommand = "link" | "merge" | "unlink" | "split";
type CorpusStatusFilter = ReferenceCorpusStatus | "all";

interface AlignmentCorpusPanelProps {
  snapshot: ProjectSnapshot;
  documents: Document[];
  onRefresh(): Promise<void>;
}

export function AlignmentCorpusPanel({
  snapshot,
  documents,
  onRefresh,
}: AlignmentCorpusPanelProps) {
  const [mode, setMode] = useState<AlignmentCorpusMode>("alignment");

  return (
    <div className="alignment-corpus-layout">
      <div
        className="alignment-corpus-mode-tabs"
        role="tablist"
        aria-label="Alignment and corpora mode"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "alignment"}
          onClick={() => setMode("alignment")}
        >
          <GitCompareArrows size={15} /> Alignment
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "corpora"}
          onClick={() => setMode("corpora")}
        >
          <BookOpen size={15} /> Reference corpora
        </button>
      </div>

      {mode === "alignment" ? (
        <AlignmentWorkflow
          snapshot={snapshot}
          documents={documents}
          onRefresh={onRefresh}
        />
      ) : (
        <CorpusWorkflow snapshot={snapshot} onRefresh={onRefresh} />
      )}
    </div>
  );
}

function AlignmentWorkflow({
  snapshot,
  documents,
  onRefresh,
}: AlignmentCorpusPanelProps) {
  const projectId = snapshot.project.id;
  const sourceLocale = snapshot.project.sourceLocale;
  const targetLocale = snapshot.project.targetLocale;
  const activeDocuments = useMemo(
    () => documents.filter((item) => item.status === "active"),
    [documents],
  );
  const [sourceDocumentId, setSourceDocumentId] = useState(
    activeDocuments[0]?.id ?? "",
  );
  const [targetDocumentId, setTargetDocumentId] = useState(
    activeDocuments[1]?.id ?? "",
  );
  const [sessions, setSessions] = useState<AlignmentSessionPage | null>(null);
  const [sessionOffset, setSessionOffset] = useState(0);
  const [detail, setDetail] = useState<AlignmentSessionGetResult | null>(null);
  const [selectedLinkIds, setSelectedLinkIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [libraries, setLibraries] = useState<TmLibrary[]>([]);
  const [libraryId, setLibraryId] = useState("");
  const [profiles, setProfiles] = useState<AiProviderProfile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [refinementRun, setRefinementRun] = useState<AiRun | null>(null);
  const [cancelingRefinement, setCancelingRefinement] = useState(false);
  const [alignmentCorpusName, setAlignmentCorpusName] = useState("");
  const [actor, setActor] = useState("desktop-user");
  const [reason, setReason] = useState("Review document alignment");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refinementPollRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const ids = activeDocuments.map((item) => item.id);
    setSourceDocumentId((current) =>
      ids.includes(current) ? current : (ids[0] ?? ""),
    );
    setTargetDocumentId((current) =>
      ids.includes(current) && current !== ids[0] ? current : (ids[1] ?? ""),
    );
  }, [activeDocuments]);

  const fetchSession = useCallback(
    async (sessionId: string, offset: number) => {
      let result = await window.translunar.invoke("alignment.session.get", {
        sessionId,
        offset,
        limit: 24,
      });
      if (result.total > 0 && result.links.length === 0 && offset > 0) {
        const lastOffset =
          Math.floor((result.total - 1) / result.limit) * result.limit;
        result = await window.translunar.invoke("alignment.session.get", {
          sessionId,
          offset: lastOffset,
          limit: result.limit,
        });
      }
      return result;
    },
    [],
  );

  const applySession = useCallback((result: AlignmentSessionGetResult) => {
    setDetail(result);
    setSelectedLinkIds(new Set());
    setRefinementRun(null);
  }, []);

  const loadSession = useCallback(
    async (sessionId: string, offset: number) => {
      const result = await fetchSession(sessionId, offset);
      applySession(result);
      return result;
    },
    [applySession, fetchSession],
  );

  const fetchSupport = useCallback(async () => {
    const [libraryPage, profilePage] = await Promise.all([
      window.translunar.invoke("tm.library.list", {
        projectId,
        offset: 0,
        limit: 500,
      }),
      window.translunar.invoke("ai.provider.list", {
        offset: 0,
        limit: 100,
      }),
    ]);
    const matchingLibraries = libraryPage.items.filter(
      (library) =>
        library.writable &&
        library.sourceLocale === sourceLocale &&
        library.targetLocale === targetLocale,
    );
    const availableProfiles = profilePage.items.filter(
      (profile) => profile.enabled && profile.credentialPresent,
    );
    return { matchingLibraries, availableProfiles };
  }, [projectId, sourceLocale, targetLocale]);

  const applySupport = useCallback(
    ({
      matchingLibraries,
      availableProfiles,
    }: Awaited<ReturnType<typeof fetchSupport>>) => {
      setLibraries(matchingLibraries);
      setLibraryId((current) =>
        matchingLibraries.some((library) => library.id === current)
          ? current
          : (matchingLibraries[0]?.id ?? ""),
      );
      setProfiles(availableProfiles);
      setProfileId((current) =>
        availableProfiles.some((profile) => profile.id === current)
          ? current
          : (availableProfiles[0]?.id ?? ""),
      );
    },
    [],
  );

  const loadSupport = useCallback(async () => {
    applySupport(await fetchSupport());
  }, [applySupport, fetchSupport]);

  const loadSessionPage = useCallback(
    async (offset: number, preferredSessionId?: string) => {
      const page = await window.translunar.invoke("alignment.session.list", {
        projectId,
        offset,
        limit: 20,
      });
      setSessions(page);
      setSessionOffset(page.offset);
      const selected =
        page.items.find((item) => item.id === preferredSessionId) ??
        page.items[0];
      if (selected) await loadSession(selected.id, 0);
      else {
        setDetail(null);
        setSelectedLinkIds(new Set());
      }
    },
    [loadSession, projectId],
  );

  useEffect(() => {
    let active = true;
    async function initialize(): Promise<void> {
      setLoading(true);
      setError(null);
      setSessions(null);
      setDetail(null);
      setSelectedLinkIds(new Set());
      setLibraries([]);
      setProfiles([]);
      setRefinementRun(null);
      try {
        const [page, support] = await Promise.all([
          window.translunar.invoke("alignment.session.list", {
            projectId,
            offset: 0,
            limit: 20,
          }),
          fetchSupport(),
        ]);
        const first = page.items[0];
        const firstDetail = first ? await fetchSession(first.id, 0) : null;
        if (!active) return;
        setSessions(page);
        setSessionOffset(page.offset);
        applySupport(support);
        if (firstDetail) applySession(firstDetail);
      } catch (reasonValue) {
        if (active) setError(formatError(reasonValue));
      } finally {
        if (active) setLoading(false);
      }
    }
    void initialize();
    return () => {
      active = false;
    };
  }, [applySession, applySupport, fetchSession, fetchSupport, projectId]);

  useEffect(
    () => () => {
      refinementPollRef.current?.abort();
    },
    [],
  );

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (reasonValue) {
      setError(formatError(reasonValue));
    } finally {
      setBusy(null);
    }
  };

  const refreshCurrent = async (
    sessionId = detail?.session.id,
    linkOffset = detail?.offset ?? 0,
  ) => {
    if (!sessionId) return;
    await Promise.all([
      loadSession(sessionId, linkOffset),
      (async () => {
        const page = await window.translunar.invoke("alignment.session.list", {
          projectId,
          offset: sessionOffset,
          limit: sessions?.limit ?? 20,
        });
        setSessions(page);
        setSessionOffset(page.offset);
      })(),
    ]);
  };

  const refreshAll = async () => {
    const preferredId = detail?.session.id;
    await Promise.all([
      onRefresh(),
      loadSupport(),
      loadSessionPage(sessionOffset, preferredId),
    ]);
  };

  const createSession = async () => {
    const sourceDocument = activeDocuments.find(
      (item) => item.id === sourceDocumentId,
    );
    const targetDocument = activeDocuments.find(
      (item) => item.id === targetDocumentId,
    );
    if (
      !sourceDocument ||
      !targetDocument ||
      sourceDocument.id === targetDocument.id
    )
      return;
    await run("create-session", async () => {
      const created = await window.translunar.invoke(
        "alignment.session.create",
        {
          projectId,
          sourceDocumentId: sourceDocument.id,
          targetDocumentId: targetDocument.id,
          expectedProjectRevision: snapshot.project.revision,
          expectedSourceDocumentRevision: sourceDocument.revision,
          expectedTargetDocumentRevision: targetDocument.revision,
          actor: actor.trim(),
          reason: reason.trim(),
        },
      );
      setSessionOffset(0);
      const page = await window.translunar.invoke("alignment.session.list", {
        projectId,
        offset: 0,
        limit: 20,
      });
      setSessions(page);
      await loadSession(created.session.id, 0);
      setNotice(
        `Created ${created.linkCount} candidates across ${created.workUnits.toLocaleString()} work units.`,
      );
    });
  };

  const selectedLinks = useMemo(
    () => orderedSelectedLinks(detail?.links ?? [], selectedLinkIds),
    [detail?.links, selectedLinkIds],
  );
  const contiguousSelection = areLinksContiguous(selectedLinks);
  const selectedConfirmed = selectedLinks.filter(
    (link) =>
      link.status === "confirmed" &&
      link.sourceSegmentIds.length > 0 &&
      link.targetSegmentIds.length > 0,
  );
  const selectedProposed = selectedLinks.filter(
    (link) => link.status === "proposed",
  );
  const hasSourceOnly = selectedLinks.some(
    (link) =>
      link.sourceSegmentIds.length > 0 && link.targetSegmentIds.length === 0,
  );
  const hasTargetOnly = selectedLinks.some(
    (link) =>
      link.targetSegmentIds.length > 0 && link.sourceSegmentIds.length === 0,
  );
  const sessionOpen = detail?.session.status === "open";
  const selectedLibrary = libraries.find((item) => item.id === libraryId);

  const toggleLink = (linkId: string, checked: boolean) => {
    setSelectedLinkIds((current) => {
      const next = new Set(current);
      if (checked) next.add(linkId);
      else next.delete(linkId);
      return next;
    });
  };

  const togglePage = (checked: boolean) => {
    setSelectedLinkIds(
      checked ? new Set(detail?.links.map((link) => link.id) ?? []) : new Set(),
    );
  };

  const replaceSelection = async (command: AlignmentReplacementCommand) => {
    if (
      !detail ||
      !hasAuditContext ||
      selectedLinks.length === 0 ||
      !contiguousSelection
    )
      return;
    let replacement: AlignmentManualLink[];
    if (command === "unlink") {
      const link = selectedLinks[0];
      if (!link) return;
      replacement = unlinkedAlignmentReplacement(link);
    } else if (command === "split") {
      const link = selectedLinks[0];
      if (!link) return;
      replacement = splitAlignmentReplacement(link);
    } else {
      replacement = mergedAlignmentReplacement(selectedLinks);
    }
    await run(`alignment-${command}`, async () => {
      const result = await window.translunar.invoke(
        "alignment.session.update",
        {
          sessionId: detail.session.id,
          expectedSessionRevision: detail.session.revision,
          mutation: {
            kind: "replaceLinks",
            links: selectedLinks.map((link) => ({
              linkId: link.id,
              expectedRevision: link.revision,
            })),
            replacement,
          },
          actor: actor.trim(),
          reason: reason.trim(),
        },
      );
      await refreshCurrent(result.session.id, detail.offset);
      setNotice(
        `${command[0]?.toUpperCase() ?? ""}${command.slice(1)} correction saved at session revision ${result.session.revision}.`,
      );
    });
  };

  const setLinkStatus = async (
    link: AlignmentLink,
    status: "confirmed" | "rejected",
  ) => {
    if (!detail || !hasAuditContext) return;
    await run(`status-${link.id}`, async () => {
      const result = await window.translunar.invoke(
        "alignment.session.update",
        {
          sessionId: detail.session.id,
          expectedSessionRevision: detail.session.revision,
          mutation: {
            kind: "setStatus",
            linkId: link.id,
            expectedLinkRevision: link.revision,
            status,
          },
          actor: actor.trim(),
          reason: reason.trim(),
        },
      );
      await refreshCurrent(result.session.id, detail.offset);
      setNotice(`Candidate ${link.ordinal + 1} marked ${status}.`);
    });
  };

  const refineSelection = async () => {
    if (
      !detail ||
      !hasAuditContext ||
      !profileId ||
      selectedProposed.length === 0
    )
      return;
    await run("refine", async () => {
      const started = await window.translunar.invoke(
        "alignment.session.refine",
        {
          sessionId: detail.session.id,
          expectedSessionRevision: detail.session.revision,
          links: selectedProposed.map((link) => ({
            linkId: link.id,
            expectedRevision: link.revision,
          })),
          profileId,
          maxAttempts: 3,
          actor: actor.trim(),
          reason: reason.trim(),
        },
      );
      setRefinementRun(started);
      refinementPollRef.current?.abort();
      const controller = new AbortController();
      refinementPollRef.current = controller;
      try {
        const completed = await waitForAiRun(
          started,
          setRefinementRun,
          controller.signal,
        );
        if (
          completed.status === "failed" ||
          completed.status === "interrupted"
        ) {
          throw new Error(
            completed.errorMessage ?? "Alignment refinement failed.",
          );
        }
        if (completed.status === "canceled") {
          setNotice(
            "Alignment refinement was canceled without changing links.",
          );
          return;
        }
        if (controller.signal.aborted) return;
        await refreshCurrent(detail.session.id, detail.offset);
        if (!controller.signal.aborted) {
          setNotice("AI suggestions are ready as proposed alignment links.");
        }
      } catch (reasonValue) {
        if (controller.signal.aborted) return;
        throw reasonValue;
      } finally {
        if (refinementPollRef.current === controller) {
          refinementPollRef.current = null;
        }
      }
    });
  };

  const cancelRefinement = async () => {
    const current = refinementRun;
    if (!current || isTerminalAiRunStatus(current.status)) return;
    setCancelingRefinement(true);
    setError(null);
    try {
      setRefinementRun(
        await window.translunar.invoke("ai.run.cancel", {
          runId: current.id,
          expectedRevision: current.revision,
        }),
      );
    } catch (reasonValue) {
      setError(formatError(reasonValue));
    } finally {
      setCancelingRefinement(false);
    }
  };

  const applyToTm = async () => {
    if (
      !detail ||
      !hasAuditContext ||
      !selectedLibrary ||
      selectedConfirmed.length === 0
    )
      return;
    await run("apply-tm", async () => {
      const result = await window.translunar.invoke("alignment.session.apply", {
        sessionId: detail.session.id,
        expectedSessionRevision: detail.session.revision,
        libraryId: selectedLibrary.id,
        expectedLibraryRevision: selectedLibrary.revision,
        links: selectedConfirmed.map((link) => ({
          linkId: link.id,
          expectedRevision: link.revision,
        })),
        actor: actor.trim(),
        reason: reason.trim(),
      });
      setNotice(
        `Applied ${result.insertedCount} TM units; ${result.duplicateCount} existing units were retained.`,
      );
      await Promise.all([
        refreshCurrent(result.sessionId, detail.offset),
        loadSupport(),
        onRefresh(),
      ]);
    });
  };

  const createCorpusFromAlignment = async () => {
    if (
      !detail ||
      !hasAuditContext ||
      selectedConfirmed.length === 0 ||
      !alignmentCorpusName.trim()
    )
      return;
    await run("alignment-corpus", async () => {
      const result = await window.translunar.invoke("corpus.fromAlignment", {
        projectId,
        expectedProjectRevision: snapshot.project.revision,
        sessionId: detail.session.id,
        expectedSessionRevision: detail.session.revision,
        links: selectedConfirmed.map((link) => ({
          linkId: link.id,
          expectedRevision: link.revision,
        })),
        name: alignmentCorpusName.trim(),
        actor: actor.trim(),
        reason: reason.trim(),
      });
      setAlignmentCorpusName("");
      setNotice(
        `Created ${result.corpus.name} with ${result.affectedEntryCount} bilingual entries.`,
      );
      await onRefresh();
    });
  };

  const sourceDocument = activeDocuments.find(
    (item) => item.id === sourceDocumentId,
  );
  const targetDocument = activeDocuments.find(
    (item) => item.id === targetDocumentId,
  );
  const canCreate =
    !!sourceDocument &&
    !!targetDocument &&
    sourceDocument.id !== targetDocument.id &&
    !!actor.trim() &&
    !!reason.trim();
  const hasAuditContext = !!actor.trim() && !!reason.trim();
  const canLink =
    sessionOpen &&
    hasAuditContext &&
    selectedLinks.length >= 2 &&
    contiguousSelection &&
    hasSourceOnly &&
    hasTargetOnly;
  const canMerge =
    sessionOpen &&
    hasAuditContext &&
    selectedLinks.length >= 2 &&
    contiguousSelection;
  const canUnlink =
    sessionOpen &&
    hasAuditContext &&
    selectedLinks.length === 1 &&
    selectedLinks[0]?.sourceSegmentIds.length !== 0 &&
    selectedLinks[0]?.targetSegmentIds.length !== 0;
  const canSplit =
    sessionOpen &&
    hasAuditContext &&
    selectedLinks.length === 1 &&
    Math.max(
      selectedLinks[0]?.sourceSegmentIds.length ?? 0,
      selectedLinks[0]?.targetSegmentIds.length ?? 0,
    ) > 1;

  return (
    <div className="alignment-workflow" aria-busy={loading || !!busy}>
      <form
        className="insights-section alignment-session-controls"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          void createSession();
        }}
      >
        <div className="alignment-control-heading">
          <div>
            <span className="surface-kicker">Revision-bound workspace</span>
            <h2>Document alignment</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            title="Refresh alignment workspace"
            aria-label="Refresh alignment workspace"
            onClick={() => void run("refresh", refreshAll)}
            disabled={loading || !!busy}
          >
            <RefreshCw size={15} />
          </button>
        </div>

        <div className="alignment-document-grid">
          <label className="alignment-field">
            <span>Source document</span>
            <select
              value={sourceDocumentId}
              onChange={(event) => {
                const next = event.currentTarget.value;
                setSourceDocumentId(next);
                if (next === targetDocumentId) {
                  setTargetDocumentId(
                    activeDocuments.find((item) => item.id !== next)?.id ?? "",
                  );
                }
              }}
              disabled={!!busy || activeDocuments.length < 2}
            >
              {activeDocuments.length < 2 ? (
                <option value="">Two active documents required</option>
              ) : (
                activeDocuments.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · rev {item.revision}
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="alignment-field">
            <span>Target document</span>
            <select
              value={targetDocumentId}
              onChange={(event) =>
                setTargetDocumentId(event.currentTarget.value)
              }
              disabled={!!busy || activeDocuments.length < 2}
            >
              {activeDocuments.length < 2 ? (
                <option value="">Two active documents required</option>
              ) : (
                activeDocuments.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · rev {item.revision}
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="alignment-field">
            <span>Actor</span>
            <input
              value={actor}
              onChange={(event) => setActor(event.currentTarget.value)}
              maxLength={128}
              disabled={!!busy}
            />
          </label>
          <label className="alignment-field alignment-reason-field">
            <span>Audit reason</span>
            <input
              value={reason}
              onChange={(event) => setReason(event.currentTarget.value)}
              maxLength={512}
              disabled={!!busy}
            />
          </label>
          <button
            className="button primary alignment-create-button"
            type="submit"
            disabled={!canCreate || !!busy}
          >
            <GitCompareArrows size={14} /> Create session
          </button>
        </div>

        <div className="alignment-session-picker">
          <label className="alignment-field">
            <span>Alignment session</span>
            <select
              value={detail?.session.id ?? ""}
              onChange={(event) =>
                void run("open-session", async () => {
                  await loadSession(event.currentTarget.value, 0);
                })
              }
              disabled={!!busy || !sessions?.items.length}
            >
              {!sessions?.items.length ? (
                <option value="">No sessions yet</option>
              ) : (
                sessions.items.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.id.slice(0, 8)} · {session.status} · rev{" "}
                    {session.revision}
                  </option>
                ))
              )}
            </select>
          </label>
          <PanelPagination
            label="Alignment sessions"
            offset={sessions?.offset ?? 0}
            limit={sessions?.limit ?? 20}
            total={sessions?.total ?? 0}
            disabled={!!busy}
            onPrevious={() =>
              void run("session-page", async () => {
                await loadSessionPage(
                  Math.max(0, sessionOffset - (sessions?.limit ?? 20)),
                );
              })
            }
            onNext={() =>
              void run("session-page", async () => {
                await loadSessionPage(sessionOffset + (sessions?.limit ?? 20));
              })
            }
          />
        </div>
      </form>

      <PanelFeedback
        loading={loading}
        busy={busy}
        error={error}
        notice={notice}
        loadingLabel="Loading alignment sessions"
        onReload={() => void run("refresh", refreshAll)}
      />

      {!loading && !detail ? (
        <section className="insights-section alignment-corpus-empty">
          <GitCompareArrows size={25} />
          <strong>No alignment session</strong>
          <span>Select two active documents to create the first session.</span>
        </section>
      ) : null}

      {detail ? (
        <section className="insights-section alignment-session-workspace">
          <AlignmentSessionHeading detail={detail} />

          {detail.session.status !== "open" ? (
            <div className="alignment-terminal" role="status">
              <CheckCircle2 size={16} />
              <div>
                <strong>Session {detail.session.status}</strong>
                <span>
                  {detail.session.terminalResult
                    ? `${detail.session.terminalResult.insertedCount} inserted, ${detail.session.terminalResult.duplicateCount} duplicates at TM revision ${detail.session.terminalResult.libraryRevision}.`
                    : "This session is terminal and correction controls are locked."}
                </span>
              </div>
            </div>
          ) : null}

          <div className="alignment-action-bar">
            <label className="alignment-select-page">
              <input
                type="checkbox"
                checked={
                  detail.links.length > 0 &&
                  detail.links.every((link) => selectedLinkIds.has(link.id))
                }
                onChange={(event) => togglePage(event.currentTarget.checked)}
                disabled={!!busy || detail.links.length === 0}
              />
              <span>{selectedLinks.length} selected</span>
            </label>
            <div className="alignment-correction-actions">
              <button
                className="button secondary"
                type="button"
                title="Link selected source-only and target-only groups"
                onClick={() => void replaceSelection("link")}
                disabled={!!busy || !canLink}
              >
                <Link2 size={14} /> Link
              </button>
              <button
                className="button secondary"
                type="button"
                title="Merge a contiguous candidate range"
                onClick={() => void replaceSelection("merge")}
                disabled={!!busy || !canMerge}
              >
                <Combine size={14} /> Merge
              </button>
              <button
                className="button secondary"
                type="button"
                title="Separate one bilingual candidate into unaligned sides"
                onClick={() => void replaceSelection("unlink")}
                disabled={!!busy || !canUnlink}
              >
                <Unlink2 size={14} /> Unlink
              </button>
              <button
                className="button secondary"
                type="button"
                title="Split one grouped candidate by segment order"
                onClick={() => void replaceSelection("split")}
                disabled={!!busy || !canSplit}
              >
                <Split size={14} /> Split
              </button>
            </div>
          </div>

          <div className="alignment-service-grid">
            <div className="alignment-service-block">
              <label className="alignment-field">
                <span>AI refinement profile</span>
                <select
                  value={profileId}
                  onChange={(event) => setProfileId(event.currentTarget.value)}
                  disabled={!!busy || profiles.length === 0 || !sessionOpen}
                >
                  {profiles.length === 0 ? (
                    <option value="">No enabled credentialed profile</option>
                  ) : (
                    profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name} · {profile.model}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <button
                className="button secondary"
                type="button"
                onClick={() => void refineSelection()}
                disabled={
                  !!busy ||
                  !sessionOpen ||
                  !profileId ||
                  !hasAuditContext ||
                  selectedProposed.length === 0
                }
              >
                <Sparkles size={14} /> Refine {selectedProposed.length || ""}
              </button>
              {refinementRun ? (
                <div className="alignment-run-status" role="status">
                  <span data-status={refinementRun.status}>
                    {refinementRun.status}
                  </span>
                  <small>{refinementRun.id.slice(0, 8)}</small>
                  {!isTerminalAiRunStatus(refinementRun.status) ? (
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => void cancelRefinement()}
                      disabled={cancelingRefinement}
                    >
                      <CircleX size={13} /> Cancel
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="alignment-service-block">
              <label className="alignment-field">
                <span>Writable TM</span>
                <select
                  value={libraryId}
                  onChange={(event) => setLibraryId(event.currentTarget.value)}
                  disabled={!!busy || libraries.length === 0 || !sessionOpen}
                >
                  {libraries.length === 0 ? (
                    <option value="">No locale-matching writable TM</option>
                  ) : (
                    libraries.map((library) => (
                      <option key={library.id} value={library.id}>
                        {library.name} · rev {library.revision}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <button
                className="button primary"
                type="button"
                onClick={() => void applyToTm()}
                disabled={
                  !!busy ||
                  !sessionOpen ||
                  !selectedLibrary ||
                  !hasAuditContext ||
                  selectedConfirmed.length === 0
                }
              >
                <Database size={14} /> Apply {selectedConfirmed.length || ""}
              </button>
            </div>

            <div className="alignment-service-block alignment-corpus-create">
              <label className="alignment-field">
                <span>Bilingual corpus name</span>
                <input
                  value={alignmentCorpusName}
                  onChange={(event) =>
                    setAlignmentCorpusName(event.currentTarget.value)
                  }
                  maxLength={160}
                  placeholder="Confirmed alignment corpus"
                  disabled={!!busy}
                />
              </label>
              <button
                className="button secondary"
                type="button"
                onClick={() => void createCorpusFromAlignment()}
                disabled={
                  !!busy ||
                  !alignmentCorpusName.trim() ||
                  !hasAuditContext ||
                  selectedConfirmed.length === 0
                }
              >
                <BookOpen size={14} /> Create corpus
              </button>
            </div>
          </div>

          {detail.links.length ? (
            <div className="alignment-links" aria-label="Alignment candidates">
              {detail.links.map((link) => (
                <AlignmentLinkRow
                  key={link.id}
                  link={link}
                  selected={selectedLinkIds.has(link.id)}
                  busy={!!busy}
                  actionsDisabled={!hasAuditContext}
                  sessionOpen={sessionOpen}
                  onToggle={toggleLink}
                  onStatus={(status) => void setLinkStatus(link, status)}
                />
              ))}
            </div>
          ) : (
            <div className="alignment-inline-empty">
              No candidates on this page.
            </div>
          )}

          <PanelPagination
            label="Alignment candidates"
            offset={detail.offset}
            limit={detail.limit}
            total={detail.total}
            disabled={!!busy}
            onPrevious={() =>
              void run("link-page", async () => {
                await loadSession(
                  detail.session.id,
                  Math.max(0, detail.offset - detail.limit),
                );
              })
            }
            onNext={() =>
              void run("link-page", async () => {
                await loadSession(
                  detail.session.id,
                  detail.offset + detail.limit,
                );
              })
            }
          />
        </section>
      ) : null}
    </div>
  );
}

function AlignmentSessionHeading({
  detail,
}: {
  detail: AlignmentSessionGetResult;
}) {
  return (
    <div className="alignment-session-heading">
      <div>
        <span className="surface-kicker">
          Session {detail.session.id.slice(0, 8)} · rev{" "}
          {detail.session.revision}
        </span>
        <h2>{detail.total} alignment candidates</h2>
      </div>
      <div className="alignment-session-facts">
        <span data-status={detail.session.status}>{detail.session.status}</span>
        <small>
          {detail.session.sourceDocumentId.slice(0, 8)} →{" "}
          {detail.session.targetDocumentId.slice(0, 8)}
        </small>
        <small>{detail.session.algorithmVersion}</small>
      </div>
    </div>
  );
}

function AlignmentLinkRow({
  link,
  selected,
  busy,
  actionsDisabled,
  sessionOpen,
  onToggle,
  onStatus,
}: {
  link: AlignmentLink;
  selected: boolean;
  busy: boolean;
  actionsDisabled: boolean;
  sessionOpen: boolean;
  onToggle(linkId: string, checked: boolean): void;
  onStatus(status: "confirmed" | "rejected"): void;
}) {
  return (
    <article
      className="alignment-link-row"
      data-status={link.status}
      data-origin={link.origin}
    >
      <label className="alignment-link-select">
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => onToggle(link.id, event.currentTarget.checked)}
          disabled={busy}
          aria-label={`Select alignment candidate ${link.ordinal + 1}`}
        />
      </label>
      <div className="alignment-link-meta">
        <strong>#{link.ordinal + 1}</strong>
        <span data-status={link.status}>{link.status}</span>
        <small>{link.origin}</small>
        <small>{(link.confidenceBasisPoints / 100).toFixed(1)}%</small>
      </div>
      <div className="alignment-link-copy">
        <span>Source · {link.sourceSegmentIds.length} segment(s)</span>
        <p className="cjk">{link.sourceText || "(source unaligned)"}</p>
        <code>{link.sourceSegmentIds.join(", ") || "No source member"}</code>
      </div>
      <div className="alignment-link-copy">
        <span>Target · {link.targetSegmentIds.length} segment(s)</span>
        <p className="cjk">{link.targetText || "(target unaligned)"}</p>
        <code>{link.targetSegmentIds.join(", ") || "No target member"}</code>
      </div>
      <div className="alignment-link-review">
        <details>
          <summary>Evidence · {link.evidence.length}</summary>
          {link.evidence.length ? (
            <ul>
              {link.evidence.map((evidence, index) => (
                <li key={`${evidence.kind}-${index}`}>{evidence.summary}</li>
              ))}
            </ul>
          ) : (
            <small>Manual bilingual link</small>
          )}
        </details>
        <div>
          <button
            className="button secondary"
            type="button"
            onClick={() => onStatus("confirmed")}
            disabled={
              busy ||
              actionsDisabled ||
              !sessionOpen ||
              link.status === "confirmed"
            }
          >
            <Check size={13} /> Confirm
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={() => onStatus("rejected")}
            disabled={
              busy ||
              actionsDisabled ||
              !sessionOpen ||
              link.status === "rejected"
            }
          >
            <X size={13} /> Reject
          </button>
        </div>
      </div>
    </article>
  );
}

function CorpusWorkflow({
  snapshot,
  onRefresh,
}: {
  snapshot: ProjectSnapshot;
  onRefresh(): Promise<void>;
}) {
  const projectId = snapshot.project.id;
  const [corpora, setCorpora] = useState<ReferenceCorpusPage | null>(null);
  const [searchCorpora, setSearchCorpora] = useState<ReferenceCorpus[]>([]);
  const [statusFilter, setStatusFilter] =
    useState<CorpusStatusFilter>("active");
  const [inputPath, setInputPath] = useState("");
  const [kind, setKind] = useState<ReferenceCorpusKind>("monolingualSource");
  const [name, setName] = useState("");
  const [sourceLocale, setSourceLocale] = useState(
    snapshot.project.sourceLocale,
  );
  const [targetLocale, setTargetLocale] = useState(
    snapshot.project.targetLocale,
  );
  const [actor, setActor] = useState("desktop-user");
  const [reason, setReason] = useState("Manage project reference corpus");
  const [query, setQuery] = useState("");
  const [searchSide, setSearchSide] = useState<"source" | "target" | "both">(
    "both",
  );
  const [searchCorpusId, setSearchCorpusId] = useState("");
  const [searchResult, setSearchResult] = useState<CorpusSearchResult | null>(
    null,
  );
  const [removeTarget, setRemoveTarget] = useState<ReferenceCorpus | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchCorpora = async (
    offset: number,
    filter: CorpusStatusFilter = statusFilter,
  ) => {
    let page = await window.translunar.invoke("corpus.list", {
      projectId,
      status: filter === "all" ? null : filter,
      offset,
      limit: 20,
    });
    if (page.total > 0 && page.items.length === 0 && offset > 0) {
      const lastOffset = Math.floor((page.total - 1) / page.limit) * page.limit;
      page = await window.translunar.invoke("corpus.list", {
        projectId,
        status: filter === "all" ? null : filter,
        offset: lastOffset,
        limit: page.limit,
      });
    }
    setCorpora(page);
    return page;
  };

  const fetchSearchCorpora = async () => {
    const page = await window.translunar.invoke("corpus.list", {
      projectId,
      status: "active",
      offset: 0,
      limit: 500,
    });
    setSearchCorpora(page.items);
    setSearchCorpusId((current) =>
      current && !page.items.some((item) => item.id === current) ? "" : current,
    );
    return page;
  };

  useEffect(() => {
    let active = true;
    async function initialize(): Promise<void> {
      setLoading(true);
      setError(null);
      setCorpora(null);
      setSearchCorpora([]);
      setSearchResult(null);
      setSearchCorpusId("");
      setInputPath("");
      setName("");
      setSourceLocale(snapshot.project.sourceLocale);
      setTargetLocale(snapshot.project.targetLocale);
      setStatusFilter("active");
      setRemoveTarget(null);
      try {
        const [page, searchPage] = await Promise.all([
          window.translunar.invoke("corpus.list", {
            projectId,
            status: "active",
            offset: 0,
            limit: 20,
          }),
          window.translunar.invoke("corpus.list", {
            projectId,
            status: "active",
            offset: 0,
            limit: 500,
          }),
        ]);
        if (active) {
          setCorpora(page);
          setSearchCorpora(searchPage.items);
        }
      } catch (reasonValue) {
        if (active) setError(formatError(reasonValue));
      } finally {
        if (active) setLoading(false);
      }
    }
    void initialize();
    return () => {
      active = false;
    };
  }, [projectId, snapshot.project.sourceLocale, snapshot.project.targetLocale]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (reasonValue) {
      setError(formatError(reasonValue));
    } finally {
      setBusy(null);
    }
  };

  const acceptInputPath = (path: string) => {
    setInputPath(path);
    if (!name.trim()) setName(corpusNameFromPath(path));
  };

  const chooseInput = async () => {
    await run("choose-corpus", async () => {
      const path = await window.translunar.selectCorpusInput();
      if (path) acceptInputPath(path);
    });
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    try {
      const path = window.translunar.resolveDroppedPaths([
        ...event.dataTransfer.files,
      ])[0];
      if (path) acceptInputPath(path);
    } catch (reasonValue) {
      setError(formatError(reasonValue));
    }
  };

  const importCorpus = async () => {
    if (!inputPath || !name.trim()) return;
    await run("import-corpus", async () => {
      const result = await window.translunar.invoke("corpus.import", {
        projectId,
        expectedProjectRevision: snapshot.project.revision,
        sourcePath: inputPath,
        kind,
        name: name.trim(),
        sourceLocale: sourceLocale.trim(),
        targetLocale: targetLocale.trim(),
        options: {},
        actor: actor.trim(),
        reason: reason.trim(),
      });
      setInputPath("");
      setName("");
      setStatusFilter("active");
      setNotice(
        `Imported ${result.corpus.name}: ${result.affectedEntryCount} entries, ${result.corpus.diagnosticCount} diagnostics.`,
      );
      await Promise.all([
        fetchCorpora(0, "active"),
        fetchSearchCorpora(),
        onRefresh(),
      ]);
      if (query.trim()) await fetchSearch(0);
    });
  };

  const fetchSearch = async (
    offset: number,
    corpusId: string = searchCorpusId,
  ) => {
    if (!query.trim()) {
      setSearchResult(null);
      return;
    }
    setSearchResult(
      await window.translunar.invoke("corpus.search", {
        projectId,
        query: query.trim(),
        side: searchSide,
        ...(corpusId ? { corpusIds: [corpusId] } : {}),
        offset,
        limit: 30,
      }),
    );
  };

  const reindexCorpus = async (corpus: ReferenceCorpus) => {
    if (!hasAuditContext) return;
    await run(`reindex-${corpus.id}`, async () => {
      const result = await window.translunar.invoke("corpus.reindex", {
        corpusId: corpus.id,
        expectedRevision: corpus.revision,
        actor: actor.trim(),
        reason: reason.trim(),
      });
      setNotice(
        `Reindexed ${result.corpus.name} at revision ${result.corpus.revision}.`,
      );
      await Promise.all([
        fetchCorpora(corpora?.offset ?? 0),
        query.trim() ? fetchSearch(0) : Promise.resolve(),
        onRefresh(),
      ]);
    });
  };

  const removeCorpus = async () => {
    const corpus = removeTarget;
    if (!corpus || !hasAuditContext) return;
    await run(`remove-${corpus.id}`, async () => {
      const result = await window.translunar.invoke("corpus.remove", {
        corpusId: corpus.id,
        expectedRevision: corpus.revision,
        actor: actor.trim(),
        reason: reason.trim(),
      });
      const nextSearchCorpusId =
        searchCorpusId === corpus.id ? "" : searchCorpusId;
      setSearchCorpusId(nextSearchCorpusId);
      setRemoveTarget(null);
      setNotice(
        `${result.corpus.name} was removed from retrieval; its managed source remains recoverable.`,
      );
      await Promise.all([
        fetchCorpora(corpora?.offset ?? 0),
        fetchSearchCorpora(),
        onRefresh(),
      ]);
      if (query.trim()) await fetchSearch(0, nextSearchCorpusId);
    });
  };

  const canImport =
    !!inputPath &&
    !!name.trim() &&
    !!sourceLocale.trim() &&
    !!targetLocale.trim() &&
    !!actor.trim() &&
    !!reason.trim();
  const hasAuditContext = !!actor.trim() && !!reason.trim();
  const activeCorpora = searchCorpora;

  return (
    <div className="corpus-workflow" aria-busy={loading || !!busy}>
      <form
        className="insights-section corpus-import"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          void importCorpus();
        }}
      >
        <div className="alignment-control-heading">
          <div>
            <span className="surface-kicker">Project-owned retrieval</span>
            <h2>Import reference corpus</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            title="Refresh reference corpora"
            aria-label="Refresh reference corpora"
            onClick={() =>
              void run("corpus-refresh", async () => {
                await Promise.all([
                  fetchCorpora(corpora?.offset ?? 0),
                  fetchSearchCorpora(),
                  onRefresh(),
                ]);
              })
            }
            disabled={loading || !!busy}
          >
            <RefreshCw size={15} />
          </button>
        </div>

        <div
          className="corpus-dropzone"
          onDrop={handleDrop}
          onDragOver={(event) => event.preventDefault()}
        >
          <UploadCloud size={20} />
          <div>
            <strong>
              {inputPath
                ? fileName(inputPath)
                : "Choose or drop one corpus file"}
            </strong>
            <span>{inputPath ? inputPath : "No file selected"}</span>
          </div>
          <button
            className="button secondary"
            type="button"
            onClick={() => void chooseInput()}
            disabled={!!busy}
          >
            <FolderOpen size={14} /> Select file
          </button>
        </div>

        <div className="corpus-import-grid">
          <label className="alignment-field">
            <span>Corpus kind</span>
            <select
              value={kind}
              onChange={(event) =>
                setKind(event.currentTarget.value as ReferenceCorpusKind)
              }
              disabled={!!busy}
            >
              <option value="monolingualSource">Monolingual source</option>
              <option value="monolingualTarget">Monolingual target</option>
              <option value="bilingual">Bilingual</option>
            </select>
          </label>
          <label className="alignment-field corpus-name-field">
            <span>Corpus name</span>
            <input
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              maxLength={160}
              placeholder="Product documentation 2026"
              disabled={!!busy}
            />
          </label>
          <label className="alignment-field">
            <span>Source locale</span>
            <input
              value={sourceLocale}
              onChange={(event) => setSourceLocale(event.currentTarget.value)}
              maxLength={64}
              readOnly
              disabled={!!busy}
            />
          </label>
          <label className="alignment-field">
            <span>Target locale</span>
            <input
              value={targetLocale}
              onChange={(event) => setTargetLocale(event.currentTarget.value)}
              maxLength={64}
              readOnly
              disabled={!!busy}
            />
          </label>
          <label className="alignment-field">
            <span>Actor</span>
            <input
              value={actor}
              onChange={(event) => setActor(event.currentTarget.value)}
              maxLength={128}
              disabled={!!busy}
            />
          </label>
          <label className="alignment-field corpus-reason-field">
            <span>Audit reason</span>
            <input
              value={reason}
              onChange={(event) => setReason(event.currentTarget.value)}
              maxLength={512}
              disabled={!!busy}
            />
          </label>
          <button
            className="button primary corpus-import-button"
            type="submit"
            disabled={!!busy || !canImport}
          >
            <UploadCloud size={14} /> Import corpus
          </button>
        </div>
      </form>

      <PanelFeedback
        loading={loading}
        busy={busy}
        error={removeTarget ? null : error}
        notice={notice}
        loadingLabel="Loading reference corpora"
        onReload={() =>
          void run("corpus-refresh", async () => {
            await Promise.all([
              fetchCorpora(corpora?.offset ?? 0),
              fetchSearchCorpora(),
              onRefresh(),
            ]);
          })
        }
      />

      <section className="insights-section corpus-library">
        <div className="corpus-section-heading">
          <div>
            <span className="surface-kicker">Mounted assets</span>
            <h2>{corpora?.total ?? 0} reference corpora</h2>
          </div>
          <label className="alignment-field corpus-status-filter">
            <span>Status</span>
            <select
              value={statusFilter}
              onChange={(event) => {
                const next = event.currentTarget.value as CorpusStatusFilter;
                setStatusFilter(next);
                void run("corpus-list", async () => {
                  await fetchCorpora(0, next);
                });
              }}
              disabled={!!busy}
            >
              <option value="active">Active</option>
              <option value="removed">Removed</option>
              <option value="all">All</option>
            </select>
          </label>
        </div>

        {corpora?.items.length ? (
          <div className="corpus-list">
            {corpora.items.map((corpus) => (
              <article key={corpus.id} className="corpus-list-row">
                <div className="corpus-list-icon" aria-hidden="true">
                  <BookOpen size={17} />
                </div>
                <div className="corpus-list-copy">
                  <div>
                    <strong>{corpus.name}</strong>
                    <span data-status={corpus.status}>{corpus.status}</span>
                  </div>
                  <small>
                    {corpus.kind} · {corpus.sourceLocale} →{" "}
                    {corpus.targetLocale}
                  </small>
                  <small title={corpus.managedSourcePath ?? undefined}>
                    {corpusSourceLabel(corpus)}
                  </small>
                </div>
                <div className="corpus-list-metrics">
                  <span>
                    <strong>{corpus.entryCount.toLocaleString()}</strong>{" "}
                    entries
                  </span>
                  <span>
                    <strong>{corpus.diagnosticCount.toLocaleString()}</strong>{" "}
                    diagnostics
                  </span>
                  <span>
                    <strong>{corpus.revision}</strong> revision
                  </span>
                </div>
                <div className="corpus-list-actions">
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => void reindexCorpus(corpus)}
                    disabled={
                      !!busy || !hasAuditContext || corpus.status !== "active"
                    }
                  >
                    <RefreshCw size={13} /> Reindex
                  </button>
                  <button
                    className="icon-button danger-icon-button"
                    type="button"
                    title={`Remove ${corpus.name}`}
                    aria-label={`Remove ${corpus.name}`}
                    onClick={() => {
                      setError(null);
                      setRemoveTarget(corpus);
                    }}
                    disabled={
                      !!busy || !hasAuditContext || corpus.status !== "active"
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : !loading ? (
          <div className="alignment-inline-empty">
            No corpora match this status filter.
          </div>
        ) : null}

        <PanelPagination
          label="Reference corpora"
          offset={corpora?.offset ?? 0}
          limit={corpora?.limit ?? 20}
          total={corpora?.total ?? 0}
          disabled={!!busy}
          onPrevious={() =>
            void run("corpus-list", async () => {
              await fetchCorpora(
                Math.max(0, (corpora?.offset ?? 0) - (corpora?.limit ?? 20)),
              );
            })
          }
          onNext={() =>
            void run("corpus-list", async () => {
              await fetchCorpora(
                (corpora?.offset ?? 0) + (corpora?.limit ?? 20),
              );
            })
          }
        />
      </section>

      <section className="insights-section corpus-search">
        <div className="corpus-section-heading">
          <div>
            <span className="surface-kicker">Authoritative ranking</span>
            <h2>Search corpora</h2>
          </div>
          {searchResult ? (
            <span className="corpus-search-total">
              {searchResult.total.toLocaleString()} matches
            </span>
          ) : null}
        </div>
        <form
          className="corpus-search-form"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            void run("corpus-search", async () => fetchSearch(0));
          }}
        >
          <label className="alignment-field corpus-query-field">
            <span>Query</span>
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setSearchResult(null);
              }}
              placeholder="Search source or target expressions"
              disabled={!!busy}
            />
          </label>
          <label className="alignment-field">
            <span>Side</span>
            <select
              value={searchSide}
              onChange={(event) => {
                setSearchSide(event.currentTarget.value as typeof searchSide);
                setSearchResult(null);
              }}
              disabled={!!busy}
            >
              <option value="both">Source and target</option>
              <option value="source">Source</option>
              <option value="target">Target</option>
            </select>
          </label>
          <label className="alignment-field">
            <span>Scope</span>
            <select
              value={searchCorpusId}
              onChange={(event) => {
                setSearchCorpusId(event.currentTarget.value);
                setSearchResult(null);
              }}
              disabled={!!busy}
            >
              <option value="">All active corpora</option>
              {activeCorpora.map((corpus) => (
                <option key={corpus.id} value={corpus.id}>
                  {corpus.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button primary corpus-search-button"
            type="submit"
            disabled={!!busy || !query.trim()}
          >
            <Search size={14} /> Search
          </button>
        </form>

        {searchResult?.items.length ? (
          <div className="corpus-search-results" aria-live="polite">
            {searchResult.items.map((hit) => (
              <article key={`${hit.corpus.id}-${hit.entry.id}`}>
                <header>
                  <div>
                    <strong>{hit.corpus.name}</strong>
                    <span>{hit.matchKind}</span>
                    <span>{hit.matchedSide}</span>
                  </div>
                  <small>
                    Entry {hit.entry.ordinal + 1} · {hit.entry.id.slice(0, 8)}
                  </small>
                </header>
                <div className="corpus-hit-copy">
                  <p className="cjk">
                    {hit.entry.sourceText || "(no source expression)"}
                  </p>
                  <p className="cjk corpus-hit-target">
                    {hit.entry.targetText || "(no target expression)"}
                  </p>
                </div>
                <footer>
                  <span title={hit.corpus.managedSourcePath ?? undefined}>
                    <FolderOpen size={12} /> {corpusSourceLabel(hit.corpus)}
                  </span>
                  <code>
                    {hit.entry.structuralPath || "No structural path"}
                  </code>
                  <details>
                    <summary>Provenance</summary>
                    <code>{formatCorpusProvenance(hit.entry.provenance)}</code>
                  </details>
                </footer>
              </article>
            ))}
          </div>
        ) : searchResult && !busy ? (
          <div className="alignment-inline-empty">
            No corpus entry matches this query and scope.
          </div>
        ) : !searchResult ? (
          <div className="corpus-search-prompt">
            <FileSearch size={22} />
            <span>No corpus search has been run.</span>
          </div>
        ) : null}

        {searchResult ? (
          <PanelPagination
            label="Corpus search results"
            offset={searchResult.offset}
            limit={searchResult.limit}
            total={searchResult.total}
            disabled={!!busy}
            onPrevious={() =>
              void run("corpus-search", async () => {
                await fetchSearch(
                  Math.max(0, searchResult.offset - searchResult.limit),
                );
              })
            }
            onNext={() =>
              void run("corpus-search", async () => {
                await fetchSearch(searchResult.offset + searchResult.limit);
              })
            }
          />
        ) : null}
      </section>

      {removeTarget ? (
        <div
          className="editor-overlay"
          role="presentation"
          onMouseDown={() => {
            if (!busy) setRemoveTarget(null);
          }}
        >
          <section
            className="editor-dialog corpus-remove-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="corpus-remove-title"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !busy) {
                event.preventDefault();
                setRemoveTarget(null);
              }
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <small>Reference corpus</small>
                <strong id="corpus-remove-title">
                  Remove {removeTarget.name}
                </strong>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close remove corpus confirmation"
                onClick={() => setRemoveTarget(null)}
                disabled={!!busy}
              >
                <X size={14} />
              </button>
            </header>
            <p>
              Search and AI grounding will exclude this corpus immediately.
              Original documents, TM units, and the managed source are not
              changed.
            </p>
            {error ? (
              <p className="surface-error" role="alert">
                {error}
              </p>
            ) : null}
            <footer>
              <button
                className="button secondary"
                type="button"
                onClick={() => setRemoveTarget(null)}
                disabled={!!busy}
                autoFocus
              >
                Cancel
              </button>
              <button
                className="button danger-button"
                type="button"
                onClick={() => void removeCorpus()}
                disabled={!!busy || !hasAuditContext}
              >
                <Trash2 size={14} /> {busy ? "Removing" : "Remove corpus"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function PanelFeedback({
  loading,
  busy,
  error,
  notice,
  loadingLabel,
  onReload,
}: {
  loading: boolean;
  busy: string | null;
  error: string | null;
  notice: string | null;
  loadingLabel: string;
  onReload(): void;
}) {
  return (
    <div className="alignment-corpus-feedback">
      {error ? (
        <div className="surface-error" role="alert">
          <AlertTriangle size={14} />
          <span>{error}</span>
          <button
            className="button secondary"
            type="button"
            onClick={onReload}
            disabled={loading || !!busy}
          >
            Reload authoritative state
          </button>
        </div>
      ) : null}
      {notice ? (
        <p className="surface-success" role="status">
          <CheckCircle2 size={14} /> {notice}
        </p>
      ) : null}
      {loading || busy ? (
        <p className="alignment-corpus-loading" role="status">
          <LoaderCircle className="spin" size={16} />
          {loading ? loadingLabel : `Working on ${busy?.replaceAll("-", " ")}`}
        </p>
      ) : null}
    </div>
  );
}

function PanelPagination({
  label,
  offset,
  limit,
  total,
  disabled,
  onPrevious,
  onNext,
}: {
  label: string;
  offset: number;
  limit: number;
  total: number;
  disabled: boolean;
  onPrevious(): void;
  onNext(): void;
}) {
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(total, offset + limit);
  return (
    <footer className="alignment-pagination">
      <span>
        {start}-{end} of {total}
      </span>
      <div>
        <button
          className="icon-button"
          type="button"
          title={`Previous ${label.toLocaleLowerCase()} page`}
          aria-label={`Previous ${label.toLocaleLowerCase()} page`}
          onClick={onPrevious}
          disabled={disabled || offset === 0}
        >
          <ChevronLeft size={15} />
        </button>
        <button
          className="icon-button"
          type="button"
          title={`Next ${label.toLocaleLowerCase()} page`}
          aria-label={`Next ${label.toLocaleLowerCase()} page`}
          onClick={onNext}
          disabled={disabled || offset + limit >= total}
        >
          <ChevronRight size={15} />
        </button>
      </div>
    </footer>
  );
}

function corpusSourceLabel(corpus: ReferenceCorpus): string {
  if (corpus.managedSourcePath) return fileName(corpus.managedSourcePath);
  if (corpus.sourceDocumentId || corpus.targetDocumentId) {
    return `Documents ${corpus.sourceDocumentId?.slice(0, 8) ?? "-"} / ${corpus.targetDocumentId?.slice(0, 8) ?? "-"}`;
  }
  if (corpus.alignmentSessionId) {
    return `Alignment ${corpus.alignmentSessionId.slice(0, 8)}`;
  }
  return corpus.sourceKind;
}

function corpusNameFromPath(path: string): string {
  return fileName(path)
    .replace(/\.[^.]+$/u, "")
    .slice(0, 160);
}

async function waitForAiRun(
  initial: AiRun,
  onUpdate: (run: AiRun) => void,
  signal: AbortSignal,
): Promise<AiRun> {
  let current = initial;
  for (let attempt = 0; attempt < 480; attempt += 1) {
    if (isTerminalAiRunStatus(current.status)) return current;
    if (signal.aborted) {
      throw new DOMException(
        "Alignment refinement polling was canceled.",
        "AbortError",
      );
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
    if (signal.aborted) {
      throw new DOMException(
        "Alignment refinement polling was canceled.",
        "AbortError",
      );
    }
    current = await window.translunar.invoke("ai.run.get", {
      runId: current.id,
    });
    if (signal.aborted) {
      throw new DOMException(
        "Alignment refinement polling was canceled.",
        "AbortError",
      );
    }
    onUpdate(current);
  }
  throw new Error("Alignment refinement did not finish within two minutes.");
}
