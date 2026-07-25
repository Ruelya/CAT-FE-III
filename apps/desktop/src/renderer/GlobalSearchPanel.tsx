import {
  Fragment,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { GlobalSearchHit } from "@translunar/contracts";
import { ArrowRight, Search, X } from "lucide-react";

import { useLocale } from "./i18n/LocaleProvider";
import { parseSearchSnippet } from "./project-home-utils";
import { formatError } from "./workbench-utils";

export interface GlobalSearchProjectOption {
  id: string;
  name: string;
}

interface GlobalSearchPanelProps {
  variant: "home" | "workbench";
  projects?: GlobalSearchProjectOption[];
  autoFocus?: boolean;
  onClose?(): void;
  onOpen(hit: GlobalSearchHit): Promise<void>;
}

export function GlobalSearchPanel({
  variant,
  projects = [],
  autoFocus = false,
  onClose,
  onOpen,
}: GlobalSearchPanelProps) {
  const { t } = useLocale();
  const pageLimit = variant === "workbench" ? 20 : 50;
  const [text, setText] = useState("");
  const [projectId, setProjectId] = useState("");
  const [field, setField] = useState("");
  const [workflowState, setWorkflowState] = useState("");
  const [hits, setHits] = useState<GlobalSearchHit[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const search = async (nextOffset = 0) => {
    const query = text.trim();
    if (!query) return;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    setError(null);
    try {
      const page = await window.translunar.invoke("search.global", {
        text: query,
        projectId: projectId || null,
        fields: field ? [field] : [],
        workflowState: workflowState || null,
        includeRecycled: false,
        offset: nextOffset,
        limit: pageLimit,
      });
      if (requestRef.current !== requestId) return;
      setHits(page.items);
      setTotal(page.total);
      setOffset(page.offset);
      setSearched(true);
    } catch (reason) {
      if (requestRef.current === requestId) setError(formatError(reason));
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void search(0);
  };

  const openHit = async (hit: GlobalSearchHit, index: number) => {
    const key = searchHitKey(hit, index);
    setOpeningKey(key);
    setError(null);
    try {
      await onOpen(hit);
      if (variant === "workbench") onClose?.();
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setOpeningKey(null);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (variant !== "workbench" || event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose?.();
  };

  return (
    <div
      className={`global-search-panel ${variant}`}
      aria-busy={loading || openingKey !== null}
      onKeyDown={onKeyDown}
    >
      {variant === "workbench" ? (
        <header className="workbench-global-search-heading">
          <div>
            <small>{t("home.workspaceIndex")}</small>
            <strong>{t("home.globalSearch")}</strong>
          </div>
          <button
            type="button"
            className="icon-button"
            title={t("common.close")}
            aria-label={t("common.close")}
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </header>
      ) : null}

      <form
        className={
          variant === "workbench"
            ? "workbench-global-search-form"
            : "global-search-form"
        }
        onSubmit={submit}
      >
        <label className="global-search-query">
          <Search size={16} />
          <input
            autoFocus={autoFocus}
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
            placeholder={t("home.searchPlaceholder")}
            aria-label={t("home.globalSearchQuery")}
            required
          />
        </label>
        {variant === "home" ? (
          <>
            <select
              aria-label={t("home.searchProject")}
              value={projectId}
              onChange={(event) => setProjectId(event.currentTarget.value)}
            >
              <option value="">{t("home.allActiveProjects")}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <select
              aria-label={t("home.searchField")}
              value={field}
              onChange={(event) => setField(event.currentTarget.value)}
            >
              <option value="">{t("home.allFields")}</option>
              <option value="source">{t("home.fieldSource")}</option>
              <option value="target">{t("home.fieldTarget")}</option>
              <option value="project">{t("home.fieldProject")}</option>
              <option value="document">{t("home.fieldDocument")}</option>
              <option value="comment">{t("home.fieldComment")}</option>
              <option value="note">{t("home.fieldNote")}</option>
            </select>
            <select
              aria-label={t("home.searchWorkflowState")}
              value={workflowState}
              onChange={(event) => setWorkflowState(event.currentTarget.value)}
            >
              <option value="">{t("home.anyWorkflowState")}</option>
              <option value="translation">
                {t("home.workflowTranslation")}
              </option>
              <option value="review">{t("home.workflowReview")}</option>
              <option value="signed">{t("home.workflowSigned")}</option>
            </select>
          </>
        ) : null}
        <button
          className="button primary"
          type="submit"
          disabled={loading || openingKey !== null || !text.trim()}
        >
          <Search size={15} />
          {loading ? t("common.loading") : t("home.searchSubmit")}
        </button>
      </form>

      {error ? (
        <p className="surface-error global-search-error" role="alert">
          {error}
        </p>
      ) : null}

      {!searched || (!hits.length && total === 0) ? (
        <div
          className={
            variant === "workbench"
              ? "global-search-empty compact"
              : "project-home-empty"
          }
        >
          <Search size={25} />
          <strong>
            {searched
              ? t("home.noMatchingContent")
              : t("home.searchEveryActive")}
          </strong>
          <span>{searched ? t("home.tryAnother") : t("home.resultsLink")}</span>
        </div>
      ) : (
        <SearchResults
          hits={hits}
          total={total}
          offset={offset}
          openingKey={openingKey}
          compact={variant === "workbench"}
          onOpen={openHit}
        />
      )}

      {total > pageLimit ? (
        <div className="project-pagination global-search-pagination">
          <button
            type="button"
            disabled={offset === 0 || loading || openingKey !== null}
            onClick={() => void search(Math.max(0, offset - pageLimit))}
          >
            {t("action.back")}
          </button>
          <button
            type="button"
            disabled={
              offset + hits.length >= total || loading || openingKey !== null
            }
            onClick={() => void search(offset + pageLimit)}
          >
            {t("action.next")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SearchResults({
  hits,
  total,
  offset,
  openingKey,
  compact,
  onOpen,
}: {
  hits: GlobalSearchHit[];
  total: number;
  offset: number;
  openingKey: string | null;
  compact: boolean;
  onOpen(hit: GlobalSearchHit, index: number): Promise<void>;
}) {
  const { t } = useLocale();
  return (
    <div className={compact ? "search-results compact" : "search-results"}>
      <header>
        <strong>{t("home.resultCount", { count: total })}</strong>
        <span>
          {offset + 1}-{Math.min(offset + hits.length, total)}
        </span>
      </header>
      {hits.map((hit, index) => {
        const key = searchHitKey(hit, index);
        return (
          <button
            key={key}
            type="button"
            disabled={openingKey !== null}
            onClick={() => void onOpen(hit, index)}
          >
            <span className="search-result-field">
              {searchFieldLabel(t, hit.field)}
            </span>
            <strong>
              {hit.projectName}
              {hit.documentName ? ` / ${hit.documentName}` : ""}
            </strong>
            <p>
              {parseSearchSnippet(hit.snippet).map((part, partIndex) => (
                <Fragment key={`${part.highlighted}-${partIndex}`}>
                  {part.highlighted ? <mark>{part.text}</mark> : part.text}
                </Fragment>
              ))}
            </p>
            <footer>
              {searchWorkflowLabel(t, hit.workflowState)}
              {hit.segmentOrdinal !== undefined && hit.segmentOrdinal !== null
                ? ` · ${t("home.segmentNumber", {
                    number: hit.segmentOrdinal + 1,
                  })}`
                : ""}
              <ArrowRight size={14} />
            </footer>
          </button>
        );
      })}
    </div>
  );
}

function searchHitKey(hit: GlobalSearchHit, index: number): string {
  return [
    hit.projectId,
    hit.documentId ?? "project",
    hit.segmentId ?? hit.field,
    index,
  ].join(":");
}

function searchFieldLabel(
  t: ReturnType<typeof useLocale>["t"],
  field: string,
): string {
  switch (field) {
    case "source":
      return t("home.fieldSource");
    case "target":
      return t("home.fieldTarget");
    case "project":
      return t("home.fieldProject");
    case "document":
      return t("home.fieldDocument");
    case "comment":
      return t("home.fieldComment");
    case "note":
      return t("home.fieldNote");
    default:
      return field.replaceAll("_", " ");
  }
}

function searchWorkflowLabel(
  t: ReturnType<typeof useLocale>["t"],
  state: string | null | undefined,
): string {
  switch (state) {
    case "translation":
      return t("home.workflowTranslation");
    case "review":
      return t("home.workflowReview");
    case "signed":
      return t("home.workflowSigned");
    default:
      return state ?? t("common.project");
  }
}
