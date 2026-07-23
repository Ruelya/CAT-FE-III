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
  LoaderCircle,
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

type PanelMode = "discussions" | "snapshots";

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
  const [mode, setMode] = useState<PanelMode>("discussions");

  return (
    <div className="discussion-snapshot-layout">
      <div
        className="discussion-snapshot-mode-tabs"
        role="tablist"
        aria-label="Discussion and snapshot workflow"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "discussions"}
          onClick={() => setMode("discussions")}
        >
          <MessageSquareText size={15} />
          Discussions
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "snapshots"}
          onClick={() => setMode("snapshots")}
        >
          <FolderGit2 size={15} />
          Project snapshots
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
      setNotice("Discussion created with its first message.");
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
      setNotice("Reply added.");
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
      setNotice(`Message ${message.ordinal + 1} updated.`);
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
      setNotice(`Message ${message.ordinal + 1} deleted as a tombstone.`);
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
      setNotice(resolved ? "Discussion resolved." : "Discussion reopened.");
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
          eyebrow="Local review"
          title="Start a discussion"
          icon={<Plus size={18} />}
        />

        <div
          className="discussion-scope-control"
          role="group"
          aria-label="Discussion scope"
        >
          {(["project", "document", "segment"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={scope === value}
              onClick={() => chooseScope(value)}
              disabled={!!busy}
            >
              {scopeLabel(value)}
            </button>
          ))}
        </div>

        {scope !== "project" ? (
          <label className="discussion-field">
            <span>Document</span>
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
            <span>Segment</span>
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
                Showing the first {SEGMENT_OPTION_LIMIT} of {segmentTotal}
                segments.
              </small>
            ) : null}
          </label>
        ) : null}

        <label className="discussion-field">
          <span>Title (optional)</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
            maxLength={256}
            placeholder="Review question"
            disabled={!!busy}
          />
        </label>
        <label className="discussion-field">
          <span>First message</span>
          <textarea
            value={body}
            onChange={(event) => setBody(event.currentTarget.value)}
            maxLength={16_384}
            placeholder="Write a local note and use literal @mentions where useful."
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
          {busy === "create-thread" ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <Plus size={14} />
          )}
          Create discussion
        </button>
      </section>

      <section
        className="insights-section discussion-thread-browser"
        aria-label="Discussion threads"
      >
        <PanelHeading
          eyebrow={scopeLocation(scope, selectedDocument, selectedSegment)}
          title="Threads"
          icon={<MessageSquareText size={18} />}
          actions={
            <button
              className="icon-button"
              type="button"
              aria-label="Refresh discussions"
              title="Refresh discussions"
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
          <span>Include resolved</span>
        </label>

        {threadsLoading ? (
          <div className="discussion-loading" role="status">
            <LoaderCircle className="spin" size={17} /> Loading threads
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
                  <span>{thread.messageCount} messages</span>
                  <time dateTime={new Date(thread.updatedAtMs).toISOString()}>
                    {formatDateTime(thread.updatedAtMs)}
                  </time>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="discussion-empty">
            <MessageSquareText size={20} />
            <strong>No matching discussions</strong>
            <span>Start one for the selected scope.</span>
          </div>
        )}

        <Pagination
          label="Thread pages"
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
        aria-label="Selected discussion"
      >
        {selectedThread ? (
          <>
            <PanelHeading
              eyebrow={`${scopeLabel(selectedThread.scope)} discussion`}
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
                  {busy === "resolve-thread" ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : selectedThread.status === "open" ? (
                    <CheckCircle2 size={14} />
                  ) : (
                    <RotateCcw size={14} />
                  )}
                  {selectedThread.status === "open" ? "Resolve" : "Reopen"}
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
              <span>Revision {selectedThread.revision}</span>
              <span>{selectedThread.messageCount} active messages</span>
              <span>{threadTarget(selectedThread, documents, segments)}</span>
            </div>

            {messagesLoading ? (
              <div className="discussion-loading" role="status">
                <LoaderCircle className="spin" size={17} /> Loading messages
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
                          {message.deleted ? "Deleted message" : message.actor}
                        </strong>
                        <span>#{message.ordinal + 1}</span>
                      </div>
                      <time
                        dateTime={new Date(message.updatedAtMs).toISOString()}
                      >
                        {formatDateTime(message.updatedAtMs)}
                      </time>
                    </header>
                    {editingMessageId === message.id ? (
                      <div className="discussion-message-edit">
                        <label>
                          <span>Edit message</span>
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
                            <X size={13} /> Cancel
                          </button>
                          <button
                            className="button primary"
                            type="button"
                            onClick={() => void saveMessage(message)}
                            disabled={!editBody.trim() || !!busy}
                          >
                            {busy === `edit-${message.id}` ? (
                              <LoaderCircle className="spin" size={13} />
                            ) : (
                              <Save size={13} />
                            )}
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p>{message.body}</p>
                    )}
                    {!message.deleted && message.mentions.length > 0 ? (
                      <div
                        className="discussion-mentions"
                        aria-label="Literal mentions"
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
                          aria-label={`Edit message ${message.ordinal + 1}`}
                          title={`Edit message ${message.ordinal + 1}`}
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
                          aria-label={`Delete message ${message.ordinal + 1}`}
                          title={`Delete message ${message.ordinal + 1}`}
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
                <strong>No messages on this page</strong>
              </div>
            )}

            <Pagination
              label="Message pages"
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
                <span>Reply</span>
                <textarea
                  value={reply}
                  onChange={(event) => setReply(event.currentTarget.value)}
                  maxLength={16_384}
                  placeholder={
                    selectedThread.status === "open"
                      ? "Add a local reply"
                      : "Reopen this discussion before replying"
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
                {busy === "create-message" ? (
                  <LoaderCircle className="spin" size={14} />
                ) : (
                  <Send size={14} />
                )}
                Reply
              </button>
            </div>
          </>
        ) : (
          <div className="discussion-empty detail-empty">
            <MessageSquareText size={24} />
            <strong>Select a discussion</strong>
            <span>Messages and revision-bound actions appear here.</span>
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
                <span className="surface-kicker">Durable tombstone</span>
                <h2 id="discussion-delete-title">
                  Delete message {deleteMessage.ordinal + 1}
                </h2>
              </div>
              <Trash2 size={19} />
            </header>
            <p>
              The message body will be replaced by an auditable tombstone. Its
              ordinal remains in the thread history.
            </p>
            <footer>
              <button
                className="button tertiary"
                type="button"
                onClick={() => setDeleteMessage(null)}
                disabled={!!busy}
              >
                Cancel
              </button>
              <button
                className="button danger"
                type="button"
                onClick={() => void confirmDeleteMessage()}
                disabled={!!busy}
              >
                {busy === `delete-${deleteMessage.id}` ? (
                  <LoaderCircle className="spin" size={14} />
                ) : (
                  <Trash2 size={14} />
                )}
                Delete message
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
      setNotice(`Snapshot ${created.name} created.`);
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
          ? "Preview is ready, but dependencies must be restored before apply."
          : "Restore preview is ready.",
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
          ? `Snapshot restored in operation ${result.operationId.slice(0, 12)}.`
          : "Snapshot restored.",
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
          eyebrow="Immutable checkpoint"
          title="Create a named snapshot"
          icon={<FolderGit2 size={18} />}
        />
        <label className="discussion-field">
          <span>Snapshot name</span>
          <input
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            maxLength={256}
            placeholder="Before legal review"
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
          {busy === "create-snapshot" ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <Plus size={14} />
          )}
          Create snapshot
        </button>
      </section>

      <section
        className="insights-section snapshot-browser"
        aria-label="Project snapshots"
      >
        <PanelHeading
          eyebrow={`${snapshotPage?.total ?? 0} immutable checkpoints`}
          title="Snapshots"
          icon={<Clock3 size={18} />}
          actions={
            <button
              className="icon-button"
              type="button"
              aria-label="Refresh project snapshots"
              title="Refresh project snapshots"
              onClick={() => void refreshSnapshots()}
              disabled={loading || !!busy}
            >
              <RefreshCw size={14} />
            </button>
          }
        />

        {loading ? (
          <div className="discussion-loading" role="status">
            <LoaderCircle className="spin" size={17} /> Loading snapshots
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
                  <small>Revision {item.baseProjectRevision}</small>
                </span>
                <time dateTime={new Date(item.createdAtMs).toISOString()}>
                  {formatDateTime(item.createdAtMs)}
                </time>
              </button>
            ))}
          </div>
        ) : (
          <div className="discussion-empty">
            <FolderGit2 size={20} />
            <strong>No project snapshots</strong>
            <span>Create a named checkpoint for this project.</span>
          </div>
        )}

        <Pagination
          label="Snapshot pages"
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
        aria-label="Selected project snapshot"
      >
        {selectedSnapshot ? (
          <>
            <PanelHeading
              eyebrow={`Created by ${selectedSnapshot.actor}`}
              title={selectedSnapshot.name}
              icon={<ArchiveRestore size={18} />}
              actions={
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => void previewRestore()}
                  disabled={!!busy}
                >
                  {busy === "preview-restore" ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <RefreshCw size={14} />
                  )}
                  {preview ? "Refresh preview" : "Preview restore"}
                </button>
              }
            />

            <dl className="snapshot-facts">
              <Fact
                label="Base revision"
                value={selectedSnapshot.baseProjectRevision}
              />
              <Fact label="Documents" value={selectedSnapshot.documentCount} />
              <Fact label="Segments" value={selectedSnapshot.segmentCount} />
              <Fact label="Threads" value={selectedSnapshot.threadCount} />
            </dl>
            <div className="snapshot-audit">
              <p>{selectedSnapshot.reason}</p>
              <code title={selectedSnapshot.stateHash}>
                {selectedSnapshot.stateHash}
              </code>
            </div>

            {preview ? (
              <section className="snapshot-preview" aria-label="Restore preview">
                <header>
                  <div>
                    <span className="surface-kicker">
                      Revision-bound preview
                    </span>
                    <h3>Workspace changes</h3>
                  </div>
                  <span
                    className="snapshot-preview-status"
                    data-status={preview.status}
                  >
                    {preview.status}
                  </span>
                </header>
                <div className="snapshot-change-grid">
                  {snapshotChangeItems(preview.summary).map((item) => (
                    <div key={item.key}>
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </div>
                  ))}
                </div>
                <div className="snapshot-preview-facts">
                  <span>
                    Expected revision {preview.expectedProjectRevision}
                  </span>
                  <code title={preview.currentStateHash}>
                    State {preview.currentStateHash.slice(0, 12)}
                  </code>
                </div>
                {preview.missingDependencyIds.length > 0 ? (
                  <div className="snapshot-missing" role="alert">
                    <strong>Missing mounted dependencies</strong>
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
                    ? "Restored"
                    : "Restore snapshot"}
                </button>
              </section>
            ) : (
              <div className="snapshot-preview-empty">
                <ArchiveRestore size={19} />
                <span>Run a preview before restoring this snapshot.</span>
              </div>
            )}
          </>
        ) : (
          <div className="discussion-empty detail-empty">
            <FolderGit2 size={24} />
            <strong>Select a snapshot</strong>
            <span>Metadata and restore preview appear here.</span>
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
                <span className="surface-kicker">Atomic restore</span>
                <h2 id="snapshot-restore-title">
                  Restore {selectedSnapshot.name}
                </h2>
              </div>
              <ArchiveRestore size={20} />
            </header>
            <p>
              The Engine will recheck project revision{" "}
              {preview.expectedProjectRevision}
              and the current state digest before applying this preview in one
              transaction.
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
                Cancel
              </button>
              <button
                className="button primary"
                type="button"
                onClick={() => void restoreSnapshot()}
                disabled={!!busy}
              >
                {busy === "restore-snapshot" ? (
                  <LoaderCircle className="spin" size={14} />
                ) : (
                  <ArchiveRestore size={14} />
                )}
                Restore snapshot
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
  return (
    <div className="discussion-audit-fields">
      <label className="discussion-field">
        <span>Actor</span>
        <input
          value={actor}
          onChange={(event) => onActor(event.currentTarget.value)}
          maxLength={128}
          disabled={disabled}
        />
      </label>
      <label className="discussion-field">
        <span>Reason</span>
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
  return (
    <nav className="discussion-pagination" aria-label={label}>
      <span>{pageRangeLabel(offset, itemCount, total)}</span>
      <div>
        <button
          className="icon-button"
          type="button"
          aria-label="Previous page"
          title="Previous page"
          onClick={onPrevious}
          disabled={disabled || offset === 0}
        >
          <ChevronLeft size={14} />
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label="Next page"
          title="Next page"
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

function scopeLabel(scope: DiscussionScope): string {
  switch (scope) {
    case "project":
      return "Project";
    case "document":
      return "Document";
    case "segment":
      return "Segment";
  }
}

function scopeLocation(
  scope: DiscussionScope,
  document: Document | undefined,
  segment: Segment | undefined,
): string {
  if (scope === "project") return "Project scope";
  if (scope === "document") return document?.name ?? "Document scope";
  return segment
    ? `${document?.name ?? "Document"} / segment ${segment.ordinal + 1}`
    : "Segment scope";
}

function threadTarget(
  thread: DiscussionThread,
  documents: Document[],
  segments: Segment[],
): string {
  if (thread.scope === "project") return "Entire project";
  const targetDocument = documents.find(
    (item) => item.id === thread.documentId,
  );
  if (thread.scope === "document") {
    return targetDocument?.name ?? thread.documentId ?? "Unknown document";
  }
  const targetSegment = segments.find((item) => item.id === thread.segmentId);
  return targetSegment
    ? `${targetDocument?.name ?? "Document"} / segment ${targetSegment.ordinal + 1}`
    : `Segment ${thread.segmentId?.slice(0, 12) ?? "unknown"}`;
}

function compactText(value: string): string {
  const normalized = value.replaceAll(/\s+/gu, " ").trim();
  return normalized.length > 72 ? `${normalized.slice(0, 69)}...` : normalized;
}

function formatDateTime(value: number): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
