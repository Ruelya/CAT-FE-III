import { useState } from "react";

import { formatUiError } from "../lib/errors";
import { ConfirmDialog } from "../shell/ConfirmDialog";
import { InlineLoading } from "../shell/InlineState";
import { SectionNav } from "../shell/SectionNav";
import { TableEmpty } from "../shell/TableEmpty";
import type { AssetSection } from "../state/asset-state";
import {
  formatBasisPoints,
  formatScore,
  joinLibraryMount,
  joinTermbaseMount,
  pageLabel,
} from "../state/asset-view";
import type { AssetControllerApi } from "../state/use-asset-controller";

export interface AssetHubProps {
  assets: AssetControllerApi;
  disabled?: boolean;
  onBack: () => void;
  onSectionChange: (section: AssetSection) => void;
}

const SECTIONS: Array<{ id: AssetSection; label: string }> = [
  { id: "tm", label: "TM" },
  { id: "termbase", label: "Termbases" },
  { id: "alignment", label: "Alignment" },
  { id: "corpus", label: "Corpora" },
  { id: "catalog", label: "Catalog" },
  { id: "curation", label: "Curation" },
];

export function AssetHub({
  assets,
  disabled,
  onBack,
  onSectionChange,
}: AssetHubProps) {
  const { state } = assets;
  const busy = disabled === true;
  const [removeCorpus, setRemoveCorpus] = useState<{
    id: string;
    revision: number;
    name: string;
  } | null>(null);
  const [removeReason, setRemoveReason] = useState("");
  const [applyReason, setApplyReason] = useState("");
  const [repartitionReason, setRepartitionReason] = useState("");
  const [curationActionReason, setCurationActionReason] = useState("");
  const [fromAlignName, setFromAlignName] = useState("");
  const [fromAlignReason, setFromAlignReason] = useState("");
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [tmMountMode, setTmMountMode] = useState<"write" | "reference">(
    "write",
  );
  const [tbMountWritable, setTbMountWritable] = useState(true);

  return (
    <section className="surface asset-hub" data-testid="asset-hub">
      <div className="surface__inner">
        <div className="surface__masthead">
          <h1 className="surface__title">{state.projectName}</h1>
          <div className="surface__actions">
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy}
              onClick={onBack}
              data-testid="assets-back"
            >
              Back
            </button>
          </div>
        </div>

        <SectionNav
          label="Asset sections"
          items={SECTIONS.map((s) => ({
            id: s.id,
            label: s.label,
            testId: `assets-tab-${s.id}`,
          }))}
          current={state.section}
          disabled={busy}
          onSelect={(id) => {
            assets.setSection(id);
            onSectionChange(id);
          }}
        />

        <div className="asset-hub__body">
          {state.section === "tm" ? (
            <div data-testid="assets-tm">
              <h2 className="insights-heading">Libraries</h2>
              <div className="editor-panel__row">
                <label className="field">
                  <span>Name</span>
                  <input
                    value={state.tm.createName}
                    disabled={busy || state.tm.createPending}
                    onChange={(e) => assets.setTmCreateName(e.target.value)}
                    data-testid="tm-create-name"
                  />
                </label>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={
                    busy ||
                    state.tm.createPending ||
                    !state.tm.createName.trim()
                  }
                  onClick={() => void assets.createTmLibrary()}
                  data-testid="tm-create"
                >
                  Create
                </button>
              </div>
              {state.tm.actionError ? (
                <p className="error-text">
                  {formatUiError(state.tm.actionError)}
                </p>
              ) : null}
              {state.tm.libraries.status === "loading" ? (
                <p className="muted">Loading libraries</p>
              ) : null}
              {state.tm.libraries.status === "error" &&
              state.tm.libraries.error ? (
                <p className="error-text">
                  {formatUiError(state.tm.libraries.error)}
                </p>
              ) : null}
              {state.tm.libraries.status === "ready" &&
              state.tm.libraries.items.length === 0 ? (
                <p className="muted">No libraries</p>
              ) : null}
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Locales</th>
                      <th scope="col">Mount</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.tm.libraries.items.map((lib) => {
                      const mount = joinLibraryMount(lib, state.tm.mounts);
                      return (
                        <tr key={lib.id}>
                          <td>{lib.name}</td>
                          <td>
                            {lib.sourceLocale}→{lib.targetLocale}
                          </td>
                          <td>
                            {mount
                              ? `${mount.mode}${mount.enabled ? "" : " · off"}`
                              : "-"}
                          </td>
                          <td>
                            <div className="surface__actions">
                              {!mount ? (
                                <>
                                  <select
                                    value={tmMountMode}
                                    disabled={busy}
                                    onChange={(e) =>
                                      setTmMountMode(
                                        e.target.value as "write" | "reference",
                                      )
                                    }
                                    aria-label="TM mount mode"
                                    data-testid={`tm-mount-mode-${lib.id}`}
                                  >
                                    <option value="write">Write</option>
                                    <option value="reference">Reference</option>
                                  </select>
                                  <button
                                    type="button"
                                    className="btn btn--ghost btn--sm"
                                    disabled={busy}
                                    onClick={() =>
                                      void assets.mountTm(lib.id, tmMountMode)
                                    }
                                    data-testid={`tm-mount-${lib.id}`}
                                  >
                                    Mount
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  className="btn btn--ghost btn--sm"
                                  disabled={busy}
                                  onClick={() =>
                                    void assets.unmountTm(
                                      lib.id,
                                      mount.revision,
                                    )
                                  }
                                >
                                  Unmount
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                disabled={busy}
                                onClick={() =>
                                  void assets.exportTm(lib.id, "tmx")
                                }
                              >
                                Export
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {state.tm.libraries.items.length === 0 ? (
                      <TableEmpty colSpan={4} />
                    ) : null}
                  </tbody>
                </table>
              </div>
              <div className="pagination" data-testid="tm-libraries-paging">
                <span className="pagination__count">
                  {pageLabel(
                    state.tm.libraries.offset,
                    state.tm.libraries.limit,
                    state.tm.libraries.total,
                  )}
                </span>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={busy || state.tm.libraries.offset <= 0}
                  onClick={() =>
                    void assets.loadTmLibraries(
                      Math.max(
                        0,
                        state.tm.libraries.offset - state.tm.libraries.limit,
                      ),
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
                    state.tm.libraries.offset +
                      state.tm.libraries.items.length >=
                      state.tm.libraries.total
                  }
                  onClick={() =>
                    void assets.loadTmLibraries(
                      state.tm.libraries.offset + state.tm.libraries.limit,
                    )
                  }
                >
                  Next
                </button>
              </div>
              {state.tm.exchange.status !== "idle" ? (
                <p className="muted" data-testid="tm-exchange">
                  {state.tm.exchange.message}
                  {state.tm.exchange.error
                    ? formatUiError(state.tm.exchange.error)
                    : null}
                </p>
              ) : null}

              <h2 className="insights-heading">Search</h2>
              <div className="editor-panel__row">
                <div className="field">
                  <label className="field__label" htmlFor="tm-search-query">
                    Query
                  </label>
                  <input
                    id="tm-search-query"
                    value={state.tm.searchQuery}
                    disabled={busy}
                    onChange={(e) => assets.setTmSearchQuery(e.target.value)}
                    data-testid="tm-search-query"
                  />
                </div>
                <div className="field field--narrow">
                  <label className="field__label" htmlFor="tm-search-threshold">
                    Min score
                  </label>
                  <input
                    id="tm-search-threshold"
                    type="number"
                    step={0.05}
                    min={0}
                    max={1}
                    value={state.tm.searchThreshold}
                    disabled={busy}
                    onChange={(e) =>
                      assets.setTmSearchThreshold(Number(e.target.value) || 0)
                    }
                  />
                </div>
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={busy}
                  onClick={() => void assets.runTmSearch(0)}
                  data-testid="tm-search"
                >
                  Search
                </button>
              </div>
              {state.tm.search.status === "loading" ? (
                <InlineLoading label="Loading search" />
              ) : null}
              {state.tm.search.error ? (
                <p className="error-text">
                  {formatUiError(state.tm.search.error)}
                </p>
              ) : null}
              {state.tm.search.status === "ready" &&
              state.tm.search.items.length === 0 ? (
                <p className="muted">No matches</p>
              ) : null}
              <ul
                className="editor-panel__list"
                data-testid="tm-search-results"
              >
                {state.tm.search.items.map((m, i) => (
                  <li key={`${m.unit.id}-${i}`}>
                    {formatScore(m.score)} · {m.kind} · {m.library.name}
                    <div className="muted">{m.unit.sourceText}</div>
                    <div>{m.unit.targetText}</div>
                  </li>
                ))}
              </ul>
              {state.tm.search.status === "ready" ? (
                <>
                  <div className="pagination" data-testid="tm-search-paging">
                    <span className="pagination__count">
                      {pageLabel(
                        state.tm.search.offset,
                        state.tm.search.limit,
                        state.tm.search.total,
                      )}
                    </span>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={busy || state.tm.search.offset <= 0}
                      onClick={() =>
                        void assets.runTmSearch(
                          Math.max(
                            0,
                            state.tm.search.offset - state.tm.search.limit,
                          ),
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
                        state.tm.search.offset + state.tm.search.items.length >=
                          state.tm.search.total
                      }
                      onClick={() =>
                        void assets.runTmSearch(
                          state.tm.search.offset + state.tm.search.limit,
                        )
                      }
                    >
                      Next
                    </button>
                  </div>
                </>
              ) : null}

              <h2 className="insights-heading">Concordance</h2>
              <div className="editor-panel__row">
                <input
                  value={state.tm.concordanceQuery}
                  disabled={busy}
                  onChange={(e) => assets.setConcordanceQuery(e.target.value)}
                  data-testid="tm-concordance-query"
                  aria-label="Concordance"
                />
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={busy}
                  onClick={() => void assets.runConcordance(0)}
                  data-testid="tm-concordance"
                >
                  Concordance
                </button>
              </div>
              {state.tm.concordance.status === "loading" ? (
                <InlineLoading label="Loading concordance" />
              ) : null}
              {state.tm.concordance.error ? (
                <p className="error-text">
                  {formatUiError(state.tm.concordance.error)}
                </p>
              ) : null}
              <ul className="editor-panel__list">
                {state.tm.concordance.items.map((h, i) => (
                  <li key={`${h.unit.id}-c-${i}`}>
                    {h.matchedSide} · {h.libraryId}
                    <div className="muted">{h.unit.sourceText}</div>
                    <div>{h.unit.targetText}</div>
                  </li>
                ))}
              </ul>
              {state.tm.concordance.status === "ready" ? (
                <>
                  <div
                    className="pagination"
                    data-testid="tm-concordance-paging"
                  >
                    <span className="pagination__count">
                      {pageLabel(
                        state.tm.concordance.offset,
                        state.tm.concordance.limit,
                        state.tm.concordance.total,
                      )}
                    </span>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={busy || state.tm.concordance.offset <= 0}
                      onClick={() =>
                        void assets.runConcordance(
                          Math.max(
                            0,
                            state.tm.concordance.offset -
                              state.tm.concordance.limit,
                          ),
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
                        state.tm.concordance.offset +
                          state.tm.concordance.items.length >=
                          state.tm.concordance.total
                      }
                      onClick={() =>
                        void assets.runConcordance(
                          state.tm.concordance.offset +
                            state.tm.concordance.limit,
                        )
                      }
                    >
                      Next
                    </button>
                  </div>
                </>
              ) : null}
              {state.tm.corpusHits.length > 0 ? (
                <ul className="editor-panel__list">
                  {state.tm.corpusHits.map((h, i) => (
                    <li key={`ch-${i}`}>
                      corpus · {h.matchKind} · {h.matchedSide}
                      <div>{h.entry.sourceText}</div>
                      <div>{h.entry.targetText}</div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {state.section === "termbase" ? (
            <div data-testid="assets-termbase">
              <h2 className="insights-heading">Termbases</h2>
              <div className="editor-panel__row">
                <input
                  value={state.termbase.createName}
                  disabled={busy || state.termbase.createPending}
                  onChange={(e) => assets.setTbCreateName(e.target.value)}
                  data-testid="tb-create-name"
                  aria-label="Termbase name"
                />
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={
                    busy ||
                    state.termbase.createPending ||
                    !state.termbase.createName.trim()
                  }
                  onClick={() => void assets.createTermbase()}
                  data-testid="tb-create"
                >
                  Create
                </button>
              </div>
              {state.termbase.actionError ? (
                <p className="error-text">
                  {formatUiError(state.termbase.actionError)}
                </p>
              ) : null}
              {state.termbase.termbases.status === "loading" ? (
                <p className="muted">Loading termbases</p>
              ) : null}
              {state.termbase.termbases.status === "error" &&
              state.termbase.termbases.error ? (
                <p className="error-text">
                  {formatUiError(state.termbase.termbases.error)}
                </p>
              ) : null}
              {state.termbase.termbases.status === "ready" &&
              state.termbase.termbases.items.length === 0 ? (
                <p className="muted">No termbases</p>
              ) : null}
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Locale</th>
                      <th scope="col">Writable</th>
                      <th scope="col">Mount</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.termbase.termbases.items.map((tb) => {
                      const mount = joinTermbaseMount(
                        tb,
                        state.termbase.mounts,
                      );
                      return (
                        <tr key={tb.id}>
                          <td>{tb.name}</td>
                          <td>{tb.sourceLocale}</td>
                          <td>{tb.writable ? "yes" : "no"}</td>
                          <td>
                            {mount ? (mount.writable ? "write" : "ref") : "-"}
                          </td>
                          <td>
                            <div className="surface__actions">
                              {!mount ? (
                                <>
                                  <select
                                    value={tbMountWritable ? "write" : "ref"}
                                    disabled={busy || !tb.writable}
                                    onChange={(e) =>
                                      setTbMountWritable(
                                        e.target.value === "write",
                                      )
                                    }
                                    aria-label="Termbase mount mode"
                                    data-testid={`tb-mount-mode-${tb.id}`}
                                  >
                                    {tb.writable ? (
                                      <option value="write">Write</option>
                                    ) : null}
                                    <option value="ref">Reference</option>
                                  </select>
                                  <button
                                    type="button"
                                    className="btn btn--ghost btn--sm"
                                    disabled={busy}
                                    onClick={() =>
                                      void assets.mountTermbase(
                                        tb.id,
                                        tb.writable ? tbMountWritable : false,
                                      )
                                    }
                                    data-testid={`tb-mount-${tb.id}`}
                                  >
                                    Mount
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  className="btn btn--ghost btn--sm"
                                  disabled={busy}
                                  onClick={() =>
                                    void assets.unmountTermbase(
                                      tb.id,
                                      mount.revision,
                                    )
                                  }
                                >
                                  Unmount
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                disabled={busy}
                                onClick={() =>
                                  void assets.exportTermbase(tb.id, "tbx")
                                }
                              >
                                Export
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {state.termbase.termbases.items.length === 0 ? (
                      <TableEmpty colSpan={5} />
                    ) : null}
                  </tbody>
                </table>
              </div>
              {state.termbase.exchange.message ||
              state.termbase.exchange.error ? (
                <p className="muted">
                  {state.termbase.exchange.message}
                  {state.termbase.exchange.error
                    ? formatUiError(state.termbase.exchange.error)
                    : null}
                </p>
              ) : null}

              <h2 className="insights-heading">Term search</h2>
              <div className="editor-panel__row">
                <input
                  value={state.termbase.searchText}
                  disabled={busy}
                  onChange={(e) => assets.setTermSearchText(e.target.value)}
                  data-testid="tb-search-text"
                  aria-label="Term search"
                />
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={busy}
                  onClick={() => void assets.runTermSearch(0)}
                  data-testid="tb-search"
                >
                  Search
                </button>
              </div>
              {state.termbase.search.status === "loading" ? (
                <InlineLoading label="Loading term search" />
              ) : null}
              {state.termbase.search.error ? (
                <p className="error-text">
                  {formatUiError(state.termbase.search.error)}
                </p>
              ) : null}
              <ul className="editor-panel__list">
                {state.termbase.search.items.map((m, i) => (
                  <li key={`${m.entryId}-${i}`}>
                    {m.sourceTerm}
                    <div className="muted">
                      {m.translations.map((t) => t.term).join(" · ")}
                    </div>
                  </li>
                ))}
              </ul>
              {state.termbase.search.status === "ready" ? (
                <>
                  <div className="pagination" data-testid="tb-search-paging">
                    <span className="pagination__count">
                      {pageLabel(
                        state.termbase.search.offset,
                        state.termbase.search.limit,
                        state.termbase.search.total,
                      )}
                    </span>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={busy || state.termbase.search.offset <= 0}
                      onClick={() =>
                        void assets.runTermSearch(
                          Math.max(
                            0,
                            state.termbase.search.offset -
                              state.termbase.search.limit,
                          ),
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
                        state.termbase.search.offset +
                          state.termbase.search.items.length >=
                          state.termbase.search.total
                      }
                      onClick={() =>
                        void assets.runTermSearch(
                          state.termbase.search.offset +
                            state.termbase.search.limit,
                        )
                      }
                    >
                      Next
                    </button>
                  </div>
                </>
              ) : null}

              <h2 className="insights-heading">Extract terms</h2>
              <div className="editor-panel__row">
                <select
                  value={state.termbase.extract.documentId}
                  disabled={busy || state.termbase.extract.pending}
                  onChange={(e) => assets.setExtractDocumentId(e.target.value)}
                  aria-label="Extract from document"
                  data-testid="tb-extract-document"
                >
                  <option value="">
                    {state.documents[0] ? "Active / first document" : "No documents"}
                  </option>
                  {state.documents.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={busy || state.termbase.extract.pending}
                  onClick={() => void assets.extractTerms()}
                  data-testid="tb-extract"
                >
                  Extract
                </button>
              </div>
              {state.termbase.extract.error ? (
                <p className="error-text">
                  {formatUiError(state.termbase.extract.error)}
                </p>
              ) : null}
              {state.termbase.extract.candidates.length > 0 ? (
                <ul className="p4-list" data-testid="tb-extract-results">
                  {state.termbase.extract.candidates.map((candidate) => (
                    <li key={`${candidate.sourceTerm}:${candidate.frequency}`}>
                      <span>
                        {candidate.sourceTerm}
                        {candidate.suggestedTarget
                          ? ` → ${candidate.suggestedTarget}`
                          : ""}{" "}
                        ×{candidate.frequency}
                      </span>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busy}
                        onClick={() =>
                          assets.acceptExtractedTerm(
                            candidate.sourceTerm,
                            candidate.suggestedTarget ?? "",
                          )
                        }
                        data-testid={`tb-extract-accept-${candidate.sourceTerm}`}
                      >
                        Use in upsert
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              <h2 className="insights-heading">Upsert</h2>
              <div className="editor-panel__row">
                <select
                  value={state.termbase.upsert.termbaseId}
                  disabled={busy}
                  onChange={(e) =>
                    assets.setUpsertField({ termbaseId: e.target.value })
                  }
                  aria-label="Termbase"
                  data-testid="tb-upsert-id"
                >
                  <option value="">-</option>
                  {state.termbase.termbases.items.map((tb) => (
                    <option key={tb.id} value={tb.id}>
                      {tb.name}
                    </option>
                  ))}
                </select>
                <input
                  value={state.termbase.upsert.sourceTerm}
                  disabled={busy}
                  onChange={(e) =>
                    assets.setUpsertField({ sourceTerm: e.target.value })
                  }
                  placeholder="Source"
                  aria-label="Source term"
                  data-testid="tb-upsert-source"
                />
                <input
                  value={state.termbase.upsert.translation}
                  disabled={busy}
                  onChange={(e) =>
                    assets.setUpsertField({ translation: e.target.value })
                  }
                  placeholder="Target"
                  aria-label="Target term"
                  data-testid="tb-upsert-target"
                />
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={busy || state.termbase.upsert.pending}
                  onClick={() => void assets.upsertTerm()}
                  data-testid="tb-upsert"
                >
                  Upsert
                </button>
              </div>
              {state.termbase.upsert.error ? (
                <p className="error-text">
                  {formatUiError(state.termbase.upsert.error)}
                </p>
              ) : null}
              {state.termbase.upsert.lastEntry ? (
                <p className="muted" data-testid="tb-upsert-result">
                  {state.termbase.upsert.lastEntry.sourceTerm} r
                  {state.termbase.upsert.lastEntry.revision}
                </p>
              ) : null}
            </div>
          ) : null}

          {state.section === "alignment" ? (
            <div data-testid="assets-alignment">
              <h2 className="insights-heading">Create</h2>
              <div className="editor-panel__row">
                <select
                  value={state.alignment.create.sourceDocumentId}
                  disabled={busy}
                  onChange={(e) =>
                    assets.setAlignmentCreate({
                      sourceDocumentId: e.target.value,
                    })
                  }
                  aria-label="Source document"
                  data-testid="align-source-doc"
                >
                  <option value="">Source</option>
                  {state.documents.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <select
                  value={state.alignment.create.targetDocumentId}
                  disabled={busy}
                  onChange={(e) =>
                    assets.setAlignmentCreate({
                      targetDocumentId: e.target.value,
                    })
                  }
                  aria-label="Target document"
                  data-testid="align-target-doc"
                >
                  <option value="">Target</option>
                  {state.documents.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <input
                  value={state.alignment.create.reason}
                  disabled={busy}
                  onChange={(e) =>
                    assets.setAlignmentCreate({ reason: e.target.value })
                  }
                  placeholder="Reason"
                  aria-label="Alignment reason"
                  data-testid="align-reason"
                />
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={busy || state.alignment.create.pending}
                  onClick={() => void assets.createAlignment()}
                  data-testid="align-create"
                >
                  Create
                </button>
              </div>
              {state.alignment.create.error ? (
                <p className="error-text">
                  {formatUiError(state.alignment.create.error)}
                </p>
              ) : null}

              <h2 className="insights-heading">Sessions</h2>
              {state.alignment.sessions.status === "loading" ? (
                <InlineLoading label="Loading sessions" />
              ) : null}
              {state.alignment.sessions.error ? (
                <p className="error-text">
                  {formatUiError(state.alignment.sessions.error)}
                </p>
              ) : null}
              {state.alignment.sessions.status === "ready" &&
              state.alignment.sessions.items.length === 0 ? (
                <p className="muted">No sessions</p>
              ) : null}
              <ul className="editor-panel__list">
                {state.alignment.sessions.items.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={busy}
                      onClick={() => void assets.selectAlignmentSession(s.id)}
                      data-testid={`align-session-${s.id}`}
                    >
                      {s.id.slice(0, 8)} · {s.status} · r{s.revision}
                    </button>
                  </li>
                ))}
              </ul>

              {state.alignment.session ? (
                <>
                  <h2 className="insights-heading">Links</h2>
                  <p className="muted">
                    {state.alignment.session.status} · r
                    {state.alignment.session.revision}
                  </p>
                  {state.alignment.actionError ? (
                    <p className="error-text">
                      {formatUiError(state.alignment.actionError)}
                    </p>
                  ) : null}
                  {state.alignment.lastRefineRunId ? (
                    <p className="muted">
                      Refine run {state.alignment.lastRefineRunId}
                    </p>
                  ) : null}
                  {state.alignment.lastApplyMessage ? (
                    <p className="muted">{state.alignment.lastApplyMessage}</p>
                  ) : null}
                  <ul className="editor-panel__list" data-testid="align-links">
                    {state.alignment.links.items.map((link) => {
                      const selected = state.alignment.selectedLinkIds.includes(
                        link.id,
                      );
                      return (
                        <li key={link.id}>
                          <label>
                            <input
                              type="checkbox"
                              checked={selected}
                              disabled={busy}
                              onChange={() =>
                                assets.toggleLinkSelection(link.id)
                              }
                            />{" "}
                            {link.status} ·{" "}
                            {formatBasisPoints(link.confidenceBasisPoints)}
                          </label>
                          <div className="muted">{link.sourceText}</div>
                          <div>{link.targetText}</div>
                          <div className="surface__actions">
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              disabled={busy || state.alignment.actionPending}
                              onClick={() =>
                                void assets.setLinkStatus(
                                  link.id,
                                  link.revision,
                                  "confirmed",
                                )
                              }
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              disabled={busy || state.alignment.actionPending}
                              onClick={() =>
                                void assets.setLinkStatus(
                                  link.id,
                                  link.revision,
                                  "rejected",
                                )
                              }
                            >
                              Reject
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="editor-panel__row">
                    <input
                      value={repartitionReason}
                      disabled={busy}
                      onChange={(e) => setRepartitionReason(e.target.value)}
                      placeholder="Repartition reason"
                      data-testid="align-repartition-reason"
                      aria-label="Repartition reason"
                    />
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      disabled={
                        busy ||
                        state.alignment.actionPending ||
                        state.alignment.selectedLinkIds.length < 2 ||
                        !repartitionReason.trim()
                      }
                      onClick={() =>
                        void assets.replaceSelectedLinks(repartitionReason)
                      }
                      data-testid="align-repartition"
                    >
                      Repartition
                    </button>
                  </div>
                  <div className="editor-panel__row">
                    <input
                      value={state.alignment.refineProfileId}
                      disabled={busy}
                      onChange={(e) =>
                        assets.setRefineProfileId(e.target.value)
                      }
                      placeholder="Profile ID"
                      data-testid="align-profile"
                    />
                    <input
                      value={state.alignment.refineReason}
                      disabled={busy}
                      onChange={(e) => assets.setRefineReason(e.target.value)}
                      placeholder="Reason"
                      data-testid="align-refine-reason"
                      aria-label="Refine reason"
                    />
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      disabled={
                        busy ||
                        state.alignment.actionPending ||
                        state.alignment.selectedLinkIds.length === 0 ||
                        !state.alignment.refineReason.trim() ||
                        !state.alignment.refineProfileId.trim()
                      }
                      onClick={() => void assets.refineSelected()}
                      data-testid="align-refine"
                    >
                      Refine
                    </button>
                  </div>
                  <div className="pagination" data-testid="align-links-paging">
                    <span className="pagination__count">
                      {pageLabel(
                        state.alignment.links.offset,
                        state.alignment.links.limit,
                        state.alignment.links.total,
                      )}
                    </span>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={busy || state.alignment.links.offset <= 0}
                      onClick={() =>
                        void assets.loadAlignmentLinks(
                          Math.max(
                            0,
                            state.alignment.links.offset -
                              state.alignment.links.limit,
                          ),
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
                        state.alignment.links.offset +
                          state.alignment.links.items.length >=
                          state.alignment.links.total
                      }
                      onClick={() =>
                        void assets.loadAlignmentLinks(
                          state.alignment.links.offset +
                            state.alignment.links.limit,
                        )
                      }
                    >
                      Next
                    </button>
                  </div>
                  <div className="editor-panel__row">
                    <select
                      value={state.alignment.applyLibraryId}
                      disabled={
                        busy || state.alignment.session.status !== "open"
                      }
                      onChange={(e) => assets.setApplyLibraryId(e.target.value)}
                      aria-label="TM library"
                      data-testid="align-apply-library"
                    >
                      <option value="">TM</option>
                      {state.tm.libraries.items.map((lib) => (
                        <option key={lib.id} value={lib.id}>
                          {lib.name}
                        </option>
                      ))}
                    </select>
                    <input
                      value={applyReason}
                      disabled={busy}
                      onChange={(e) => setApplyReason(e.target.value)}
                      placeholder="Reason"
                      data-testid="align-apply-reason"
                    />
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      disabled={
                        busy ||
                        state.alignment.actionPending ||
                        state.alignment.session.status !== "open" ||
                        !state.alignment.applyLibraryId ||
                        state.alignment.selectedLinkIds.length === 0 ||
                        !applyReason.trim()
                      }
                      onClick={() => void assets.applyAlignment(applyReason)}
                      data-testid="align-apply"
                    >
                      Apply TM
                    </button>
                  </div>
                  <div className="editor-panel__row">
                    <input
                      value={fromAlignName}
                      disabled={busy}
                      onChange={(e) => setFromAlignName(e.target.value)}
                      placeholder="Corpus name"
                      data-testid="align-corpus-name"
                    />
                    <input
                      value={fromAlignReason}
                      disabled={busy}
                      onChange={(e) => setFromAlignReason(e.target.value)}
                      placeholder="Reason"
                    />
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      disabled={
                        busy ||
                        state.alignment.selectedLinkIds.length === 0 ||
                        !fromAlignName.trim() ||
                        !fromAlignReason.trim()
                      }
                      onClick={() =>
                        void assets.corpusFromAlignment(
                          fromAlignName,
                          fromAlignReason,
                        )
                      }
                      data-testid="align-to-corpus"
                    >
                      To corpus
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {state.section === "corpus" ? (
            <div data-testid="assets-corpus">
              <h2 className="insights-heading">Import</h2>
              <div className="editor-panel__row">
                <input
                  value={state.corpus.import.name}
                  disabled={busy || state.corpus.import.pending}
                  onChange={(e) =>
                    assets.setCorpusImport({ name: e.target.value })
                  }
                  placeholder="Name"
                  aria-label="Corpus name"
                  data-testid="corpus-import-name"
                />
                <select
                  value={state.corpus.import.kind}
                  disabled={busy}
                  onChange={(e) =>
                    assets.setCorpusImport({
                      kind: e.target.value as typeof state.corpus.import.kind,
                    })
                  }
                  aria-label="Kind"
                >
                  <option value="bilingual">Bilingual</option>
                  <option value="monolingualSource">Source</option>
                  <option value="monolingualTarget">Target</option>
                </select>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={
                    busy ||
                    state.corpus.import.pending ||
                    !state.corpus.import.name.trim()
                  }
                  onClick={() => void assets.importCorpus()}
                  data-testid="corpus-import"
                >
                  Import
                </button>
              </div>
              {state.corpus.import.error ? (
                <p className="error-text">
                  {formatUiError(state.corpus.import.error)}
                </p>
              ) : null}
              {state.corpus.import.message ? (
                <p className="muted">{state.corpus.import.message}</p>
              ) : null}

              <h2 className="insights-heading">Corpora</h2>
              {state.corpus.corpora.status === "loading" ? (
                <InlineLoading label="Loading corpora" />
              ) : null}
              {state.corpus.corpora.error ? (
                <p className="error-text">
                  {formatUiError(state.corpus.corpora.error)}
                </p>
              ) : null}
              {state.corpus.corpora.status === "ready" &&
              state.corpus.corpora.items.length === 0 ? (
                <p className="muted">No corpora</p>
              ) : null}
              <ul className="editor-panel__list">
                {state.corpus.corpora.items.map((c) => (
                  <li key={c.id}>
                    {c.name} · {c.kind} · {c.entryCount} · {c.status}
                    {c.diagnostics.length > 0 ? (
                      <div className="muted">{c.diagnostics.join("; ")}</div>
                    ) : null}
                    {c.status === "active" ? (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busy || state.corpus.actionPending}
                        onClick={() =>
                          setRemoveCorpus({
                            id: c.id,
                            revision: c.revision,
                            name: c.name,
                          })
                        }
                      >
                        Remove
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>

              <h2 className="insights-heading">Search</h2>
              <div className="editor-panel__row">
                <input
                  value={state.corpus.searchQuery}
                  disabled={busy}
                  onChange={(e) => assets.setCorpusSearchQuery(e.target.value)}
                  data-testid="corpus-search-query"
                  aria-label="Corpus search"
                />
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={busy}
                  onClick={() => void assets.runCorpusSearch(0)}
                  data-testid="corpus-search"
                >
                  Search
                </button>
              </div>
              {state.corpus.search.status === "loading" ? (
                <InlineLoading label="Loading search" />
              ) : null}
              {state.corpus.search.error ? (
                <p className="error-text">
                  {formatUiError(state.corpus.search.error)}
                </p>
              ) : null}
              <ul className="editor-panel__list">
                {state.corpus.search.items.map((h, i) => (
                  <li key={`${h.entry.id}-${i}`}>
                    {h.matchKind} · {h.matchedSide} · {h.corpus.name}
                    <div>{h.entry.sourceText}</div>
                    <div>{h.entry.targetText}</div>
                  </li>
                ))}
              </ul>
              {state.corpus.search.status === "ready" ? (
                <>
                  <div
                    className="pagination"
                    data-testid="corpus-search-paging"
                  >
                    <span className="pagination__count">
                      {pageLabel(
                        state.corpus.search.offset,
                        state.corpus.search.limit,
                        state.corpus.search.total,
                      )}
                    </span>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={busy || state.corpus.search.offset <= 0}
                      onClick={() =>
                        void assets.runCorpusSearch(
                          Math.max(
                            0,
                            state.corpus.search.offset -
                              state.corpus.search.limit,
                          ),
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
                        state.corpus.search.offset +
                          state.corpus.search.items.length >=
                          state.corpus.search.total
                      }
                      onClick={() =>
                        void assets.runCorpusSearch(
                          state.corpus.search.offset +
                            state.corpus.search.limit,
                        )
                      }
                    >
                      Next
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {state.section === "catalog" ? (
            <div data-testid="assets-catalog">
              <div className="editor-panel__row">
                <input
                  value={state.catalog.query}
                  disabled={busy}
                  onChange={(e) => assets.setCatalogQuery(e.target.value)}
                  data-testid="catalog-query"
                  aria-label="Catalog query"
                />
                <select
                  value={state.catalog.kind}
                  disabled={busy}
                  onChange={(e) =>
                    assets.setCatalogKind(
                      e.target.value as typeof state.catalog.kind,
                    )
                  }
                  aria-label="Kind"
                  data-testid="catalog-kind"
                >
                  <option value="all">All</option>
                  <option value="tm">TM</option>
                  <option value="termbase">Termbase</option>
                  <option value="corpus">Corpus</option>
                </select>
                <input
                  value={state.catalog.sourceLocale}
                  disabled={busy}
                  onChange={(e) =>
                    assets.setCatalogFilter({ sourceLocale: e.target.value })
                  }
                  aria-label="Source locale"
                  data-testid="catalog-source-locale"
                  placeholder="Source locale"
                />
                <input
                  value={state.catalog.targetLocale}
                  disabled={busy}
                  onChange={(e) =>
                    assets.setCatalogFilter({ targetLocale: e.target.value })
                  }
                  aria-label="Target locale"
                  data-testid="catalog-target-locale"
                  placeholder="Target locale"
                />
                <input
                  value={state.catalog.domain}
                  disabled={busy}
                  onChange={(e) =>
                    assets.setCatalogFilter({ domain: e.target.value })
                  }
                  aria-label="Domain"
                  data-testid="catalog-domain"
                  placeholder="Domain"
                />
                <input
                  value={state.catalog.originProjectId}
                  disabled={busy}
                  onChange={(e) =>
                    assets.setCatalogFilter({ originProjectId: e.target.value })
                  }
                  aria-label="Origin project"
                  data-testid="catalog-origin-project"
                  placeholder="Origin project"
                />
                <input
                  value={state.catalog.originDocumentId}
                  disabled={busy}
                  onChange={(e) =>
                    assets.setCatalogFilter({
                      originDocumentId: e.target.value,
                    })
                  }
                  aria-label="Origin document"
                  data-testid="catalog-origin-document"
                  placeholder="Origin document"
                />
                <input
                  value={state.catalog.createdAfterMs}
                  disabled={busy}
                  onChange={(e) =>
                    assets.setCatalogFilter({ createdAfterMs: e.target.value })
                  }
                  aria-label="Created after ms"
                  data-testid="catalog-created-after"
                  placeholder="After ms"
                />
                <input
                  value={state.catalog.createdBeforeMs}
                  disabled={busy}
                  onChange={(e) =>
                    assets.setCatalogFilter({ createdBeforeMs: e.target.value })
                  }
                  aria-label="Created before ms"
                  data-testid="catalog-created-before"
                  placeholder="Before ms"
                />
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={busy}
                  onClick={() => void assets.loadCatalog(0)}
                  data-testid="catalog-search"
                >
                  List
                </button>
              </div>
              {state.catalog.page.status === "loading" ? (
                <InlineLoading label="Loading search" />
              ) : null}
              {state.catalog.page.error ? (
                <p className="error-text">
                  {formatUiError(state.catalog.page.error)}
                </p>
              ) : null}
              {state.catalog.page.status === "ready" &&
              state.catalog.page.items.length === 0 ? (
                <p className="muted">No items</p>
              ) : null}
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Kind</th>
                      <th scope="col">Collection</th>
                      <th scope="col">Source</th>
                      <th scope="col">Target</th>
                      <th scope="col">Quality</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.catalog.page.items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.kind}</td>
                        <td>{item.collectionName}</td>
                        <td>{item.sourceText}</td>
                        <td>{item.targetText}</td>
                        <td>
                          {formatBasisPoints(item.qualityScoreBasisPoints)}
                        </td>
                      </tr>
                    ))}
                    {state.catalog.page.items.length === 0 ? (
                      <TableEmpty colSpan={5} />
                    ) : null}
                  </tbody>
                </table>
              </div>
              <div className="pagination">
                <span className="pagination__count">
                  {pageLabel(
                    state.catalog.page.offset,
                    state.catalog.page.limit,
                    state.catalog.page.total,
                  )}
                </span>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={busy || state.catalog.page.offset <= 0}
                  onClick={() =>
                    void assets.loadCatalog(
                      Math.max(
                        0,
                        state.catalog.page.offset - state.catalog.page.limit,
                      ),
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
                    state.catalog.page.offset +
                      state.catalog.page.items.length >=
                      state.catalog.page.total
                  }
                  onClick={() =>
                    void assets.loadCatalog(
                      state.catalog.page.offset + state.catalog.page.limit,
                    )
                  }
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}

          {state.section === "curation" ? (
            <div data-testid="assets-curation">
              <h2 className="insights-heading">Run</h2>
              <div className="editor-panel__row">
                <select
                  value={state.curation.libraryId}
                  disabled={busy}
                  onChange={(e) => assets.setCurationLibraryId(e.target.value)}
                  aria-label="Library"
                  data-testid="curation-library"
                >
                  <option value="">TM library</option>
                  {state.tm.libraries.items.map((lib) => (
                    <option key={lib.id} value={lib.id}>
                      {lib.name}
                    </option>
                  ))}
                </select>
                <input
                  value={state.curation.reason}
                  disabled={busy}
                  onChange={(e) => assets.setCurationReason(e.target.value)}
                  placeholder="Reason"
                  aria-label="Curation reason"
                  data-testid="curation-reason"
                />
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={
                    busy ||
                    state.curation.runPending ||
                    !state.curation.libraryId ||
                    !state.curation.reason.trim()
                  }
                  onClick={() => void assets.startCuration()}
                  data-testid="curation-run"
                >
                  Start
                </button>
              </div>
              <div
                className="editor-panel__row"
                data-testid="curation-policy"
                aria-label="Curation policy"
              >
                {(
                  [
                    ["minimumChars", "Min chars"],
                    ["minimumLengthRatioPercent", "Min ratio %"],
                    ["maximumLengthRatioPercent", "Max ratio %"],
                    ["minimumTermFrequency", "Min term freq"],
                    ["nearDuplicateThreshold", "Near dup"],
                    ["quarantineThresholdBasisPoints", "Quarantine bp"],
                    ["semanticAlignmentThresholdBasisPoints", "Semantic bp"],
                  ] as const
                ).map(([key, label]) => (
                  <label className="field" key={key}>
                    <span>{label}</span>
                    <input
                      type="number"
                      value={state.curation.policy[key]}
                      disabled={busy}
                      onChange={(e) =>
                        assets.patchCurationPolicy({
                          [key]: Number(e.target.value),
                        })
                      }
                      data-testid={`curation-policy-${key}`}
                    />
                  </label>
                ))}
              </div>
              <div className="editor-panel__row">
                <input
                  value={state.curation.knownRunId}
                  disabled={busy}
                  onChange={(e) => assets.setKnownRunId(e.target.value)}
                  placeholder="Run ID"
                  aria-label="Curation run ID"
                  data-testid="curation-run-id"
                />
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={busy || !state.curation.knownRunId.trim()}
                  onClick={() => void assets.loadCurationRun()}
                  data-testid="curation-load"
                >
                  Load
                </button>
              </div>
              {state.curation.runError ? (
                <p className="error-text">
                  {formatUiError(state.curation.runError)}
                </p>
              ) : null}
              {state.curation.runPending ? (
                <p className="muted">Running</p>
              ) : null}
              {state.curation.snapshot ? (
                <div data-testid="curation-snapshot">
                  <p className="muted">
                    {state.curation.snapshot.run.id} ·{" "}
                    {state.curation.snapshot.run.status} ·{" "}
                    {state.curation.snapshot.run.mode} · findings{" "}
                    {state.curation.snapshot.run.summary.analysis.findingCount}
                  </p>
                </div>
              ) : null}
              {state.curation.actionError ? (
                <p className="error-text">
                  {formatUiError(state.curation.actionError)}
                </p>
              ) : null}
              {state.curation.exportMessage ? (
                <p className="muted" data-testid="curation-export-result">
                  {state.curation.exportMessage}
                </p>
              ) : null}

              <h2 className="insights-heading">Findings</h2>
              {state.curation.findings.status === "loading" ? (
                <InlineLoading label="Loading findings" />
              ) : null}
              {state.curation.findings.status === "ready" &&
              state.curation.findings.items.length === 0 ? (
                <p className="muted">No findings</p>
              ) : null}
              <ul
                className="editor-panel__list"
                data-testid="curation-findings"
              >
                {state.curation.findings.items.map((f) => (
                  <li key={f.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={state.curation.selectedFindingIds.includes(
                          f.id,
                        )}
                        disabled={busy}
                        onChange={() => assets.toggleFinding(f.id)}
                      />{" "}
                      {f.kind} · {f.disposition} ·{" "}
                      {formatBasisPoints(f.qualityScoreBasisPoints)}
                    </label>
                    <div className="muted">{f.explanation}</div>
                  </li>
                ))}
              </ul>
              <div className="editor-panel__row">
                <input
                  value={curationActionReason}
                  disabled={busy}
                  onChange={(e) => setCurationActionReason(e.target.value)}
                  placeholder="Reason"
                  aria-label="Action reason"
                  data-testid="curation-action-reason"
                />
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={
                    busy ||
                    state.curation.actionPending ||
                    state.curation.selectedFindingIds.length === 0 ||
                    !curationActionReason.trim()
                  }
                  onClick={() =>
                    void assets.applyFindings(curationActionReason)
                  }
                  data-testid="curation-apply"
                >
                  Apply
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={
                    busy ||
                    state.curation.actionPending ||
                    !state.curation.snapshot ||
                    !curationActionReason.trim()
                  }
                  onClick={() => setRollbackOpen(true)}
                  data-testid="curation-rollback"
                >
                  Rollback
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={
                    busy ||
                    state.curation.actionPending ||
                    !state.curation.snapshot
                  }
                  onClick={() => void assets.exportCuration("jsonl")}
                  data-testid="curation-export"
                >
                  Export
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {removeCorpus ? (
          <ConfirmDialog
            title="Remove corpus"
            body={`${removeCorpus.name} will be removed.`}
            confirmLabel="Remove"
            pending={state.corpus.actionPending}
            error={
              state.corpus.actionError
                ? formatUiError(state.corpus.actionError)
                : null
            }
            reasonLabel="Reason"
            reason={removeReason}
            onReasonChange={setRemoveReason}
            onCancel={() => {
              setRemoveCorpus(null);
              setRemoveReason("");
            }}
            onConfirm={() => {
              if (!removeReason.trim()) return;
              void assets
                .removeCorpus(
                  removeCorpus.id,
                  removeCorpus.revision,
                  removeReason.trim(),
                )
                .then((ok) => {
                  if (ok) {
                    setRemoveCorpus(null);
                    setRemoveReason("");
                  }
                });
            }}
            testId="corpus-remove-confirm"
          />
        ) : null}
        {rollbackOpen ? (
          <ConfirmDialog
            title="Rollback curation"
            body="Rollback this curation run?"
            confirmLabel="Rollback"
            pending={state.curation.actionPending}
            error={
              state.curation.actionError
                ? formatUiError(state.curation.actionError)
                : null
            }
            reasonLabel="Reason"
            reason={curationActionReason}
            onReasonChange={setCurationActionReason}
            onCancel={() => setRollbackOpen(false)}
            onConfirm={() => {
              if (!curationActionReason.trim()) return;
              void assets.rollbackCuration(curationActionReason).then((ok) => {
                if (ok) setRollbackOpen(false);
              });
            }}
            testId="curation-rollback-confirm"
          />
        ) : null}
      </div>
    </section>
  );
}
