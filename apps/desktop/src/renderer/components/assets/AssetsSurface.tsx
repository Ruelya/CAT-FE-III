import { useCallback, useEffect, useMemo, useState } from "react";
import type { Document, ProjectSnapshot } from "@translunar/contracts";

import { AlignmentCorpusPanel } from "../../AlignmentCorpusPanel";
import { AssetCurationPanel } from "../../AssetCurationPanel";
import { InteropPanel } from "../../InteropPanel";
import { formatError } from "../../workbench-utils";
import { useLocale } from "../../i18n/LocaleProvider";
import { AssetsOverviewStrip } from "./AssetsOverviewStrip";
import { AssetsTabList, type AssetsTabId } from "./AssetsTabList";
import { TermbaseHubPanel } from "./TermbaseHubPanel";
import { TmHubPanel } from "./TmHubPanel";

export interface AssetsSurfaceProps {
  snapshot: ProjectSnapshot;
  document: Document;
  onRefresh(): Promise<void>;
}

export function AssetsSurface({
  snapshot,
  document,
  onRefresh,
}: AssetsSurfaceProps) {
  const { t } = useLocale();
  const [tab, setTab] = useState<AssetsTabId>("curation");
  const [tmTotal, setTmTotal] = useState<number | null>(null);
  const [termTotal, setTermTotal] = useState<number | null>(null);
  const [documents, setDocuments] = useState<Document[]>(
    snapshot.documents ?? [document],
  );
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    const [tmPage, termPage, docPage] = await Promise.all([
      window.translunar.invoke("tm.library.list", {
        projectId: snapshot.project.id,
        offset: 0,
        limit: 1,
      }),
      window.translunar.invoke("termbase.list", {
        projectId: snapshot.project.id,
        offset: 0,
        limit: 1,
      }),
      window.translunar.invoke("document.list", {
        projectId: snapshot.project.id,
        offset: 0,
        limit: 100,
      }),
    ]);
    setTmTotal(tmPage.total);
    setTermTotal(termPage.total);
    setDocuments(docPage.items.length ? docPage.items : [document]);
  }, [document, snapshot.project.id]);

  useEffect(() => {
    void loadOverview().catch((reason: unknown) =>
      setError(formatError(reason)),
    );
  }, [loadOverview]);

  const tabs = useMemo(() => {
    const items: {
      id: AssetsTabId;
      label: string;
      count?: number;
    }[] = [
      { id: "tm", label: t("assets.tab.tm") },
      { id: "terms", label: t("assets.tab.terms") },
      { id: "curation", label: t("assets.tab.curation") },
      { id: "alignment", label: t("assets.tab.alignment") },
      { id: "interop", label: t("assets.tab.interop") },
    ];
    if (tmTotal != null) items[0]!.count = tmTotal;
    if (termTotal != null) items[1]!.count = termTotal;
    return items;
  }, [t, termTotal, tmTotal]);

  return (
    <main className="surface-main assets-ortho">
      <AssetsOverviewStrip
        tmTotal={tmTotal}
        termTotal={termTotal}
        labels={{
          title: t("assets.title"),
          tm: t("assets.tab.tm"),
          terms: t("assets.tab.terms"),
          scopeNote: t("assets.scopeNote"),
        }}
      />
      {error ? (
        <p className="surface-error" role="alert">
          {error}
        </p>
      ) : null}
      <AssetsTabList
        tabs={tabs}
        active={tab}
        onChange={setTab}
        ariaLabel={t("assets.tabsAria")}
      />
      <div
        className="assets-ortho__panel"
        role="tabpanel"
        data-tab={tab}
      >
        {tab === "tm" ? (
          <TmHubPanel snapshot={snapshot} onRefresh={onRefresh} />
        ) : null}
        {tab === "terms" ? (
          <TermbaseHubPanel snapshot={snapshot} onRefresh={onRefresh} />
        ) : null}
        {tab === "curation" ? (
          <div className="assets-panel-host">
            <AssetCurationPanel snapshot={snapshot} onRefresh={onRefresh} />
          </div>
        ) : null}
        {tab === "alignment" ? (
          <div className="assets-panel-host">
            <AlignmentCorpusPanel
              snapshot={snapshot}
              documents={documents}
              onRefresh={onRefresh}
            />
          </div>
        ) : null}
        {tab === "interop" ? (
          <div className="assets-panel-host">
            <InteropPanel
              snapshot={snapshot}
              document={document}
              onRefresh={onRefresh}
            />
          </div>
        ) : null}
      </div>
    </main>
  );
}
