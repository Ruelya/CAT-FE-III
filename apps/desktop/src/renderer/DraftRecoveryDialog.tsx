import { useMemo, useRef, useState } from "react";

import type { DraftJournalRecord } from "../shared/product-shell";
import {
  canRestoreDraft,
  countSelected,
  defaultDraftSelection,
  joinDraftClipboardTexts,
  selectedDrafts,
  toggleDraftSelection,
} from "./components/system/draft-recovery-presenters";
import { wordDiff } from "./components/workbench/Stack/wordDiff";
import { useLocale } from "./i18n/LocaleProvider";
import { useFocusTrap } from "./useFocusTrap";

export interface RecoverableDraft extends DraftJournalRecord {
  stale: boolean;
  currentRevision?: number | undefined;
  /** Engine disconnected / missing current revision for comparison. */
  unverified?: boolean | undefined;
  /** Current saved target text for word-diff when stale. */
  currentTargetText?: string | undefined;
  /** Per-row restore failure message after sequential restore. */
  restoreError?: string | undefined;
}

interface DraftRecoveryDialogProps {
  drafts: RecoverableDraft[];
  onRestore: (draft: RecoverableDraft) => void | Promise<void>;
  onDiscard: (draft: RecoverableDraft) => void | Promise<void>;
  onCopy: (draft: RecoverableDraft) => void | Promise<void>;
  onClose: () => void;
  /** Optional batch hooks — dialog falls back to looping onRestore/onDiscard. */
  onRestoreMany?: (drafts: RecoverableDraft[]) => void | Promise<void>;
  onDiscardAll?: (drafts: RecoverableDraft[]) => void | Promise<void>;
  onCopyMany?: (text: string) => void | Promise<void>;
}

