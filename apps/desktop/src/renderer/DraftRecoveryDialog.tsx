import { useRef } from "react";

import type { DraftJournalRecord } from "../shared/product-shell";
import { useLocale } from "./i18n/LocaleProvider";
import { useFocusTrap } from "./useFocusTrap";

export interface RecoverableDraft extends DraftJournalRecord {
  stale: boolean;
  currentRevision?: number | undefined;
}

interface DraftRecoveryDialogProps {
  drafts: RecoverableDraft[];
  onRestore: (draft: RecoverableDraft) => void;
  onDiscard: (draft: RecoverableDraft) => void;
  onCopy: (draft: RecoverableDraft) => void;
  onClose: () => void;
}

export function DraftRecoveryDialog({
  drafts,
  onRestore,
  onDiscard,
  onCopy,
  onClose,
}: DraftRecoveryDialogProps) {
  const { t } = useLocale();
  const dialogRef = useRef<HTMLElement | null>(null);
  useFocusTrap(dialogRef, {
    active: drafts.length > 0,
    onEscape: onClose,
  });
  if (drafts.length === 0) return null;

  return (
    <div className="settings-overlay" role="presentation">
      <section
        ref={dialogRef}
        className="settings-dialog draft-recovery-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="draft-recovery-title"
      >
        <header className="settings-header">
          <div>
            <h1 id="draft-recovery-title">{t("draft.recoveryTitle")}</h1>
            <p>{t("draft.recoveryBody")}</p>
            <p role="status">{t("draft.count", { count: drafts.length })}</p>
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
        <ul className="settings-list">
          {drafts.map((draft) => (
            <li key={draft.segmentId}>
              <div>
                <strong>{draft.segmentId}</strong>
                {draft.stale ? (
                  <p className="surface-error" role="status">
                    {t("draft.staleWarning")}
                  </p>
                ) : null}
                <pre className="draft-preview">{draft.targetText}</pre>
              </div>
              <div className="settings-actions">
                <button
                  type="button"
                  className="button primary"
                  disabled={draft.stale}
                  onClick={() => onRestore(draft)}
                >
                  {t("action.restoreDraft")}
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => onCopy(draft)}
                >
                  {t("action.copyDraft")}
                </button>
                <button
                  type="button"
                  className="button ghost"
                  onClick={() => onDiscard(draft)}
                >
                  {t("action.discardDraft")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
