import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  DiscussionMessage,
  DiscussionMessagePage,
  DiscussionScope,
  DiscussionThread,
  DiscussionThreadPage,
  Document,
  NamedProjectSnapshot,
  ProjectSnapshot,
  ProjectSnapshotPage,
  ProjectSnapshotPreview,
  Segment,
} from "@translunar/contracts";
import {
  ArchiveRestore,
  AtSign,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Edit3,
  FolderGit2,
  MessageSquareText,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Trash2,
  X,
} from "lucide-react";

import {
  applySnapshotRestoreResult,
  canRestoreSnapshot,
  lastPageOffset,
  nextPageOffset,
  pageRangeLabel,
  previousPageOffset,
  snapshotChangeItems,
} from "./discussion-snapshot-utils";
import { formatError } from "./workbench-utils";
import "./DiscussionSnapshotPanel.css";
import { useLocale } from "./i18n/LocaleProvider";

type PanelMode = "discussions" | "snapshots";
type Translate = ReturnType<typeof useLocale>["t"];

interface DiscussionSnapshotPanelProps {
  snapshot: ProjectSnapshot;
  document: Document;
  documents: Document[];
  onRefresh(): Promise<void>;
}

interface PanelHeadingProps {
  eyebrow: string;
  title: string;
  icon: ReactNode;
  actions?: ReactNode;
}

const PAGE_SIZE = 20;
const SEGMENT_OPTION_LIMIT = 500;

export function DiscussionSnapshotPanel({
  snapshot,
  document,
  documents,
  onRefresh,
}: DiscussionSnapshotPanelProps) {
  const { t } = useLocale();

  const [mode, setMode] = useState<PanelMode>("discussions");

  return (
    <div className="discussion-snapshot-layout">
      <div
        className="discussion-snapshot-mode-tabs"
        role="tablist"
        aria-label={t("discussion.modeAria")}
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "discussions"}
          onClick={() => setMode("discussions")}
        >
          <MessageSquareText size={15} />
          {t("discussion.discussions")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "snapshots"}
          onClick={() => setMode("snapshots")}
        >
          <FolderGit2 size={15} />
          {t("discussion.projectSnapshots")}
        </button>
      </div>

      {mode === "discussions" ? (
        <DiscussionPanel
          snapshot={snapshot}
          document={document}
          documents={documents}
        />
      ) : (
        <SnapshotPanel snapshot={snapshot} onRefresh={onRefresh} />
      )}
    </div>
  );
}

