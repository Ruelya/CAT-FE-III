import { useCallback, useEffect, useState } from "react";

import type {
  Segment,
  TermMatch,
  TermbaseListResult,
} from "@translunar/contracts";
import { Badge, Button, EmptyState, Panel, TextField } from "@translunar/ui";

import { callEngine, describeError } from "../lib/engine.js";

export interface TermPanelProps {
  projectId: string;
  targetLocale: string;
  activeSegment: Segment | null;
  /** Insert a term translation at the caret of the active target editor. */
  onInsert: (term: string) => void;
}

/**
 * Terminology dock backed by the real engine APIs: `termbase.list` for the
 * project mounts, `term.lookup` for in-text hits on the active segment, and
 * `term.add` for quick capture into the first writable mounted termbase.
 */
export function TermPanel({
  projectId,
  targetLocale,
  activeSegment,
  onInsert,
}: TermPanelProps) {
  const [mounts, setMounts] = useState<TermbaseListResult | null>(null);
  const [matches, setMatches] = useState<TermMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sourceTerm, setSourceTerm] = useState("");
  const [targetTerm, setTargetTerm] = useState("");
  const [adding, setAdding] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    callEngine("termbase.list", { projectId })
      .then((result) => {
        if (!cancelled) {
          setMounts(result);
        }
      })
      .catch((listError: unknown) => {
        if (!cancelled) {
          setError(describeError(listError));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey]);

  useEffect(() => {
    setMatches([]);
    if (!activeSegment) {
      return;
    }
    let cancelled = false;
    callEngine("term.lookup", {
      projectId,
      sourceText: activeSegment.sourceText,
    })
      .then((result) => {
        if (!cancelled) {
          setMatches(result.matches);
          setError(null);
        }
      })
      .catch((lookupError: unknown) => {
        if (!cancelled) {
          setError(describeError(lookupError));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, activeSegment, refreshKey]);

  const mountedTermbases =
    mounts === null
      ? []
      : mounts.mounts
          .filter((mount) => mount.enabled)
          .map((mount) =>
            mounts.termbases.find(
              (termbase) => termbase.id === mount.termbaseId,
            ),
          )
          .filter((termbase) => termbase !== undefined);
  const writableTermbase =
    mountedTermbases.find((termbase) => termbase.writable) ?? null;

  const addTerm = useCallback(async () => {
    if (!writableTermbase) {
      return;
    }
    setAdding(true);
    setError(null);
    try {
      await callEngine("term.add", {
        termbaseId: writableTermbase.id,
        sourceTerm: sourceTerm.trim(),
        targetTerm: targetTerm.trim(),
        targetLocale,
      });
      setSourceTerm("");
      setTargetTerm("");
      setRefreshKey((key) => key + 1);
    } catch (addError) {
      setError(describeError(addError));
    } finally {
      setAdding(false);
    }
  }, [writableTermbase, sourceTerm, targetTerm, targetLocale]);

  return (
    <Panel
      title="术语"
      className="dock-panel"
      actions={
        mountedTermbases.length > 0 ? (
          <Badge tone="ok">{mountedTermbases.length} 个术语库</Badge>
        ) : null
      }
    >
      <div className="dock-stack">
        {mounts !== null && mountedTermbases.length === 0 ? (
          <EmptyState
            title="尚未挂载术语库"
            hint="在「项目设置」中新建并挂载术语库后，此处会显示当前句段的术语命中。"
          />
        ) : !activeSegment ? (
          <EmptyState
            title="未选中句段"
            hint="选中句段后自动查询挂载术语库中的命中。"
          />
        ) : matches.length === 0 ? (
          <EmptyState
            title="当前句段无术语命中"
            hint="可在下方快速添加术语，之后源文中出现该术语即会命中。"
          />
        ) : (
          <div className="dock-stack">
            {matches.map((match) => (
              <div
                key={`${match.entryId}-${match.start}`}
                className="match-card"
              >
                <div className="match-card__row">
                  <span className="match-card__text">{match.sourceTerm}</span>
                </div>
                {match.translations.map((translation) => (
                  <div key={translation.id} className="match-card__row">
                    <span className="term-hit__target">
                      {translation.term}
                      {translation.forbidden ? (
                        <Badge tone="danger">禁用</Badge>
                      ) : translation.preferred ? (
                        <Badge tone="ok">首选</Badge>
                      ) : null}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={translation.forbidden}
                      onClick={() => onInsert(translation.term)}
                    >
                      插入
                    </Button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        {writableTermbase ? (
          <form
            className="form-stack"
            aria-label="快速添加术语"
            onSubmit={(event) => {
              event.preventDefault();
              void addTerm();
            }}
          >
            <TextField
              label={`源术语（写入「${writableTermbase.name}」）`}
              value={sourceTerm}
              placeholder="例如 retention period"
              onChange={(event) => setSourceTerm(event.target.value)}
              required
            />
            <TextField
              label="目标术语"
              value={targetTerm}
              placeholder="例如 保留期"
              onChange={(event) => setTargetTerm(event.target.value)}
              required
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={adding || !sourceTerm.trim() || !targetTerm.trim()}
            >
              {adding ? "添加中…" : "添加术语"}
            </Button>
          </form>
        ) : null}
        {error ? (
          <div className="honest-note" data-tone="danger" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
