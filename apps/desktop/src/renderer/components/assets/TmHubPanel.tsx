import { useCallback, useEffect, useState } from "react";
import type {
  ProjectSnapshot,
  TmLibrary,
  TmLibraryMount,
  TmMatch,
} from "@translunar/contracts";
import { Database, Plus, Search } from "lucide-react";

import { formatError } from "../../workbench-utils";
import { useLocale } from "../../i18n/LocaleProvider";

export interface TmHubPanelProps {
  snapshot: ProjectSnapshot;
  onRefresh(): Promise<void>;
}

export function TmHubPanel({ snapshot, onRefresh }: TmHubPanelProps) {
  const { t } = useLocale();
  const projectId = snapshot.project.id;
  const [libraries, setLibraries] = useState<TmLibrary[]>([]);
  const [mounts, setMounts] = useState<TmLibraryMount[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<TmMatch[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createName, setCreateName] = useState("");

  const loadLibraries = useCallback(async () => {
    const page = await window.translunar.invoke("tm.library.list", {
      projectId,
      offset: 0,
      limit: 100,
    });
    setLibraries(page.items);
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
    void loadLibraries()
      .catch((reason: unknown) => {
        if (!cancelled) setError(formatError(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadLibraries]);

  useEffect(() => {
    if (!query.trim()) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void window.translunar
        .invoke("tm.search", {
          projectId,
          query: query.trim(),
          sourceLocale: snapshot.project.sourceLocale,
          targetLocale: snapshot.project.targetLocale,
          limit: 30,
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
  }, [
    projectId,
    query,
    snapshot.project.sourceLocale,
    snapshot.project.targetLocale,
  ]);

  const selected =
    libraries.find((library) => library.id === selectedId) ?? null;
  const selectedMount = selected
    ? mounts.find((mount) => mount.libraryId === selected.id)
    : null;

  async function createLibrary() {
    if (!createName.trim()) return;
    setError(null);
    setNotice(null);
    try {
      const created = await window.translunar.invoke("tm.library.create", {
        name: createName.trim(),
        sourceLocale: snapshot.project.sourceLocale,
        targetLocale: snapshot.project.targetLocale,
      });
      await window.translunar.invoke("tm.library.mount", {
        projectId,
        libraryId: created.id,
        mode: "write",
        enabled: true,
      });
      setCreateName("");
      await loadLibraries();
      await onRefresh();
      setNotice(t("assets.tm.created"));
    } catch (reason) {
      setError(formatError(reason));
    }
  }

  async function toggleMount() {
    if (!selected) return;
    setError(null);
    try {
      if (selectedMount) {
        await window.translunar.invoke("tm.library.unmount", {
          projectId,
          libraryId: selected.id,
          expectedRevision: selectedMount.revision,
        });
      } else {
        await window.translunar.invoke("tm.library.mount", {
          projectId,
          libraryId: selected.id,
          mode: "write",
          enabled: true,
        });
      }
      await loadLibraries();
      await onRefresh();
    } catch (reason) {
      setError(formatError(reason));
    }
  }

  return (
    <div className="tm-hub" aria-busy={loading || searching}>
      <aside className="tm-hub__list" aria-label={t("assets.tm.libraries")}>
        <header>
          <strong>{t("assets.tm.libraries")}</strong>
          <span className="num">{total}</span>
        </header>
        {loading ? (
          <p className="micro">{t("status.loading")}</p>
        ) : libraries.length ? (
          <ul>
            {libraries.map((library) => {
              const mounted = mounts.some(
                (mount) => mount.libraryId === library.id && mount.enabled,
              );
              return (
                <li key={library.id}>
                  <button
                    type="button"
                    data-selected={library.id === selectedId || undefined}
                    onClick={() => setSelectedId(library.id)}
                  >
                    <Database size={14} aria-hidden="true" />
                    <span>
                      <strong>{library.name}</strong>
                      <small>
                        {library.sourceLocale} → {library.targetLocale}
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
            <Database size={22} aria-hidden="true" />
            <strong>{t("assets.tm.empty")}</strong>
          </div>
        )}
        <div className="tm-hub__create">
          <input
            value={createName}
            onChange={(event) => setCreateName(event.currentTarget.value)}
            placeholder={t("assets.tm.createPlaceholder")}
            aria-label={t("assets.tm.createPlaceholder")}
          />
          <button
            type="button"
            className="button secondary"
            disabled={!createName.trim()}
            onClick={() => void createLibrary()}
          >
            <Plus size={14} aria-hidden="true" />
            {t("assets.tm.create")}
          </button>
        </div>
      </aside>

      <section className="tm-hub__detail" aria-label={t("assets.tm.detail")}>
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
        {selected ? (
          <>
            <header>
              <div>
                <h2>{selected.name}</h2>
                <p className="micro">
                  {selected.sourceLocale} → {selected.targetLocale}
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
            <p className="tm-hub__health micro">{t("assets.tm.healthResidual")}</p>
          </>
        ) : (
          <div className="surface-empty">
            <strong>{t("assets.tm.selectLibrary")}</strong>
          </div>
        )}

        <label className="tm-hub__search">
          <Search size={15} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={t("assets.tm.searchPlaceholder")}
            aria-label={t("assets.tm.searchAria")}
          />
        </label>
        {searching ? (
          <p className="micro">{t("assets.tm.searching")}</p>
        ) : matches.length ? (
          <div className="tm-hub__results">
            {matches.map((match) => (
              <article key={match.unit.id} className="tm-hub__match">
                <header>
                  <span className="num">
                    {Math.round(match.score * 100)}%
                  </span>
                  <span>{match.library.name}</span>
                </header>
                <p>{match.unit.sourceText}</p>
                <p className="tm-hub__target">{match.unit.targetText}</p>
              </article>
            ))}
          </div>
        ) : query.trim() ? (
          <div className="surface-empty">
            <strong>{t("assets.tm.noMatches")}</strong>
          </div>
        ) : (
          <p className="micro">{t("assets.tm.searchHint")}</p>
        )}
      </section>
    </div>
  );
}
