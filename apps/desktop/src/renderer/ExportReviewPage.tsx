import { useCallback, useEffect, useState } from "react";
import type {
  DegradationFinding,
  QaGateResult,
  QaIssueView,
} from "@translunar/contracts";

import { ExportDegradationList } from "./components/quality/ExportDegradationList";
import { ExportDeliveryActions } from "./components/quality/ExportDeliveryActions";
import { ExportGateBanner } from "./components/quality/ExportGateBanner";
import { ExportGateChecklist } from "./components/quality/ExportGateChecklist";
import type { WorkspacePageProps } from "./WorkbenchPages";
import { fileName, formatError } from "./workbench-utils";
import { useLocale } from "./i18n/LocaleProvider";

export function ExportReviewPage({
  snapshot,
  document,
  onOpenSegment,
  onNavigate,
}: WorkspacePageProps) {
  const { t } = useLocale();

  const projectId = snapshot.project.id;
  const [gate, setGate] = useState<QaGateResult | null>(null);
  const [blockers, setBlockers] = useState<QaIssueView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [actor, setActor] = useState("");
  const [reason, setReason] = useState("");
  const [postDegradation, setPostDegradation] = useState<
    DegradationFinding[] | null
  >(null);

  const checkGate = useCallback(async () => {
    setError(null);
    try {
      const nextGate = await window.translunar.invoke("qa.gate.check", {
        projectId,
        documentId: document.id,
      });
      setGate(nextGate);
      if (nextGate.blockerIssueIds.length) {
        const page = await window.translunar.invoke("qa.issue.list", {
          projectId,
          documentId: document.id,
          severity: "error",
          disposition: "open",
          offset: 0,
          limit: 100,
        });
        const ids = new Set(nextGate.blockerIssueIds);
        setBlockers(page.items.filter((item) => ids.has(item.id)));
      } else setBlockers([]);
    } catch (reasonValue) {
      setError(formatError(reasonValue));
    } finally {
      setLoading(false);
    }
  }, [document.id, projectId]);

  useEffect(() => {
    void checkGate();
  }, [checkGate]);

  async function exportDocument() {
    if (
      !gate ||
      (gate.clear === false &&
        (!overrideEnabled || !actor.trim() || !reason.trim()))
    )
      return;
    const extension =
      document.name.match(/\.[^.]+$/u)?.[0] ?? `.${document.format}`;
    const base = document.name.slice(
      0,
      Math.max(0, document.name.length - extension.length),
    );
    const outputPath = await window.translunar.selectExportPath(
      `${base}-translated${extension}`,
    );
    if (!outputPath) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await window.translunar.invoke("document.export", {
        documentId: document.id,
        outputPath,
        ...(!gate.clear
          ? { qaOverride: { actor: actor.trim(), reason: reason.trim() } }
          : {}),
      });
      setPostDegradation(result.degradation ?? []);
      setSuccess(
        t("export.success", {
          count: result.translatedSegments,
          name: fileName(result.outputPath),
        }),
      );
      await checkGate();
    } catch (reasonValue) {
      setError(formatError(reasonValue));
    } finally {
      setBusy(false);
    }
  }

  const canExport = Boolean(
    gate && (gate.clear || (overrideEnabled && actor.trim() && reason.trim())),
  );

  const preDegradation = document.degradation ?? [];

  return (
    <main
      className="surface-main export-ortho"
      aria-busy={loading || busy}
    >
      <header className="export-ortho__header">
        <h1>{t("export.title")}</h1>
        <p>
          {document.name} · {document.segmentCount}
        </p>
      </header>

      {error ? (
        <p className="surface-error qa-banner" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="surface-success qa-banner" role="status">
          {success}
        </p>
      ) : null}
      {busy ? (
        <p className="export-ortho__busy" role="status">
          {t("export.publishing")}
        </p>
      ) : null}

      <ExportGateBanner
        gate={gate}
        loading={loading}
        busy={busy}
        labels={{
          blocked: t("export.gateBlocked"),
          clear: t("export.gateClearCan"),
          blockedBody: t("export.gateBlockedBody"),
          clearBody: t("export.gateClearBody"),
          viewIssues: t("export.viewIssues"),
          recheck: t("export.checkAgain"),
          checking: t("export.checkingTranslation"),
        }}
        onViewIssues={() => onNavigate("qa-review")}
        onRecheck={() => {
          setLoading(true);
          void checkGate();
        }}
      />

      <ExportGateChecklist
        gate={gate}
        labels={{
          title: t("export.gateStatus"),
          blockingErrors: t("export.blockingErrorsLabel"),
          warnings: t("export.warningsLabel"),
          checkedSegments: t("export.segmentsChecked"),
          mustFix: t("export.mustFix"),
          optional: t("export.optionalFix"),
          profile: t("common.profile"),
        }}
      />

      <ExportDegradationList
        preExport={preDegradation}
        postExport={postDegradation}
        labels={{
          title: t("export.degradationTitle"),
          preTitle: t("export.degradationPre"),
          postTitle: t("export.degradationPost"),
          empty: t("export.degradationEmpty"),
          path: t("export.degradationPath"),
        }}
      />

      <ExportDeliveryActions
        documentName={document.name}
        format={document.format}
        gate={gate}
        blockers={blockers}
        overrideEnabled={overrideEnabled}
        actor={actor}
        reason={reason}
        canExport={canExport}
        busy={busy}
        labels={{
          contentTitle: t("export.contentTitle"),
          originalFormat: t("export.originalFormat"),
          formatsResidual: t("export.formatsResidual"),
          publication: t("export.publication"),
          overrideAria: t("export.overrideAria"),
          overrideTitle: t("export.overrideTitle"),
          overrideHelp: t("export.overrideHelp"),
          actor: t("common.actor"),
          reason: t("common.reason"),
          actorPlaceholder: t("export.actorPlaceholder"),
          reasonPlaceholder: t("export.reasonPlaceholder"),
          exportDocument: t("export.exportDocument"),
          publishing: t("export.publishing"),
          helpBlocked: t("export.helpBlocked"),
          noOpenErrors: t("export.noOpenErrors"),
          resolveBefore: t("export.resolveBefore"),
          nothingBlocks: t("export.nothingBlocks"),
          warningsRemain: t("export.warningsRemain"),
          segmentLabel: t("export.segmentLabel"),
          blockingFindings: t("export.blockingFindings"),
        }}
        onOverrideEnabled={setOverrideEnabled}
        onActor={setActor}
        onReason={setReason}
        onExport={() => void exportDocument()}
        onOpenSegment={onOpenSegment}
      />
    </main>
  );
}
