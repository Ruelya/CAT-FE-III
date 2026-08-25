import { useEffect, useMemo, useState } from "react";

import type { Segment } from "@translunar/contracts";
import { Badge, Button, EmptyState, Panel, TextField } from "@translunar/ui";

export interface ConcordanceHit {
  segment: Segment;
  field: "source" | "target";
  text: string;
}

export interface ConcordancePanelProps {
  segments: Segment[];
  /** Seed query, e.g. the text selection captured on F3. */
  initialQuery: string;
  onJump: (segmentId: string) => void;
}

/** Case-insensitive substring search over the loaded document's segments. */
export function searchConcordance(
  segments: readonly Segment[],
  query: string,
): ConcordanceHit[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return [];
  }
  const hits: ConcordanceHit[] = [];
  for (const segment of segments) {
    if (segment.sourceText.toLowerCase().includes(needle)) {
      hits.push({ segment, field: "source", text: segment.sourceText });
    }
    if (
      segment.targetText.length > 0 &&
      segment.targetText.toLowerCase().includes(needle)
    ) {
      hits.push({ segment, field: "target", text: segment.targetText });
    }
  }
  return hits;
}

function Highlighted({ text, query }: { text: string; query: string }) {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return <>{text}</>;
  }
  const parts: Array<{ chunk: string; hit: boolean }> = [];
  let rest = text;
  let restLower = text.toLowerCase();
  let index = restLower.indexOf(needle);
  while (index >= 0) {
    if (index > 0) {
      parts.push({ chunk: rest.slice(0, index), hit: false });
    }
    parts.push({ chunk: rest.slice(index, index + needle.length), hit: true });
    rest = rest.slice(index + needle.length);
    restLower = restLower.slice(index + needle.length);
    index = restLower.indexOf(needle);
  }
  if (rest.length > 0) {
    parts.push({ chunk: rest, hit: false });
  }
  return (
    <>
      {parts.map((part, i) =>
        part.hit ? (
          <mark key={i} className="concordance__hit">
            {part.chunk}
          </mark>
        ) : (
          <span key={i}>{part.chunk}</span>
        ),
      )}
    </>
  );
}

export function ConcordancePanel({
  segments,
  initialQuery,
  onJump,
}: ConcordancePanelProps) {
  const [query, setQuery] = useState(initialQuery);

  // F3 with a new selection re-seeds the query even if the tab was open.
  useEffect(() => {
    if (initialQuery.trim().length > 0) {
      setQuery(initialQuery);
    }
  }, [initialQuery]);

  const hits = useMemo(() => searchConcordance(segments, query), [
    segments,
    query,
  ]);

  return (
    <Panel
      title="Concordance 检索"
      className="dock-panel"
      actions={
        query.trim() ? <Badge tone="accent">{hits.length} 命中</Badge> : null
      }
    >
      <div className="dock-stack">
        <TextField
          label="检索词（F3 取编辑区选中文本）"
          value={query}
          placeholder="在当前文档的源文与译文中检索…"
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="honest-note">
          检索范围为当前文档的句段。引擎协议（v1）尚无 TM 级检索 API，TM
          concordance 将在引擎支持后接入。
        </div>
        {query.trim().length === 0 ? (
          <EmptyState
            title="输入检索词"
            hint="或在句段编辑器中选中文本后按 F3。"
          />
        ) : hits.length === 0 ? (
          <EmptyState title="无命中" hint="换一个检索词试试。" />
        ) : (
          <div className="dock-stack">
            {hits.map((hit) => (
              <div
                key={`${hit.segment.id}-${hit.field}`}
                className="match-card"
              >
                <div className="match-card__row">
                  <span className="concordance__meta">
                    <Badge tone={hit.field === "source" ? "neutral" : "accent"}>
                      {hit.field === "source" ? "源文" : "译文"}
                    </Badge>
                    <span className="concordance__ordinal">
                      #{hit.segment.ordinal + 1}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onJump(hit.segment.id)}
                  >
                    定位句段
                  </Button>
                </div>
                <p className="match-card__text">
                  <Highlighted text={hit.text} query={query} />
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
