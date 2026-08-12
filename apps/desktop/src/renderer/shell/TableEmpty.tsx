export interface TableEmptyProps {
  /** Must match the column count so the message spans the whole table. */
  colSpan: number;
  /** Concise statement of fact. Defaults to the generic case. */
  label?: string;
  testId?: string;
}

/**
 * Empty body for a data table.
 *
 * A table that renders a header row and nothing else reads as a loading bug.
 * This states the fact inside the table, so the column structure stays intact
 * and a screen reader still encounters a table row rather than silence.
 */
export function TableEmpty({
  colSpan,
  label = "Nothing here yet",
  testId,
}: TableEmptyProps) {
  return (
    <tr className="table-empty" {...(testId ? { "data-testid": testId } : {})}>
      <td colSpan={colSpan}>{label}</td>
    </tr>
  );
}
