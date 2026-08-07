import { useCallback, useEffect, useState } from "react";
import type {
  ProjectSnapshot,
  Termbase,
  TermbaseMount,
  TermMatch,
} from "@translunar/contracts";
import { BookMarked, Plus, Search } from "lucide-react";

import { formatError } from "../../workbench-utils";
import { useLocale } from "../../i18n/LocaleProvider";

export interface TermbaseHubPanelProps {
  snapshot: ProjectSnapshot;
  onRefresh(): Promise<void>;
}

export function TermbaseHubPanel({
  snapshot,
  onRefresh,
}: TermbaseHubPanelProps) {
  const { t } = useLocale();
  const projectId = snapshot.project.id;
  const [termbases, setTermbases] = useState<Termbase[]>([]);
  const [mounts, setMounts] = useState<TermbaseMount[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<TermMatch[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createName, setCreateName] = useState("");

  const loadTermbases = useCallback(async () => {
    const page = await window.translunar.invoke("termbase.list", {
      projectId,
      offset: 0,
      limit: 100,
    });
    setTermbases(page.items);
    setMounts(page.mounts);
    setTotal(page.total);
    setSelectedId((current) =>
      current && page.items.some((item) => item.id === current)
        ? current
        : (page.items[0]?.id ?? null),
    );
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadTermbases()
      .catch((reason: unknown) => {
        if (!cancelled) setError(formatError(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadTermbases]);

  useEffect(() => {
    if (!query.trim()) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void window.translunar
        .invoke("term.search", {
          projectId,
          text: query.trim(),
          limit: 40,
          offset: 0,
        })
        .then((result) => {
          if (!cancelled) setMatches(result.matches);
        })
        .catch((reason: unknown) => {
          if (!cancelled) {
            setMatches([]);
            setError(formatError(reason));
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [projectId, query]);

  const selected =
    termbases.find((termbase) => termbase.id === selectedId) ?? null;
  const selectedMount = selected
    ? mounts.find((mount) => mount.termbaseId === selected.id)
    : null;

  async function createTermbase() {
    if (!createName.trim()) return;
    setError(null);
    try {
      const created = await window.translunar.invoke("termbase.create", {
        name: createName.trim(),
        sourceLocale: snapshot.project.sourceLocale,
        writable: true,
      });
      await window.translunar.invoke("termbase.mount", {
        projectId,
        termbaseId: created.id,
        enabled: true,
      });
      setCreateName("");
      await loadTermbases();
      await onRefresh();
    } catch (reason) {
      setError(formatError(reason));
    }
  }

  async function toggleMount() {
    if (!selected) return;
    setError(null);
    try {
      if (selectedMount) {
        await window.translunar.invoke("termbase.unmount", {
          projectId,
          termbaseId: selected.id,
          expectedRevision: selectedMount.revision,
        });
      } else {
        await window.translunar.invoke("termbase.mount", {
          projectId,
          termbaseId: selected.id,
          enabled: true,
        });
      }
      await loadTermbases();
      await onRefresh();
    } catch (reason) {
      setError(formatError(reason));
    }
  }

  return (
    <div className="term-hub" aria-busy={loading || searching}>
      <aside className="term-hub__list" aria-label={t("assets.terms.list")}>
        <header>
          <strong>{t("assets.terms.list")}</strong>
          <span className="num">{total}</span>
        </header>
        {loading ? (
          <p className="micro">{t("status.loading")}</p>
        ) : termbases.length ? (
          <ul>
            {termbases.map((termbase) => {
              const mounted = mounts.some(
                (mount) =>
                  mount.termbaseId === termbase.id && mount.enabled,
              );
              return (
                <li key={termbase.id}>
                  <button
                    type="button"
                    data-selected={termbase.id === selectedId || undefined}
                    onClick={() => setSelectedId(termbase.id)}
                  >
                    <BookMarked size={14} aria-hidden="true" />
                    <span>
                      <strong>{termbase.name}</strong>
                      <small>
                        {termbase.sourceLocale}
                        {mounted ? ` · ${t("assets.tm.mounted")}` : ""}
                      </small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="surface-empty">
            <BookMarked size={22} aria-hidden="true" />
            <strong>{t("assets.terms.empty")}</strong>
          </div>
        )}
        <div className="term-hub__create">
          <input
            value={createName}
            onChange={(event) => setCreateName(event.currentTarget.value)}
            placeholder={t("assets.terms.createPlaceholder")}
            aria-label={t("assets.terms.createPlaceholder")}
          />
          <button
            type="button"
            className="button secondary"
            disabled={!createName.trim()}
            onClick={() => void createTermbase()}
          >
            <Plus size={14} aria-hidden="true" />
            {t("assets.terms.create")}
          </button>
        </div>
      </aside>

      <section className="term-hub__detail" aria-label={t("assets.terms.detail")}>
        {error ? (
          <p className="surface-error" role="alert">
            {error}
          </p>
        ) : null}
        {selected ? (
          <>
            <header>
              <div>
                <h2>{selected.name}</h2>
                <p className="micro">
                  {selected.sourceLocale}
                  {selected.writable ? "" : ` · ${t("common.readOnly")}`}
                </p>
              </div>
              <button
                type="button"
                className="button secondary"
                onClick={() => void toggleMount()}
              >
                {selectedMount
                  ? t("assets.tm.unmount")
                  : t("assets.tm.mount")}
              </button>
            </header>
          </>
        ) : (
          <div className="surface-empty">
            <strong>{t("assets.terms.select")}</strong>
          </div>
        )}

        <label className="term-hub__search">
          <Search size={15} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={t("assets.terms.searchPlaceholder")}
            aria-label={t("assets.terms.searchAria")}
          />
        </label>
        {searching ? (
          <p className="micro">{t("assets.terms.searching")}</p>
        ) : matches.length ? (
          <div className="term-hub__results">
            {matches.map((match) => {
              const preferred = match.translations.find((item) => item.preferred);
              const forbidden = match.translations.find((item) => item.forbidden);
              const primary =
                preferred ??
                match.translations.find((item) => !item.forbidden) ??
                match.translations[0];
              return (
                <article key={`${match.entryId}-${match.start}`} className="term-hub__match">
                  <header>
                    <strong>{match.sourceTerm}</strong>
                    {preferred ? (
                      <span className="term-chip" data-state="preferred">
                        {t("workbench.termState.preferred")}
                      </span>
                    ) : null}
                    {forbidden ? (
                      <span className="term-chip" data-state="forbidden">
                        {t("workbench.termState.forbidden")}
                      </span>
                    ) : null}
                  </header>
                  <p>{primary?.term ?? "—"}</p>
                </article>
              );
            })}
          </div>
        ) : query.trim() ? (
          <div className="surface-empty">
            <strong>{t("assets.terms.noMatches")}</strong>
          </div>
        ) : (
          <p className="micro">{t("assets.terms.searchHint")}</p>
        )}
      </section>
    </div>
  );
}
