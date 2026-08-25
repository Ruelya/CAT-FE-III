import { useEffect, useState } from "react";

import type { Segment, TmMatchItem } from "@translunar/contracts";
import { Badge, Button, EmptyState, Panel } from "@translunar/ui";

import { callEngine, describeError } from "../lib/engine.js";

export interface TmPanelProps {
  projectId: string;
  activeSegment: Segment | null;
  onApply: (targetText: string) => void;
}

const GRADE_LABEL: Record<TmMatchItem["grade"], string> = {
  exact: "精确",
  inContext: "上下文",
  fuzzy: "模糊",
};

function gradeTone(grade: TmMatchItem["grade"]): "ok" | "accent" {
  return grade === "fuzzy" ? "accent" : "ok";
}

export function TmPanel({ projectId, activeSegment, onApply }: TmPanelProps) {
  const [matches, setMatches] = useState<TmMatchItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMatches([]);
    setError(null);
    if (!activeSegment) {
      return;
    }
    let cancelled = false;
    callEngine("tm.lookup", {
      projectId,
      sourceText: activeSegment.sourceText,
    })
      .then((result) => {
        if (!cancelled) {
          setMatches(result.matches);
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
  }, [projectId, activeSegment]);

  return (
    <Panel title="翻译记忆" className="dock-panel">
      {!activeSegment ? (
        <EmptyState title="未选中句段" hint="在网格中选中句段后自动查询 TM。" />
      ) : error ? (
        <div className="honest-note" data-tone="danger" role="alert">
          {error}
        </div>
      ) : matches.length === 0 ? (
        <EmptyState
          title="无匹配"
          hint="确认句段后会写入项目 TM；相同源文显示 100% 精确匹配，相似源文按分值显示模糊匹配。"
        />
      ) : (
        <div className="dock-stack">
          {matches.map((match) => (
            <div key={match.entry.id} className="match-card">
              <div className="match-card__row">
                <span className="match-card__grade">
                  <Badge tone={gradeTone(match.grade)}>{match.score}%</Badge>
                  <Badge tone="neutral">{GRADE_LABEL[match.grade]}</Badge>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onApply(match.entry.targetText)}
                >
                  应用为草稿
                </Button>
              </div>
              <p className="match-card__text">{match.entry.targetText}</p>
              <span className="match-card__origin">
                源：{match.entry.sourceText}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
