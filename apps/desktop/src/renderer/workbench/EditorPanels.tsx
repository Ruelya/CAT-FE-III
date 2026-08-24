import { useState } from "react";
import type { InlineTag } from "@translunar/contracts";

import { formatUiError } from "../lib/errors";
import { ConfirmDialog } from "../shell/ConfirmDialog";
import { EditorPanelShell } from "./EditorPanelShell";
import type { EditorOperationsApi } from "../state/use-editor-operations";
import { useEditorDisplay } from "../state/use-editor-display";

export interface EditorPanelsProps {
  ops: EditorOperationsApi;
  disabled?: boolean;
  sourceTags?: InlineTag[];
  tagIssues?: Array<{ code: string; message: string }>;
}

export function EditorPanels({
  ops,
  disabled,
  sourceTags = [],
  tagIssues = [],
}: EditorPanelsProps) {
  const busy = disabled || ops.busy;
  const panel = ops.panel;
  const [view, setView] = useEditorDisplay();
  const [deleteComment, setDeleteComment] = useState<{
    id: string;
    revision: number;
  } | null>(null);

  if (!panel) return null;

  if (panel === "findReplace") {
    const fr = ops.findReplace;
    return (
      <EditorPanelShell
        title="Find"
        onClose={ops.closePanel}
        testId="panel-find-replace"
      >
        <div className="editor-panel__body">
          <label className="field">
            <span>Query</span>
            <input
              value={fr.query}
              onChange={(e) => ops.setFindQuery(e.target.value)}
              disabled={busy}
              data-testid="find-query"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (fr.matches.length > 0) {
                    const current = fr.matches[0];
                    if (current) void ops.selectFindMatch(current.segmentId);
                  } else {
                    void ops.runFind(0);
                  }
                }
              }}
            />
          </label>
          <label className="field">
            <span>Replace</span>
            <input
              value={fr.replacement}
              onChange={(e) => ops.setReplacement(e.target.value)}
              disabled={busy}
              data-testid="find-replacement"
            />
          </label>
          <label className="field">
            <span>Field</span>
            <select
              value={fr.field}
              onChange={(e) =>
                ops.setFindField(e.target.value as "source" | "target" | "both")
              }
              disabled={busy}
            >
              <option value="target">Target</option>
              <option value="source">Source</option>
              <option value="both">Both</option>
            </select>
          </label>
          <div className="editor-panel__row">
            <label>
              <input
                type="checkbox"
                checked={fr.caseSensitive}
                onChange={(e) =>
                  ops.setFindOptions({ caseSensitive: e.target.checked })
                }
                disabled={busy}
              />{" "}
              Case
            </label>
            <label>
              <input
                type="checkbox"
                checked={fr.wholeWord}
                onChange={(e) =>
                  ops.setFindOptions({ wholeWord: e.target.checked })
                }
                disabled={busy}
              />{" "}
              Word
            </label>
            <label>
              <input
                type="checkbox"
                checked={fr.regex}
                onChange={(e) =>
                  ops.setFindOptions({ regex: e.target.checked })
                }
                disabled={busy}
              />{" "}
              Regex
            </label>
          </div>
          <div className="dialog__actions">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={busy || !fr.query.trim()}
              onClick={() => void ops.runFind(0)}
              data-testid="find-run"
            >
              Find
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={busy || !fr.query}
              onClick={() => void ops.runPreview()}
              data-testid="find-preview"
            >
              Preview
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={
                busy ||
                !fr.preview ||
                fr.previewStatus === "applying" ||
                fr.previewStatus === "loading"
              }
              onClick={() => void ops.applyReplace()}
              data-testid="find-apply"
            >
              Apply
            </button>
          </div>
          {fr.findError ? (
            <p className="error-text">{formatUiError(fr.findError)}</p>
          ) : null}
          {fr.previewError ? (
            <p className="error-text">{formatUiError(fr.previewError)}</p>
          ) : null}
          {fr.findStatus === "loading" ? (
            <p className="muted">Loading</p>
          ) : null}
          {fr.findStatus === "ready" && fr.matches.length === 0 ? (
            <p className="muted" data-testid="find-empty">
              No matches
            </p>
          ) : null}
          {fr.findStatus === "ready" && fr.findTotal > 0 ? (
            <p className="muted" data-testid="find-count">
              {fr.findTotal} {fr.findTotal === 1 ? "match" : "matches"}
            </p>
          ) : null}
          {fr.matches.length > 0 ? (
            <ul className="editor-panel__list" data-testid="find-matches">
              {fr.matches.map((m) => (
                <li key={`${m.segmentId}-${m.start}-${m.field}`}>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => void ops.selectFindMatch(m.segmentId)}
                  >
                    {m.field} · {m.matchedText}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {fr.findTotal > fr.findLimit ? (
            <div className="dialog__actions">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={busy || fr.findOffset <= 0}
                onClick={() =>
                  void ops.runFind(Math.max(0, fr.findOffset - fr.findLimit))
                }
              >
                Prev
              </button>
              <span className="muted">
                {fr.findOffset + 1}-
                {Math.min(fr.findOffset + fr.matches.length, fr.findTotal)} /{" "}
                {fr.findTotal}
              </span>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={
                  busy || fr.findOffset + fr.matches.length >= fr.findTotal
                }
                onClick={() => void ops.runFind(fr.findOffset + fr.findLimit)}
              >
                Next
              </button>
            </div>
          ) : null}
          {fr.preview ? (
            <div data-testid="replace-preview">
              <p className="muted">
                {fr.preview.changedSegments} segments ·{" "}
                {fr.preview.replacementCount} replacements
              </p>
              <ul className="editor-panel__list">
                {fr.preview.items.slice(0, 20).map((item) => (
                  <li key={item.segmentId}>
                    <strong>{item.segmentId}</strong>
                    <div className="muted">{item.before}</div>
                    <div>{item.after}</div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </EditorPanelShell>
    );
  }

  if (panel === "tags") {
    return (
      <EditorPanelShell
        title="Tags"
        onClose={ops.closePanel}
        testId="panel-tags"
      >
        <div className="editor-panel__body">
          <h3 className="insights-heading">Source</h3>
          <ul className="editor-panel__list">
            {sourceTags.map((t) => (
              <li key={t.id}>
                {t.displayText || t.payload} · {t.kind}
                {t.protected ? " · protected" : ""}
              </li>
            ))}
            {sourceTags.length === 0 ? <li className="muted">None</li> : null}
          </ul>
          <h3 className="insights-heading">Target</h3>
          <ul className="editor-panel__list">
            {ops.targetTagsDraft.map((t, index) => (
              <li key={t.id}>
                <label className="field">
                  <span>{t.displayText || t.id}</span>
                  <input
                    type="number"
                    value={t.position}
                    disabled={busy}
                    onChange={(e) => {
                      const next = [...ops.targetTagsDraft];
                      next[index] = {
                        ...t,
                        position: Number(e.target.value) || 0,
                      };
                      ops.setTargetTagsDraft(next);
                    }}
                  />
                </label>
              </li>
            ))}
            {ops.targetTagsDraft.length === 0 ? (
              <li className="muted">None</li>
            ) : null}
          </ul>
          {tagIssues.length > 0 ? (
            <ul className="editor-panel__list" data-testid="tag-issues">
              {tagIssues.map((issue, i) => (
                <li key={`${issue.code}-${i}`} className="error-text">
                  {issue.message} ({issue.code})
                </li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={busy}
            onClick={() => void ops.submitTags()}
            data-testid="tags-submit"
          >
            Apply tags
          </button>
        </div>
      </EditorPanelShell>
    );
  }

  if (panel === "propagate") {
    return (
      <ConfirmDialog
        title="Propagate"
        body="Propagate the active segment target to matching unconfirmed sources in every file in this job."
        confirmLabel="Propagate"
        pending={ops.busy}
        error={ops.commandError ? formatUiError(ops.commandError) : null}
        onCancel={ops.closePanel}
        onConfirm={() => {
          void ops.confirmPropagate();
        }}
        testId="propagate-confirm"
      />
    );
  }

  if (panel === "structure") {
    return (
      <EditorPanelShell
        title={ops.structureMode === "merge" ? "Merge" : "Split"}
        onClose={ops.closePanel}
        testId="panel-structure"
      >
        <div className="editor-panel__body">
          {ops.structureMode === "split" ? (
            <>
              <label className="field">
                <span>Source offset</span>
                <input
                  type="number"
                  min={0}
                  value={ops.splitSourceOffset}
                  disabled={busy}
                  onChange={(e) =>
                    ops.setSplitOffsets(
                      Number(e.target.value) || 0,
                      ops.splitTargetOffset,
                    )
                  }
                  data-testid="split-source-offset"
                />
              </label>
              <label className="field">
                <span>Target offset</span>
                <input
                  type="number"
                  min={0}
                  value={ops.splitTargetOffset}
                  disabled={busy}
                  onChange={(e) =>
                    ops.setSplitOffsets(
                      ops.splitSourceOffset,
                      Number(e.target.value) || 0,
                    )
                  }
                  data-testid="split-target-offset"
                />
              </label>
            </>
          ) : (
            <p className="muted">Two adjacent segments required</p>
          )}
          <div className="dialog__actions">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={ops.closePanel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={busy}
              onClick={() => void ops.confirmStructure()}
              data-testid="structure-confirm"
            >
              Confirm
            </button>
          </div>
        </div>
      </EditorPanelShell>
    );
  }

  if (panel === "sourceCorrection") {
    return (
      <EditorPanelShell
        title="Source"
        onClose={ops.closePanel}
        testId="panel-source-correction"
      >
        <div className="editor-panel__body">
          <label className="field">
            <span>Source text</span>
            <textarea
              rows={4}
              value={ops.sourceDraft}
              disabled={busy}
              onChange={(e) => ops.setSourceDraft(e.target.value)}
              data-testid="source-draft"
            />
          </label>
          <div className="dialog__actions">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={ops.closePanel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={busy || !ops.sourceDraft.trim()}
              onClick={() => void ops.confirmSourceCorrection()}
              data-testid="source-confirm"
            >
              Correct
            </button>
          </div>
        </div>
      </EditorPanelShell>
    );
  }

  if (panel === "comments") {
    return (
      <EditorPanelShell
        title="Comments"
        onClose={ops.closePanel}
        testId="panel-comments"
      >
        <div className="editor-panel__body">
          {ops.commentsLoading ? <p className="muted">Loading</p> : null}
          {ops.commentsError ? (
            <p className="error-text">{formatUiError(ops.commentsError)}</p>
          ) : null}
          <ul className="editor-panel__list">
            {ops.comments.map((c) => (
              <li key={c.id}>
                {ops.editingCommentId === c.id ? (
                  <div className="editor-panel__row">
                    <input
                      value={ops.editingCommentText}
                      disabled={busy || c.immutable}
                      onChange={(e) =>
                        ops.setEditingComment(c.id, e.target.value)
                      }
                      data-testid={`comment-edit-${c.id}`}
                      aria-label="Edit comment"
                    />
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      disabled={
                        busy || c.immutable || !ops.editingCommentText.trim()
                      }
                      onClick={() =>
                        void ops.updateComment(
                          c.id,
                          c.revision,
                          ops.editingCommentText,
                        )
                      }
                      data-testid={`comment-save-${c.id}`}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={busy}
                      onClick={() => ops.setEditingComment(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div>
                    {c.text}
                    {c.resolved ? " · resolved" : ""}
                  </div>
                )}
                <div className="muted">
                  {c.author} · r{c.revision}
                  {c.immutable ? " · locked" : ""}
                </div>
                <div className="dialog__actions">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={busy}
                    onClick={() =>
                      void ops.resolveComment(c.id, c.revision, !c.resolved)
                    }
                  >
                    {c.resolved ? "Reopen" : "Resolve"}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={busy || c.immutable}
                    onClick={() => ops.setEditingComment(c.id, c.text)}
                    data-testid={`comment-edit-btn-${c.id}`}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={busy || c.immutable}
                    onClick={() =>
                      setDeleteComment({ id: c.id, revision: c.revision })
                    }
                    data-testid={`comment-delete-btn-${c.id}`}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
            {!ops.commentsLoading && ops.comments.length === 0 ? (
              <li className="muted">No comments</li>
            ) : null}
          </ul>
          <label className="field">
            <span>New</span>
            <input
              value={ops.commentText}
              disabled={busy}
              onChange={(e) => ops.setCommentText(e.target.value)}
              data-testid="comment-text"
            />
          </label>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={busy || !ops.commentText.trim()}
            onClick={() => void ops.createComment()}
            data-testid="comment-create"
          >
            Add
          </button>
        </div>
        {deleteComment ? (
          <ConfirmDialog
            title="Delete comment"
            body="Delete this comment?"
            confirmLabel="Delete"
            pending={busy}
            error={ops.commentsError ? formatUiError(ops.commentsError) : null}
            onCancel={() => setDeleteComment(null)}
            onConfirm={() => {
              void ops
                .deleteComment(deleteComment.id, deleteComment.revision)
                .then((ok) => {
                  if (ok) setDeleteComment(null);
                });
            }}
            testId="comment-delete-confirm"
          />
        ) : null}
      </EditorPanelShell>
    );
  }

  if (panel === "spell") {
    return (
      <EditorPanelShell
        title="Spell"
        onClose={ops.closePanel}
        testId="panel-spell"
      >
        <div className="editor-panel__body">
          <div className="editor-panel__row">
            <label>
              <input
                type="radio"
                name="spell-side"
                checked={ops.spellSide === "target"}
                onChange={() => ops.setSpellSide("target")}
                disabled={busy}
              />{" "}
              Target
            </label>
            <label>
              <input
                type="radio"
                name="spell-side"
                checked={ops.spellSide === "source"}
                onChange={() => ops.setSpellSide("source")}
                disabled={busy}
              />{" "}
              Source
            </label>
          </div>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={busy}
            onClick={() => void ops.runSpellCheck()}
            data-testid="spell-check"
          >
            Check
          </button>
          {ops.spellResult ? (
            <div data-testid="spell-result">
              <p className="muted">
                {ops.spellResult.provider}
                {ops.spellResult.available ? "" : " · unavailable"}
              </p>
              <ul className="editor-panel__list">
                {ops.spellResult.findings.map((f, i) => (
                  <li key={`${f.start}-${i}`}>
                    {f.word}
                    {f.suggestions.length
                      ? ` → ${f.suggestions.slice(0, 3).join(", ")}`
                      : ""}
                  </li>
                ))}
                {ops.spellResult.available &&
                ops.spellResult.findings.length === 0 ? (
                  <li className="muted">No findings</li>
                ) : null}
              </ul>
            </div>
          ) : null}
          <h3 className="insights-heading">Dictionary</h3>
          {ops.dictionaryLoading ? <p className="muted">Loading</p> : null}
          {ops.dictionaryError ? (
            <p className="error-text">{formatUiError(ops.dictionaryError)}</p>
          ) : null}
          <ul className="editor-panel__list">
            {ops.dictionaryWords.map((w) => (
              <li key={w}>
                {w}{" "}
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={busy}
                  onClick={() => void ops.removeDictionaryWord(w)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <label className="field">
            <span>Word</span>
            <input
              value={ops.dictionaryWord}
              disabled={busy}
              onChange={(e) => ops.setDictionaryWord(e.target.value)}
              data-testid="dictionary-word"
            />
          </label>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={busy || !ops.dictionaryWord.trim()}
            onClick={() => void ops.addDictionaryWord()}
            data-testid="dictionary-add"
          >
            Add
          </button>
        </div>
      </EditorPanelShell>
    );
  }

  if (panel === "chinese") {
    return (
      <EditorPanelShell
        title="Chinese"
        onClose={ops.closePanel}
        testId="panel-chinese"
      >
        <div className="editor-panel__body">
          <ul className="editor-panel__list">
            {ops.chineseProfiles.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={busy}
                  onClick={() => void ops.convertChinese(p.id)}
                  data-testid={`chinese-${p.id}`}
                >
                  {p.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </EditorPanelShell>
    );
  }

  if (panel === "history") {
    return (
      <EditorPanelShell
        title="History"
        onClose={ops.closePanel}
        testId="panel-history"
      >
        <div className="editor-panel__body">
          <div className="dialog__actions">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={busy || !ops.canUndo}
              onClick={() => void ops.undo()}
              data-testid="history-undo"
            >
              Undo
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={busy || !ops.canRedo}
              onClick={() => void ops.redo()}
              data-testid="history-redo"
            >
              Redo
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={busy}
              onClick={() => void ops.loadHistory()}
            >
              Refresh
            </button>
          </div>
          {ops.historyLoading ? <p className="muted">Loading</p> : null}
          {ops.historyError ? (
            <p className="error-text">{formatUiError(ops.historyError)}</p>
          ) : null}
          <ul className="editor-panel__list">
            {ops.history?.operations.map((op) => (
              <li key={op.id}>
                {op.kind} · {op.entityType}/{op.entityId} · {op.actor}
              </li>
            ))}
            {ops.history && ops.history.operations.length === 0 ? (
              <li className="muted">Empty</li>
            ) : null}
          </ul>
        </div>
      </EditorPanelShell>
    );
  }

  if (panel === "preferences") {
    const prefs = ops.preferences;
    return (
      <EditorPanelShell
        title="Preferences"
        onClose={ops.closePanel}
        testId="panel-preferences"
      >
        <div className="editor-panel__body">
          {ops.preferencesLoading ? <p className="muted">Loading</p> : null}
          {ops.preferencesError ? (
            <p className="error-text">{formatUiError(ops.preferencesError)}</p>
          ) : null}
          {prefs ? (
            <>
              <label className="field">
                <span>Zoom</span>
                <input
                  type="number"
                  step={0.1}
                  min={0.5}
                  max={3}
                  value={prefs.zoom}
                  disabled={busy || ops.preferencesPending}
                  onChange={(e) =>
                    ops.setPreferenceField("zoom", Number(e.target.value) || 1)
                  }
                  data-testid="pref-zoom"
                />
              </label>
              <label className="field">
                <span>Theme</span>
                <input
                  value={prefs.theme}
                  disabled={busy || ops.preferencesPending}
                  onChange={(e) =>
                    ops.setPreferenceField("theme", e.target.value)
                  }
                  data-testid="pref-theme"
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={view.whitespace}
                  disabled={busy || ops.preferencesPending}
                  onChange={(e) => {
                    setView({ whitespace: e.target.checked });
                    ops.setPreferenceField("showNonprinting", e.target.checked);
                  }}
                  data-testid="pref-nonprinting"
                />{" "}
                Nonprinting
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={prefs.autocomplete}
                  disabled={busy || ops.preferencesPending}
                  onChange={(e) =>
                    ops.setPreferenceField("autocomplete", e.target.checked)
                  }
                />{" "}
                Autocomplete
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={prefs.cjkSpacing}
                  disabled={busy || ops.preferencesPending}
                  onChange={(e) =>
                    ops.setPreferenceField("cjkSpacing", e.target.checked)
                  }
                />{" "}
                CJK spacing
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={prefs.punctuationAssistance}
                  disabled={busy || ops.preferencesPending}
                  onChange={(e) =>
                    ops.setPreferenceField(
                      "punctuationAssistance",
                      e.target.checked,
                    )
                  }
                />{" "}
                Punctuation
              </label>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={busy || ops.preferencesPending}
                onClick={() => void ops.savePreferences()}
                data-testid="pref-save"
              >
                Save
              </button>
            </>
          ) : null}
        </div>
      </EditorPanelShell>
    );
  }

  if (panel === "review") {
    return (
      <EditorPanelShell
        title="Review"
        onClose={ops.closePanel}
        testId="panel-review"
      >
        <div className="editor-panel__body">
          {ops.reviewLoading ? <p className="muted">Loading</p> : null}
          {ops.reviewError ? (
            <p className="error-text">{formatUiError(ops.reviewError)}</p>
          ) : null}
          <ul className="editor-panel__list" data-testid="review-queue">
            {ops.reviewItems.map((item) => (
              <li key={item.revision.id}>
                <div>
                  #{item.segmentOrdinal} · {item.documentName}
                </div>
                <div className="muted">
                  {item.revision.author} · {item.revision.reason}
                </div>
                <div className="muted">
                  Before: {item.revision.beforeTarget}
                </div>
                <div>Proposed: {item.revision.proposedTarget}</div>
                <div className="dialog__actions">
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    disabled={busy || ops.reviewPendingId === item.revision.id}
                    onClick={() => void ops.acceptReview(item)}
                    data-testid={`review-accept-${item.revision.id}`}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    disabled={busy || ops.reviewPendingId === item.revision.id}
                    onClick={() => void ops.rejectReview(item)}
                    data-testid={`review-reject-${item.revision.id}`}
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
            {!ops.reviewLoading && ops.reviewItems.length === 0 ? (
              <li className="muted">Empty</li>
            ) : null}
          </ul>
          {ops.reviewTotal > ops.reviewLimit ? (
            <div className="dialog__actions">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={busy || ops.reviewOffset <= 0}
                onClick={() =>
                  void ops.loadReviewQueue(
                    Math.max(0, ops.reviewOffset - ops.reviewLimit),
                  )
                }
              >
                Prev
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={
                  busy ||
                  ops.reviewOffset + ops.reviewItems.length >= ops.reviewTotal
                }
                onClick={() =>
                  void ops.loadReviewQueue(ops.reviewOffset + ops.reviewLimit)
                }
              >
                Next
              </button>
            </div>
          ) : null}
        </div>
      </EditorPanelShell>
    );
  }

  return null;
}