export function DraftRecoveryDialog({
  drafts,
  onRestore,
  onDiscard,
  onCopy,
  onClose,
  onRestoreMany,
  onDiscardAll,
  onCopyMany,
}: DraftRecoveryDialogProps) {
  const { t } = useLocale();
  const dialogRef = useRef<HTMLElement | null>(null);
  const [selected, setSelected] = useState(() => defaultDraftSelection(drafts));
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  useFocusTrap(dialogRef, {
    active: drafts.length > 0,
    onEscape: () => {
      if (confirmDiscard) {
        setConfirmDiscard(false);
        return;
      }
      onClose();
    },
  });

  const selectedCount = countSelected(selected);
  const picked = useMemo(
    () => selectedDrafts<RecoverableDraft>(drafts, selected),
    [drafts, selected],
  );
  const restorablePicked = useMemo(
    () => picked.filter((d) => canRestoreDraft(d)),
    [picked],
  );

  if (drafts.length === 0) return null;

  const runRestoreSelected = async () => {
    if (restorablePicked.length === 0) return;
    setBusy(true);
    setRowErrors({});
    try {
      if (onRestoreMany) {
        await onRestoreMany(restorablePicked);
      } else {
        const errors: Record<string, string> = {};
        for (const draft of restorablePicked) {
          try {
            await onRestore(draft);
          } catch (err) {
            errors[draft.segmentId] =
              err instanceof Error ? err.message : t("error.generic");
          }
        }
        setRowErrors(errors);
      }
    } finally {
      setBusy(false);
    }
  };

  const runCopySelected = async () => {
    if (picked.length === 0) return;
    const text = joinDraftClipboardTexts(picked);
    if (onCopyMany) {
      await onCopyMany(text);
      return;
    }
    if (picked.length === 1) {
      await onCopy(picked[0]!);
      return;
    }
    await navigator.clipboard.writeText(text);
  };

  const runDiscardAll = async () => {
    setBusy(true);
    try {
      if (onDiscardAll) {
        await onDiscardAll(drafts);
      } else {
        for (const draft of drafts) {
          await onDiscard(draft);
        }
      }
      setConfirmDiscard(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="draft-recovery-overlay" role="presentation">
      <section
        ref={dialogRef}
        className="draft-recovery-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="draft-recovery-title"
      >
        <header className="draft-recovery-dialog__header">
          <div className="draft-recovery-dialog__brand">
            <div>
              <h1 id="draft-recovery-title">{t("draft.recoveryTitle")}</h1>
              <p>{t("draft.recoveryBody")}</p>
              <p role="status">{t("draft.count", { count: drafts.length })}</p>
            </div>
          </div>
          <button
            type="button"
            className="button ghost"
            aria-label={t("aria.closeDialog")}
            onClick={onClose}
          >
            {t("settings.close")}
          </button>
        </header>

        {confirmDiscard ? (
          <div className="draft-recovery-dialog__confirm" role="alertdialog">
            <p>{t("draft.discardAllConfirm", { count: drafts.length })}</p>
            <div className="settings-surface__actions">
              <button
                type="button"
                className="button ghost"
                disabled={busy}
                onClick={() => setConfirmDiscard(false)}
              >
                {t("action.cancelRestore")}
              </button>
              <button
                type="button"
                className="button danger"
                disabled={busy}
                onClick={() => void runDiscardAll()}
              >
                {t("action.discardAllDrafts")}
              </button>
            </div>
          </div>
        ) : null}

        <ul className="draft-recovery-dialog__list">
          {drafts.map((draft) => {
            const isSelected = Boolean(selected[draft.segmentId]);
            const error =
              rowErrors[draft.segmentId] ?? draft.restoreError ?? null;
            const diffTokens =
              draft.stale && draft.currentTargetText != null
                ? wordDiff(draft.currentTargetText, draft.targetText)
                : null;
            return (
              <li
                key={draft.segmentId}
                className="draft-recovery-dialog__row"
                data-stale={draft.stale || draft.unverified ? "" : undefined}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  aria-label={t("draft.selectRow", {
                    id: draft.segmentId,
                  })}
                  onChange={() =>
                    setSelected((cur) =>
                      toggleDraftSelection(cur, draft.segmentId),
                    )
                  }
                />
                <div>
                  <div className="draft-recovery-dialog__meta">
                    <strong>{draft.segmentId}</strong>
                    {draft.stale ? (
                      <span className="draft-recovery-dialog__badge">
                        {t("draft.staleBadge")}
                      </span>
                    ) : null}
                    {draft.unverified ? (
                      <span className="draft-recovery-dialog__badge">
                        {t("draft.unverifiedBadge")}
                      </span>
                    ) : null}
                  </div>
                  {draft.stale ? (
                    <p className="surface-error" role="status">
                      {t("draft.staleWarning")}
                    </p>
                  ) : null}
                  {draft.unverified ? (
                    <p className="surface-error" role="status">
                      {t("draft.unverifiedWarning")}
                    </p>
                  ) : null}
                  <pre className="draft-recovery-dialog__preview">
                    {draft.targetText}
                  </pre>
                  {diffTokens && diffTokens.length > 0 ? (
                    <div
                      className="draft-recovery-dialog__diff"
                      aria-label={t("draft.diffAria")}
                    >
                      {diffTokens.map((tok, i) => {
                        if (tok.kind === "equal") {
                          return <span key={i}>{tok.text}</span>;
                        }
                        if (tok.kind === "delete") {
                          return <del key={i}>{tok.text}</del>;
                        }
                        return <ins key={i}>{tok.text}</ins>;
                      })}
                    </div>
                  ) : null}
                  {error ? (
                    <p className="draft-recovery-dialog__error" role="status">
                      {error}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>

        <footer className="draft-recovery-dialog__footer">
          <button
            type="button"
            className="button danger"
            disabled={busy || drafts.length === 0}
            onClick={() => setConfirmDiscard(true)}
          >
            {t("action.discardAllDrafts")}
          </button>
          <button
            type="button"
            className="button"
            disabled={busy || selectedCount === 0}
            onClick={() => void runCopySelected()}
          >
            {t("action.copySelectedDrafts")}
          </button>
          <button
            type="button"
            className="button primary"
            disabled={busy || restorablePicked.length === 0}
            onClick={() => void runRestoreSelected()}
          >
            {t("action.restoreSelectedDrafts", {
              count: restorablePicked.length,
            })}
          </button>
        </footer>
      </section>
    </div>
  );
}
