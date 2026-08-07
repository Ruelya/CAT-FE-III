import type { DegradationFinding } from "@translunar/contracts";

export interface ExportDegradationListProps {
  preExport: readonly DegradationFinding[];
  postExport: readonly DegradationFinding[] | null;
  labels: {
    title: string;
    preTitle: string;
    postTitle: string;
    empty: string;
    path: string;
  };
}

export function ExportDegradationList({
  preExport,
  postExport,
  labels,
}: ExportDegradationListProps) {
  return (
    <section className="export-degradation" aria-label={labels.title}>
      <header>
        <h2>{labels.title}</h2>
      </header>

      <div className="export-degradation__block">
        <h3 className="micro">{labels.preTitle}</h3>
        <DegradationRows findings={preExport} empty={labels.empty} pathLabel={labels.path} />
      </div>

      {postExport ? (
        <div className="export-degradation__block">
          <h3 className="micro">{labels.postTitle}</h3>
          <DegradationRows
            findings={postExport}
            empty={labels.empty}
            pathLabel={labels.path}
          />
        </div>
      ) : null}
    </section>
  );
}

function DegradationRows({
  findings,
  empty,
  pathLabel,
}: {
  findings: readonly DegradationFinding[];
  empty: string;
  pathLabel: string;
}) {
  if (!findings.length) {
    return <p className="export-degradation__empty">{empty}</p>;
  }
  return (
    <ul className="export-degradation-list">
      {findings.map((finding, index) => (
        <li key={`${finding.code}-${index}`} data-severity={finding.severity}>
          <span className="export-degradation__lamp" aria-hidden="true" />
          <div>
            <strong>{finding.message}</strong>
            <code>{finding.code}</code>
            {finding.structuralPath ? (
              <span className="export-degradation__path">
                {pathLabel}: {finding.structuralPath}
              </span>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
