import { useMemo, useState } from "react";
import type { TrimmerBreakdown as Breakdown, TrimmerBreakdownRow, TrimmerBreakdownSection } from "../../api/types";
import { formatReportDate } from "../../utils/formatting";
import { percentFormatter, wholeNumberFormatter } from "../../utils/trimmer";
import { DataTable, type Column } from "../DataTable";
import { Panel } from "../Panel";
import { QueryState } from "../QueryState";

const sectionLabels: Record<TrimmerBreakdownSection, string> = {
  product: "Product",
  width: "Width",
  grade: "Grade",
  length: "Length",
};

function columnsFor(section: TrimmerBreakdownSection, maxShare: number): Array<Column<TrimmerBreakdownRow>> {
  return [
    { key: "label", label: sectionLabels[section], render: (row) => row.label },
    { key: "pieces", label: "Pieces", numeric: true, render: (row) => wholeNumberFormatter.format(row.pieces) },
    { key: "volume", label: "Volume (bd ft)", numeric: true, render: (row) => wholeNumberFormatter.format(row.volume) },
    {
      key: "share",
      label: "% of Volume",
      render: (row) => <span className="share-cell">
        <span className="share-bar" aria-hidden="true"><span style={{ width: `${maxShare > 0 ? row.pctVolume / maxShare * 100 : 0}%` }} /></span>
        <span className="share-value">{percentFormatter.format(row.pctVolume)}%</span>
      </span>,
    },
  ];
}

interface Props {
  breakdown: Breakdown | undefined;
  /** Production dates in the range, used to report days without a breakdown. */
  productionDates: string[];
  isPending: boolean;
  error: Error | null;
  onRetry: () => void;
}

export function TrimmerBreakdown({ breakdown, productionDates, isPending, error, onRetry }: Props) {
  const [section, setSection] = useState<TrimmerBreakdownSection>("product");
  const rows = useMemo(() => (breakdown?.rows ?? []).filter((row) => row.section === section), [breakdown, section]);
  const maxShare = Math.max(0, ...rows.map((row) => row.pctVolume));
  const reportDates = breakdown?.reportDates ?? [];
  const covered = new Set(reportDates);
  const missingDays = productionDates.filter((date) => !covered.has(date)).length;

  const title = <><select className="grade-group-select" aria-label="Group Trimmer breakdown by" value={section} onChange={(event) => setSection(event.target.value as TrimmerBreakdownSection)}>
    {(Object.entries(sectionLabels) as Array<[TrimmerBreakdownSection, string]>).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
  </select>{" "}Breakdown</>;

  const coverage = reportDates.length === 0
    ? null
    : `From ${reportDates.length} daily Production Summary ${reportDates.length === 1 ? "report" : "reports"}`
      + (missingDays > 0 ? ` · ${missingDays} production ${missingDays === 1 ? "day has" : "days have"} no breakdown report` : "");

  return <section id="trimmer-breakdown" className="wide-panel section-anchor">
    <Panel title={title} eyebrow={`Pieces and volume by ${sectionLabels[section].toLowerCase()}`} className="trimmer-breakdown-panel">
      <QueryState isPending={isPending} error={error} onRetry={onRetry}>
        {rows.length > 0 ? <>
          {coverage && <p className="panel-note">{coverage}</p>}
          <DataTable columns={columnsFor(section, maxShare)} rows={rows} rowKey={(row) => row.label} caption={`Trimmer ${sectionLabels[section].toLowerCase()} breakdown`} emptyMessage="" />
        </> : <p className="empty-state">{emptyMessage(breakdown?.firstAvailableDate ?? null)}</p>}
      </QueryState>
    </Panel>
  </section>;
}

function emptyMessage(firstAvailableDate: string | null) {
  const base = "No Production Summary breakdown was reported for these dates.";
  return firstAvailableDate ? `${base} Breakdowns are available from ${formatReportDate(firstAvailableDate)}.` : base;
}