function DiscussionPanel({
  snapshot,
  document,
  documents,
}: Omit<DiscussionSnapshotPanelProps, "onRefresh">) {
  const { t, formatDate } = useLocale();
  const projectId = snapshot.project.id;
  const activeDocuments = useMemo(
    () => documents.filter((item) => item.status === "active"),
    [documents],
  );
  const [scope, setScope] = useState<DiscussionScope>("project");
  const [documentId, setDocumentId] = useState(document.id);
  const [segmentId, setSegmentId] = useState("");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [segmentTotal, setSegmentTotal] = useState(0);
  const [segmentsLoading, setSegmentsLoading] = useState(false);
  const [includeResolved, setIncludeResolved] = useState(false);
  const [threadPage, setThreadPage] = useState<DiscussionThreadPage | null>(
    null,
  );
  const [threadOffset, setThreadOffset] = useState(0);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [selectedThread, setSelectedThread] = useState<DiscussionThread | null>(
    null,
  );
  const [messagePage, setMessagePage] = useState<DiscussionMessagePage | null>(
    null,
  );
  const [messageOffset, setMessageOffset] = useState(0);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState("");
  const [actor, setActor] = useState("desktop-user");
  const [reason, setReason] = useState("Project discussion");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [deleteMessage, setDeleteMessage] = useState<DiscussionMessage | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (activeDocuments.some((item) => item.id === documentId)) return;
    setDocumentId(activeDocuments[0]?.id ?? "");
  }, [activeDocuments, documentId]);

  useEffect(() => {
    if (!documentId) {
      setSegments([]);
      setSegmentTotal(0);
      setSegmentId("");
      return;
    }
    let cancelled = false;
    setSegmentsLoading(true);
    void window.translunar
      .invoke("segment.list", {
        documentId,
        offset: 0,
        limit: SEGMENT_OPTION_LIMIT,
      })
      .then((page) => {
        if (cancelled) return;
        setSegments(page.items);
        setSegmentTotal(page.total);
        setSegmentId((current) =>
          page.items.some((item) => item.id === current)
            ? current
            : (page.items[0]?.id ?? ""),
        );
      })
      .catch((reasonValue: unknown) => {
        if (!cancelled) setError(formatError(reasonValue));
      })
      .finally(() => {
        if (!cancelled) setSegmentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  const getThreadPage = useCallback(
    (offset: number) =>
      window.translunar.invoke("discussion.thread.list", {
        projectId,
        scope,
        documentId: scope === "project" ? null : documentId || null,
        segmentId: scope === "segment" ? segmentId || null : null,
        includeResolved,
        offset,
        limit: PAGE_SIZE,
      }),
    [documentId, includeResolved, projectId, scope, segmentId],
  );

  const applyThreadPage = useCallback((page: DiscussionThreadPage) => {
    setThreadPage(page);
    setSelectedThread((current) => {
      const updated = current
        ? page.items.find((item) => item.id === current.id)
        : undefined;
      return updated ?? page.items[0] ?? current;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setThreadsLoading(true);
    setError(null);
    void getThreadPage(threadOffset)
      .then((page) => {
        if (!cancelled) applyThreadPage(page);
      })
      .catch((reasonValue: unknown) => {
        if (!cancelled) setError(formatError(reasonValue));
      })
      .finally(() => {
        if (!cancelled) setThreadsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applyThreadPage, getThreadPage, threadOffset]);

  const getMessagePage = useCallback(
    (threadId: string, offset: number) =>
      window.translunar.invoke("discussion.message.list", {
        threadId,
        includeDeleted: true,
        offset,
        limit: PAGE_SIZE,
      }),
    [],
  );

  useEffect(() => {
    const threadId = selectedThread?.id;
    if (!threadId) {
      setMessagePage(null);
      return;
    }
    let cancelled = false;
    setMessagesLoading(true);
    void getMessagePage(threadId, messageOffset)
      .then((page) => {
        if (!cancelled) setMessagePage(page);
      })
      .catch((reasonValue: unknown) => {
        if (!cancelled) setError(formatError(reasonValue));
      })
      .finally(() => {
        if (!cancelled) setMessagesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [getMessagePage, messageOffset, selectedThread?.id]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (reasonValue: unknown) {
      setError(formatError(reasonValue));
    } finally {
      setBusy(null);
    }
  };

  const loadExactThread = async (
    thread: DiscussionThread,
  ): Promise<DiscussionThread> => {
    const page = await window.translunar.invoke("discussion.thread.list", {
      projectId,
      scope: thread.scope,
      documentId: thread.documentId ?? null,
      segmentId: thread.segmentId ?? null,
      includeResolved: true,
      offset: 0,
      limit: SEGMENT_OPTION_LIMIT,
    });
    return page.items.find((item) => item.id === thread.id) ?? thread;
  };

  const refreshThreadList = async (selected?: DiscussionThread) => {
    const page = await getThreadPage(0);
    setThreadOffset(0);
    setThreadPage(page);
    if (selected) {
      setSelectedThread(selected);
      return;
    }
    setSelectedThread(page.items[0] ?? null);
  };

  const refreshMessages = async (
    thread: DiscussionThread,
    showLastPage: boolean,
  ) => {
    const firstPage = await getMessagePage(thread.id, 0);
    const offset = showLastPage
      ? lastPageOffset(firstPage.total, PAGE_SIZE)
      : Math.min(messageOffset, lastPageOffset(firstPage.total, PAGE_SIZE));
    const page =
      offset === 0 ? firstPage : await getMessagePage(thread.id, offset);
    setMessageOffset(offset);
    setMessagePage(page);
  };

  const chooseScope = (nextScope: DiscussionScope) => {
    setScope(nextScope);
    setThreadOffset(0);
    setMessageOffset(0);
    setSelectedThread(null);
    setMessagePage(null);
    setError(null);
    setNotice(null);
  };

  const chooseThread = (thread: DiscussionThread) => {
    setSelectedThread(thread);
    setMessageOffset(0);
    setEditingMessageId(null);
    setDeleteMessage(null);
    setError(null);
  };

  const createThread = async () => {
    if (!canCreateThread(scope, documentId, segmentId, body, actor, reason)) {
      return;
    }
    await run("create-thread", async () => {
      const currentProject = await window.translunar.invoke("project.get", {
        projectId,
      });
      const created = await window.translunar.invoke(
        "discussion.thread.create",
        {
          projectId,
          scope,
          documentId: scope === "project" ? null : documentId,
          segmentId: scope === "segment" ? segmentId : null,
          title: title.trim(),
          body: body.trim(),
          actor: actor.trim(),
          reason: reason.trim(),
          expectedProjectRevision: currentProject.project.revision,
        },
      );
      const authoritative = await loadExactThread(created);
      await Promise.all([
        refreshThreadList(authoritative),
        refreshMessages(authoritative, true),
      ]);
      setTitle("");
      setBody("");
      setNotice(t("discussion.createdWithMessage"));
    });
  };

  const createReply = async () => {
    const thread = selectedThread;
    if (
      !thread ||
      thread.status !== "open" ||
      !reply.trim() ||
      !actor.trim() ||
      !reason.trim()
    ) {
      return;
    }
    await run("create-message", async () => {
      await window.translunar.invoke("discussion.message.create", {
        threadId: thread.id,
        body: reply.trim(),
        actor: actor.trim(),
        reason: reason.trim(),
        expectedThreadRevision: thread.revision,
      });
      const authoritative = await loadExactThread(thread);
      await Promise.all([
        refreshThreadList(authoritative),
        refreshMessages(authoritative, true),
      ]);
      setReply("");
      setNotice(t("discussion.replyAdded"));
    });
  };

  const saveMessage = async (message: DiscussionMessage) => {
    const thread = selectedThread;
    if (
      !thread ||
      thread.status !== "open" ||
      !editBody.trim() ||
      !actor.trim() ||
      !reason.trim()
    ) {
      return;
    }
    await run(`edit-${message.id}`, async () => {
      await window.translunar.invoke("discussion.message.update", {
        messageId: message.id,
        body: editBody.trim(),
        actor: actor.trim(),
        reason: reason.trim(),
        expectedRevision: message.revision,
      });
      const authoritative = await loadExactThread(thread);
      await Promise.all([
        refreshThreadList(authoritative),
        refreshMessages(authoritative, false),
      ]);
      setEditingMessageId(null);
      setEditBody("");
      setNotice(
        t("discussion.messageUpdated", { ordinal: message.ordinal + 1 }),
      );
    });
  };

  const confirmDeleteMessage = async () => {
    const message = deleteMessage;
    const thread = selectedThread;
    if (!message || !thread || !actor.trim() || !reason.trim()) return;
    await run(`delete-${message.id}`, async () => {
      await window.translunar.invoke("discussion.message.delete", {
        messageId: message.id,
        actor: actor.trim(),
        reason: reason.trim(),
        expectedRevision: message.revision,
      });
      const authoritative = await loadExactThread(thread);
      await Promise.all([
        refreshThreadList(authoritative),
        refreshMessages(authoritative, false),
      ]);
      setDeleteMessage(null);
      setEditingMessageId(null);
      setNotice(
        t("discussion.messageTombstoned", { ordinal: message.ordinal + 1 }),
      );
    });
  };

  const setThreadResolution = async (resolved: boolean) => {
    const thread = selectedThread;
    if (!thread || !actor.trim() || !reason.trim()) return;
    await run("resolve-thread", async () => {
      const updated = await window.translunar.invoke(
        "discussion.thread.resolve",
        {
          threadId: thread.id,
          resolved,
          expectedRevision: thread.revision,
          actor: actor.trim(),
          reason: reason.trim(),
        },
      );
      await refreshThreadList(updated);
      setSelectedThread(updated);
      setNotice(resolved ? t("discussion.resolved") : t("discussion.reopened"));
    });
  };

  const refreshVisibleThreads = async () => {
    await run("refresh-threads", async () => {
      const page = await getThreadPage(threadOffset);
      applyThreadPage(page);
      if (selectedThread) {
        const authoritative = await loadExactThread(selectedThread);
        setSelectedThread(authoritative);
        await refreshMessages(authoritative, false);
      }
    });
  };

  const selectedDocument = activeDocuments.find(
    (item) => item.id === documentId,
  );
  const selectedSegment = segments.find((item) => item.id === segmentId);
  const createReady = canCreateThread(
    scope,
    documentId,
    segmentId,
    body,
    actor,
    reason,
  );

  return (
    <div className="discussion-workflow">
      <div className="discussion-feedback" aria-live="polite">
        {error ? (
          <p className="surface-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="surface-success" role="status">
            {notice}
          </p>
        ) : null}
      </div>

      <section className="insights-section discussion-compose">
        <PanelHeading
          eyebrow={t("discussion.localReview")}
          title={t("discussion.start")}
          icon={<Plus size={18} />}
        />

        <div
          className="discussion-scope-control"
          role="group"
          aria-label={t("discussion.scopeAria")}
        >
          {(["project", "document", "segment"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={scope === value}
              onClick={() => chooseScope(value)}
              disabled={!!busy}
            >
              {scopeLabel(value, t)}
            </button>
          ))}
        </div>

        {scope !== "project" ? (
          <label className="discussion-field">
            <span>{t("common.document")}</span>
            <select
              value={documentId}
              onChange={(event) => {
                setDocumentId(event.currentTarget.value);
                setThreadOffset(0);
                setSelectedThread(null);
              }}
              disabled={!!busy}
            >
              {activeDocuments.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {scope === "segment" ? (
          <label className="discussion-field">
            <span>{t("common.segment")}</span>
            <select
              value={segmentId}
              onChange={(event) => {
                setSegmentId(event.currentTarget.value);
                setThreadOffset(0);
                setSelectedThread(null);
              }}
              disabled={segmentsLoading || !!busy || segments.length === 0}
            >
              {segments.map((item) => (
                <option key={item.id} value={item.id}>
                  {`#${item.ordinal + 1} ${compactText(item.sourceText)}`}
                </option>
              ))}
            </select>
            {segmentTotal > SEGMENT_OPTION_LIMIT ? (
              <small>
                {t("discussion.segmentLimit", {
                  shown: SEGMENT_OPTION_LIMIT,
                  total: segmentTotal,
                })}
              </small>
            ) : null}
          </label>
        ) : null}

        <label className="discussion-field">
          <span>{t("discussion.titleOptional")}</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
            maxLength={256}
            placeholder={t("discussion.titlePlaceholder")}
            disabled={!!busy}
          />
        </label>
        <label className="discussion-field">
          <span>{t("discussion.firstMessage")}</span>
          <textarea
            value={body}
            onChange={(event) => setBody(event.currentTarget.value)}
            maxLength={16_384}
            placeholder={t("discussion.messagePlaceholder")}
            disabled={!!busy}
          />
        </label>

        <AuditFields
          actor={actor}
          reason={reason}
          disabled={!!busy}
          onActor={setActor}
          onReason={setReason}
        />

        <button
          className="button primary discussion-create-button"
          type="button"
          onClick={() => void createThread()}
          disabled={!createReady || !!busy}
        >
          {busy === "create-thread" ? null : (
            <Plus size={14} />
          )}
          {t("discussion.createDiscussion")}
        </button>
      </section>

      <section
        className="insights-section discussion-thread-browser"
        aria-label={t("discussion.threadsAria")}
      >
        <PanelHeading
          eyebrow={scopeLocation(scope, selectedDocument, selectedSegment, t)}
          title={t("common.threads")}
          icon={<MessageSquareText size={18} />}
          actions={
            <button
              className="icon-button"
              type="button"
              aria-label={t("discussion.refresh")}
              title={t("discussion.refresh")}
              onClick={() => void refreshVisibleThreads()}
              disabled={!!busy || threadsLoading}
            >
              <RefreshCw size={14} />
            </button>
          }
        />
        <label className="discussion-toggle">
          <input
            type="checkbox"
            checked={includeResolved}
            onChange={(event) => {
              setIncludeResolved(event.currentTarget.checked);
              setThreadOffset(0);
            }}
          />
          <span>{t("discussion.includeResolved")}</span>
        </label>

        {threadsLoading ? (
          <div className="discussion-loading" role="status">
            {t("discussion.loadingThreads")}
          </div>
        ) : threadPage && threadPage.items.length > 0 ? (
          <div className="discussion-thread-list">
            {threadPage.items.map((thread) => (
              <button
                key={thread.id}
                type="button"
                className="discussion-thread-row"
                data-selected={selectedThread?.id === thread.id}
                onClick={() => chooseThread(thread)}
              >
                <span className="discussion-thread-title">
                  <strong>{thread.title}</strong>
                  <span
                    className="discussion-status"
                    data-status={thread.status}
                  >
                    {thread.status}
                  </span>
                </span>
                <span className="discussion-thread-meta">
                  <span>
                    {t("discussion.messageCount", {
                      count: thread.messageCount,
                    })}
                  </span>
                  <time dateTime={new Date(thread.updatedAtMs).toISOString()}>
                    {formatDate(thread.updatedAtMs, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </time>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="discussion-empty">
            <MessageSquareText size={20} />
            <strong>{t("discussion.noMatching")}</strong>
            <span>{t("discussion.startOne")}</span>
          </div>
        )}

        <Pagination
          label={t("discussion.threadPages")}
          offset={threadPage?.offset ?? threadOffset}
          itemCount={threadPage?.items.length ?? 0}
          total={threadPage?.total ?? 0}
          limit={PAGE_SIZE}
          disabled={threadsLoading || !!busy}
          onPrevious={() =>
            setThreadOffset((current) => previousPageOffset(current, PAGE_SIZE))
          }
          onNext={() =>
            setThreadOffset((current) =>
              nextPageOffset(current, PAGE_SIZE, threadPage?.total ?? 0),
            )
          }
        />
      </section>

      <section
        className="insights-section discussion-thread-detail"
        aria-label={t("discussion.selectedAria")}
      >
        {selectedThread ? (
          <>
            <PanelHeading
              eyebrow={t("discussion.scopeTitle", {
                scope: scopeLabel(selectedThread.scope, t),
              })}
              title={selectedThread.title}
              icon={<AtSign size={18} />}
              actions={
                <button
                  className={
                    selectedThread.status === "open"
                      ? "button secondary"
                      : "button tertiary"
                  }
                  type="button"
                  onClick={() =>
                    void setThreadResolution(selectedThread.status === "open")
                  }
                  disabled={!!busy || !actor.trim() || !reason.trim()}
                >
                  {busy === "resolve-thread" ? null : selectedThread.status === "open" ? (
                    <CheckCircle2 size={14} />
                  ) : (
                    <RotateCcw size={14} />
                  )}
                  {selectedThread.status === "open"
                    ? t("discussion.resolve")
                    : t("discussion.reopen")}
                </button>
              }
            />

            <div className="discussion-thread-facts">
              <span
                className="discussion-status"
                data-status={selectedThread.status}
              >
                {selectedThread.status}
              </span>
              <span>
                {t("discussion.revision", {
                  revision: selectedThread.revision,
                })}
              </span>
              <span>
                {t("discussion.activeMessages", {
                  count: selectedThread.messageCount,
                })}
              </span>
              <span>
                {threadTarget(selectedThread, documents, segments, t)}
              </span>
            </div>

            {messagesLoading ? (
              <div className="discussion-loading" role="status">
                {t("discussion.loadingMessages")}
              </div>
            ) : messagePage && messagePage.items.length > 0 ? (
              <div className="discussion-message-list">
                {messagePage.items.map((message) => (
                  <article
                    key={message.id}
                    className="discussion-message"
                    data-deleted={message.deleted}
                  >
                    <header>
                      <div>
                        <strong>
                          {message.deleted
                            ? t("discussion.deletedMessage")
                            : message.actor}
                        </strong>
                        <span>#{message.ordinal + 1}</span>
                      </div>
                      <time
                        dateTime={new Date(message.updatedAtMs).toISOString()}
                      >
                        {formatDate(message.updatedAtMs, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </time>
                    </header>
                    {editingMessageId === message.id ? (
                      <div className="discussion-message-edit">
                        <label>
                          <span>{t("discussion.editMessage")}</span>
                          <textarea
                            value={editBody}
                            onChange={(event) =>
                              setEditBody(event.currentTarget.value)
                            }
                            maxLength={16_384}
                            autoFocus
                          />
                        </label>
                        <div>
                          <button
                            className="button tertiary"
                            type="button"
                            onClick={() => {
                              setEditingMessageId(null);
                              setEditBody("");
                            }}
                            disabled={!!busy}
                          >
                            <X size={13} />
                            {t("common.cancel")}
                          </button>
                          <button
                            className="button primary"
                            type="button"
                            onClick={() => void saveMessage(message)}
                            disabled={!editBody.trim() || !!busy}
                          >
                            {busy === `edit-${message.id}` ? null : (
                              <Save size={13} />
                            )}
                            {t("common.save")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p>{message.body}</p>
                    )}
                    {!message.deleted && message.mentions.length > 0 ? (
                      <div
                        className="discussion-mentions"
                        aria-label={t("discussion.mentionsAria")}
                      >
                        <AtSign size={12} />
                        {message.mentions.map((mention) => (
                          <span key={mention}>{mention}</span>
                        ))}
                      </div>
                    ) : null}
                    {!message.deleted &&
                    selectedThread.status === "open" &&
                    editingMessageId !== message.id ? (
                      <footer>
                        <button
                          className="icon-button"
                          type="button"
                          aria-label={t("discussion.editNamed", {
                            ordinal: message.ordinal + 1,
                          })}
                          title={t("discussion.editNamed", {
                            ordinal: message.ordinal + 1,
                          })}
                          onClick={() => {
                            setEditingMessageId(message.id);
                            setEditBody(message.body);
                          }}
                          disabled={!!busy}
                        >
                          <Edit3 size={13} />
                        </button>
                        <button
                          className="icon-button danger"
                          type="button"
                          aria-label={t("discussion.deleteNamed", {
                            ordinal: message.ordinal + 1,
                          })}
                          title={t("discussion.deleteNamed", {
                            ordinal: message.ordinal + 1,
                          })}
                          onClick={() => setDeleteMessage(message)}
                          disabled={!!busy}
                        >
                          <Trash2 size={13} />
                        </button>
                      </footer>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <div className="discussion-empty compact">
                <MessageSquareText size={18} />
                <strong>{t("discussion.noMessagesPage")}</strong>
              </div>
            )}

            <Pagination
              label={t("discussion.messagePages")}
              offset={messagePage?.offset ?? messageOffset}
              itemCount={messagePage?.items.length ?? 0}
              total={messagePage?.total ?? 0}
              limit={PAGE_SIZE}
              disabled={messagesLoading || !!busy}
              onPrevious={() =>
                setMessageOffset((current) =>
                  previousPageOffset(current, PAGE_SIZE),
                )
              }
              onNext={() =>
                setMessageOffset((current) =>
                  nextPageOffset(current, PAGE_SIZE, messagePage?.total ?? 0),
                )
              }
            />

            <div className="discussion-reply">
              <label>
                <span>{t("discussion.reply")}</span>
                <textarea
                  value={reply}
                  onChange={(event) => setReply(event.currentTarget.value)}
                  maxLength={16_384}
                  placeholder={
                    selectedThread.status === "open"
                      ? t("discussion.replyPlaceholder")
                      : t("discussion.reopenBeforeReply")
                  }
                  disabled={selectedThread.status !== "open" || !!busy}
                />
              </label>
              <button
                className="button primary"
                type="button"
                onClick={() => void createReply()}
                disabled={
                  selectedThread.status !== "open" ||
                  !reply.trim() ||
                  !actor.trim() ||
                  !reason.trim() ||
                  !!busy
                }
              >
                {busy === "create-message" ? null : (
                  <Send size={14} />
                )}
                {t("discussion.reply")}
              </button>
            </div>
          </>
        ) : (
          <div className="discussion-empty detail-empty">
            <MessageSquareText size={24} />
            <strong>{t("discussion.selectOne")}</strong>
            <span>{t("discussion.messagesHere")}</span>
          </div>
        )}
      </section>

      {deleteMessage ? (
        <div className="surface-dialog-backdrop" role="presentation">
          <section
            className="surface-dialog confirm-dialog discussion-delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="discussion-delete-title"
          >
            <header>
              <div>
                <span className="surface-kicker">
                  {t("discussion.tombstone")}
                </span>
                <h2 id="discussion-delete-title">
                  {t("discussion.deleteNamed", {
                    ordinal: deleteMessage.ordinal + 1,
                  })}
                </h2>
              </div>
              <Trash2 size={19} />
            </header>
            <p>{t("discussion.tombstoneBody3")}</p>
            <footer>
              <button
                className="button tertiary"
                type="button"
                onClick={() => setDeleteMessage(null)}
                disabled={!!busy}
              >
                {t("common.cancel")}
              </button>
              <button
                className="button danger"
                type="button"
                onClick={() => void confirmDeleteMessage()}
                disabled={!!busy}
              >
                {busy === `delete-${deleteMessage.id}` ? null : (
                  <Trash2 size={14} />
                )}
                {t("discussion.deleteAction")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function SnapshotPanel({
  snapshot,
  onRefresh,
}: Pick<DiscussionSnapshotPanelProps, "snapshot" | "onRefresh">) {
  const { t, formatDate, formatNumber } = useLocale();
  const projectId = snapshot.project.id;
  const [snapshotPage, setSnapshotPage] = useState<ProjectSnapshotPage | null>(
    null,
  );
  const [snapshotOffset, setSnapshotOffset] = useState(0);
  const [selectedSnapshot, setSelectedSnapshot] =
    useState<NamedProjectSnapshot | null>(null);
  const [preview, setPreview] = useState<ProjectSnapshotPreview | null>(null);
  const [name, setName] = useState("");
  const [actor, setActor] = useState("desktop-user");
  const [reason, setReason] = useState("Named project checkpoint");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);

  const getSnapshotPage = useCallback(
    (offset: number) =>
      window.translunar.invoke("project.snapshot.list", {
        projectId,
        offset,
        limit: PAGE_SIZE,
      }),
    [projectId],
  );

  const applySnapshotPage = useCallback((page: ProjectSnapshotPage) => {
    setSnapshotPage(page);
    setSelectedSnapshot((current) => {
      const updated = current
        ? page.items.find((item) => item.id === current.id)
        : undefined;
      return updated ?? page.items[0] ?? null;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getSnapshotPage(snapshotOffset)
      .then((page) => {
        if (!cancelled) applySnapshotPage(page);
      })
      .catch((reasonValue: unknown) => {
        if (!cancelled) setError(formatError(reasonValue));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applySnapshotPage, getSnapshotPage, snapshotOffset]);

  useEffect(() => {
    const snapshotId = selectedSnapshot?.id;
    if (!snapshotId) return;
    let cancelled = false;
    void window.translunar
      .invoke("project.snapshot.get", { snapshotId })
      .then((item) => {
        if (!cancelled) setSelectedSnapshot(item);
      })
      .catch((reasonValue: unknown) => {
        if (!cancelled) setError(formatError(reasonValue));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSnapshot?.id]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (reasonValue: unknown) {
      setError(formatError(reasonValue));
    } finally {
      setBusy(null);
    }
  };

  const createSnapshot = async () => {
    if (!name.trim() || !actor.trim() || !reason.trim()) return;
    await run("create-snapshot", async () => {
      const currentProject = await window.translunar.invoke("project.get", {
        projectId,
      });
      const created = await window.translunar.invoke(
        "project.snapshot.create",
        {
          projectId,
          name: name.trim(),
          expectedProjectRevision: currentProject.project.revision,
          actor: actor.trim(),
          reason: reason.trim(),
        },
      );
      const page = await getSnapshotPage(0);
      setSnapshotOffset(0);
      setSnapshotPage(page);
      setSelectedSnapshot(created);
      setPreview(null);
      setName("");
      setNotice(t("snapshot.created", { name: created.name }));
    });
  };

  const chooseSnapshot = (item: NamedProjectSnapshot) => {
    setSelectedSnapshot(item);
    setPreview(null);
    setConfirmRestore(false);
    setError(null);
    setNotice(null);
  };

  const previewRestore = async () => {
    const item = selectedSnapshot;
    if (!item) return;
    await run("preview-restore", async () => {
      const currentProject = await window.translunar.invoke("project.get", {
        projectId,
      });
      const result = await window.translunar.invoke(
        "project.snapshot.previewRestore",
        {
          snapshotId: item.id,
          expectedProjectRevision: currentProject.project.revision,
        },
      );
      setPreview(result);
      setConfirmRestore(false);
      setNotice(
        result.missingDependencyIds.length > 0
          ? t("snapshot.previewNeedsDeps")
          : t("snapshot.previewReady"),
      );
    });
  };

  const restoreSnapshot = async () => {
    const currentPreview = preview;
    if (
      !canRestoreSnapshot(currentPreview) ||
      !currentPreview ||
      !actor.trim() ||
      !reason.trim()
    ) {
      return;
    }
    await run("restore-snapshot", async () => {
      const result = await window.translunar.invoke(
        "project.snapshot.restore",
        {
          previewId: currentPreview.previewId,
          expectedProjectRevision: currentPreview.expectedProjectRevision,
          actor: actor.trim(),
          reason: reason.trim(),
        },
      );
      setPreview(applySnapshotRestoreResult(currentPreview, result));
      setConfirmRestore(false);
      setNotice(
        result.operationId
          ? t("snapshot.restoredWithOp", {
              id: result.operationId.slice(0, 12),
            })
          : t("snapshot.restored"),
      );
      await onRefresh();
      const page = await getSnapshotPage(snapshotOffset);
      applySnapshotPage(page);
    });
  };

  const refreshSnapshots = async () => {
    await run("refresh-snapshots", async () => {
      const page = await getSnapshotPage(snapshotOffset);
      applySnapshotPage(page);
      if (selectedSnapshot) {
        const item = await window.translunar.invoke("project.snapshot.get", {
          snapshotId: selectedSnapshot.id,
        });
        setSelectedSnapshot(item);
      }
    });
  };

  return (
    <div className="snapshot-workflow">
      <div className="discussion-feedback" aria-live="polite">
        {error ? (
          <p className="surface-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="surface-success" role="status">
            {notice}
          </p>
        ) : null}
      </div>

      <section className="insights-section snapshot-create">
        <PanelHeading
          eyebrow={t("snapshot.immutableCheckpoint")}
          title={t("snapshot.createNamed")}
          icon={<FolderGit2 size={18} />}
        />
        <label className="discussion-field">
          <span>{t("snapshot.name")}</span>
          <input
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            maxLength={256}
            placeholder={t("snapshot.namePlaceholder")}
            disabled={!!busy}
          />
        </label>
        <AuditFields
          actor={actor}
          reason={reason}
          disabled={!!busy}
          onActor={setActor}
          onReason={setReason}
        />
        <button
          className="button primary snapshot-create-button"
          type="button"
          onClick={() => void createSnapshot()}
          disabled={!name.trim() || !actor.trim() || !reason.trim() || !!busy}
        >
          {busy === "create-snapshot" ? null : (
            <Plus size={14} />
          )}
          {t("snapshot.create")}
        </button>
      </section>

      <section
        className="insights-section snapshot-browser"
        aria-label={t("snapshot.listAria")}
      >
        <PanelHeading
          eyebrow={t("snapshot.checkpointCount", {
            count: snapshotPage?.total ?? 0,
          })}
          title={t("common.snapshots")}
          icon={<Clock3 size={18} />}
          actions={
            <button
              className="icon-button"
              type="button"
              aria-label={t("snapshot.refresh")}
              title={t("snapshot.refresh")}
              onClick={() => void refreshSnapshots()}
              disabled={loading || !!busy}
            >
              <RefreshCw size={14} />
            </button>
          }
        />

        {loading ? (
          <div className="discussion-loading" role="status">
            {t("snapshot.loading")}
          </div>
        ) : snapshotPage && snapshotPage.items.length > 0 ? (
          <div className="snapshot-list">
            {snapshotPage.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="snapshot-row"
                data-selected={selectedSnapshot?.id === item.id}
                onClick={() => chooseSnapshot(item)}
              >
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {t("snapshot.revision", {
                      revision: item.baseProjectRevision,
                    })}
                  </small>
                </span>
                <time dateTime={new Date(item.createdAtMs).toISOString()}>
                  {formatDate(item.createdAtMs, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </time>
              </button>
            ))}
          </div>
        ) : (
          <div className="discussion-empty">
            <FolderGit2 size={20} />
            <strong>{t("snapshot.none")}</strong>
            <span>{t("snapshot.createCheckpoint")}</span>
          </div>
        )}

        <Pagination
          label={t("snapshot.snapshotPages")}
          offset={snapshotPage?.offset ?? snapshotOffset}
          itemCount={snapshotPage?.items.length ?? 0}
          total={snapshotPage?.total ?? 0}
          limit={PAGE_SIZE}
          disabled={loading || !!busy}
          onPrevious={() =>
            setSnapshotOffset((current) =>
              previousPageOffset(current, PAGE_SIZE),
            )
          }
          onNext={() =>
            setSnapshotOffset((current) =>
              nextPageOffset(current, PAGE_SIZE, snapshotPage?.total ?? 0),
            )
          }
        />
      </section>

      <section
        className="insights-section snapshot-detail"
        aria-label={t("snapshot.selectedAria")}
      >
        {selectedSnapshot ? (
          <>
            <PanelHeading
              eyebrow={t("snapshot.createdBy", {
                actor: selectedSnapshot.actor,
              })}
              title={selectedSnapshot.name}
              icon={<ArchiveRestore size={18} />}
              actions={
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => void previewRestore()}
                  disabled={!!busy}
                >
                  {busy === "preview-restore" ? null : (
                    <RefreshCw size={14} />
                  )}
                  {preview
                    ? t("snapshot.refreshPreview")
                    : t("snapshot.previewRestore")}
                </button>
              }
            />

            <dl className="snapshot-facts">
              <Fact
                label={t("snapshot.baseRevision")}
                value={formatNumber(selectedSnapshot.baseProjectRevision)}
              />
              <Fact
                label={t("snapshot.documents")}
                value={formatNumber(selectedSnapshot.documentCount)}
              />
              <Fact
                label={t("snapshot.segments")}
                value={formatNumber(selectedSnapshot.segmentCount)}
              />
              <Fact
                label={t("snapshot.threads")}
                value={formatNumber(selectedSnapshot.threadCount)}
              />
            </dl>
            <div className="snapshot-audit">
              <p>{selectedSnapshot.reason}</p>
              <code title={selectedSnapshot.stateHash}>
                {selectedSnapshot.stateHash}
              </code>
            </div>

            {preview ? (
              <section
                className="snapshot-preview"
                aria-label={t("snapshot.previewAria")}
              >
                <header>
                  <div>
                    <span className="surface-kicker">
                      {t("snapshot.revisionBoundPreview")}
                    </span>
                    <h3>{t("snapshot.workspaceChanges")}</h3>
                  </div>
                  <span
                    className="snapshot-preview-status"
                    data-status={preview.status}
                  >
                    {preview.status}
                  </span>
                </header>
                <div className="snapshot-change-grid">
                  {snapshotChangeItems(preview.summary, t).map((item) => (
                    <div key={item.key}>
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </div>
                  ))}
                </div>
                <div className="snapshot-preview-facts">
                  <span>
                    {t("snapshot.expectedRevision", {
                      revision: preview.expectedProjectRevision,
                    })}
                  </span>
                  <code title={preview.currentStateHash}>
                    {t("snapshot.state", {
                      digest: preview.currentStateHash.slice(0, 12),
                    })}
                  </code>
                </div>
                {preview.missingDependencyIds.length > 0 ? (
                  <div className="snapshot-missing" role="alert">
                    <strong>{t("snapshot.missingDeps")}</strong>
                    {preview.missingDependencyIds.map((id) => (
                      <code key={id}>{id}</code>
                    ))}
                  </div>
                ) : null}
                <button
                  className="button primary snapshot-restore-button"
                  type="button"
                  onClick={() => setConfirmRestore(true)}
                  disabled={
                    !canRestoreSnapshot(preview) ||
                    !actor.trim() ||
                    !reason.trim() ||
                    !!busy
                  }
                >
                  {preview.status === "applied" ? (
                    <Check size={14} />
                  ) : (
                    <ArchiveRestore size={14} />
                  )}
                  {preview.status === "applied"
                    ? t("snapshot.restoredLabel")
                    : t("snapshot.restoreSnapshot")}
                </button>
              </section>
            ) : (
              <div className="snapshot-preview-empty">
                <ArchiveRestore size={19} />
                <span>{t("snapshot.runPreviewFirst")}</span>
              </div>
            )}
          </>
        ) : (
          <div className="discussion-empty detail-empty">
            <FolderGit2 size={24} />
            <strong>{t("snapshot.selectOne")}</strong>
            <span>{t("snapshot.metaHere")}</span>
          </div>
        )}
      </section>

      {confirmRestore && preview && selectedSnapshot ? (
        <div className="surface-dialog-backdrop" role="presentation">
          <section
            className="surface-dialog confirm-dialog snapshot-restore-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="snapshot-restore-title"
          >
            <header>
              <div>
                <span className="surface-kicker">
                  {t("snapshot.atomicRestore")}
                </span>
                <h2 id="snapshot-restore-title">
                  {t("snapshot.restoreTitle", { name: selectedSnapshot.name })}
                </h2>
              </div>
              <ArchiveRestore size={20} />
            </header>
            <p>
              {t("snapshot.restoreBody", {
                revision: preview.expectedProjectRevision,
              })}
            </p>
            {error ? (
              <p className="surface-error" role="alert">
                {error}
              </p>
            ) : null}
            <footer>
              <button
                className="button tertiary"
                type="button"
                onClick={() => setConfirmRestore(false)}
                disabled={!!busy}
              >
                {t("common.cancel")}
              </button>
              <button
                className="button primary"
                type="button"
                onClick={() => void restoreSnapshot()}
                disabled={!!busy}
              >
                {busy === "restore-snapshot" ? null : (
                  <ArchiveRestore size={14} />
                )}
                {t("snapshot.restoreAction")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function PanelHeading({ eyebrow, title, icon, actions }: PanelHeadingProps) {
  return (
    <header className="insights-section-heading">
      <div>
        <span className="surface-kicker">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {actions ? (
        <div className="insights-section-actions">{actions}</div>
      ) : (
        icon
      )}
    </header>
  );
}

function AuditFields({
  actor,
  reason,
  disabled,
  onActor,
  onReason,
}: {
  actor: string;
  reason: string;
  disabled: boolean;
  onActor(value: string): void;
  onReason(value: string): void;
}) {
  const { t } = useLocale();
  return (
    <div className="discussion-audit-fields">
      <label className="discussion-field">
        <span>{t("common.actor")}</span>
        <input
          value={actor}
          onChange={(event) => onActor(event.currentTarget.value)}
          maxLength={128}
          disabled={disabled}
        />
      </label>
      <label className="discussion-field">
        <span>{t("common.reason")}</span>
        <input
          value={reason}
          onChange={(event) => onReason(event.currentTarget.value)}
          maxLength={512}
          disabled={disabled}
        />
      </label>
    </div>
  );
}

function Pagination({
  label,
  offset,
  itemCount,
  total,
  limit,
  disabled,
  onPrevious,
  onNext,
}: {
  label: string;
  offset: number;
  itemCount: number;
  total: number;
  limit: number;
  disabled: boolean;
  onPrevious(): void;
  onNext(): void;
}) {
  const { t } = useLocale();
  return (
    <nav className="discussion-pagination" aria-label={label}>
      <span>
        {pageRangeLabel(offset, itemCount, total, (start, end, count) =>
          t("common.pageRange", { start, end, total: count }),
        )}
      </span>
      <div>
        <button
          className="icon-button"
          type="button"
          aria-label={t("common.previousPage")}
          title={t("common.previousPage")}
          onClick={onPrevious}
          disabled={disabled || offset === 0}
        >
          <ChevronLeft size={14} />
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label={t("common.nextPage")}
          title={t("common.nextPage")}
          onClick={onNext}
          disabled={disabled || offset + limit >= total}
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </nav>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function canCreateThread(
  scope: DiscussionScope,
  documentId: string,
  segmentId: string,
  body: string,
  actor: string,
  reason: string,
): boolean {
  return (
    body.trim().length > 0 &&
    actor.trim().length > 0 &&
    reason.trim().length > 0 &&
    (scope === "project" || documentId.length > 0) &&
    (scope !== "segment" || segmentId.length > 0)
  );
}

function scopeLabel(scope: DiscussionScope, t: Translate): string {
  switch (scope) {
    case "project":
      return t("common.project");
    case "document":
      return t("common.document");
    case "segment":
      return t("common.segment");
  }
}

function scopeLocation(
  scope: DiscussionScope,
  document: Document | undefined,
  segment: Segment | undefined,
  t: Translate,
): string {
  if (scope === "project") return t("common.projectScope");
  if (scope === "document") return document?.name ?? t("common.documentScope");
  return segment
    ? t("common.documentSegmentPath", {
        document: document?.name ?? t("common.document"),
        ordinal: segment.ordinal + 1,
      })
    : t("common.segmentScope");
}

function threadTarget(
  thread: DiscussionThread,
  documents: Document[],
  segments: Segment[],
  t: Translate,
): string {
  if (thread.scope === "project") return t("common.entireProject");
  const targetDocument = documents.find(
    (item) => item.id === thread.documentId,
  );
  if (thread.scope === "document") {
    return targetDocument?.name ?? thread.documentId ?? t("common.unknown");
  }
  const targetSegment = segments.find((item) => item.id === thread.segmentId);
  return targetSegment
    ? t("common.documentSegmentPath", {
        document: targetDocument?.name ?? t("common.document"),
        ordinal: targetSegment.ordinal + 1,
      })
    : `${t("common.segment")} ${thread.segmentId?.slice(0, 12) ?? t("common.unknown")}`;
}

function compactText(value: string): string {
  const normalized = value.replaceAll(/\s+/gu, " ").trim();
  return normalized.length > 72 ? `${normalized.slice(0, 69)}...` : normalized;
}
