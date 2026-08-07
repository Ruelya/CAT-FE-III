export interface AssetsOverviewStripProps {
  tmTotal: number | null;
  termTotal: number | null;
  labels: {
    title: string;
    tm: string;
    terms: string;
    scopeNote: string;
  };
}

export function AssetsOverviewStrip({
  tmTotal,
  termTotal,
  labels,
}: AssetsOverviewStripProps) {
  return (
    <header className="assets-overview">
      <h1>{labels.title}</h1>
      <dl className="assets-overview__counts">
        <div>
          <dt>{labels.tm}</dt>
          <dd className="num">{tmTotal != null ? tmTotal : "—"}</dd>
        </div>
        <div>
          <dt>{labels.terms}</dt>
          <dd className="num">{termTotal != null ? termTotal : "—"}</dd>
        </div>
      </dl>
      <p className="assets-overview__note micro">{labels.scopeNote}</p>
    </header>
  );
}
