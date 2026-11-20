import type { TrimmerBreakdownRow, TrimmerDowntimeAlarm, TrimmerReport, TrimmerReportDetail, TrimmerReportStatus } from "../../api/types";
import { formatReportDate, numberFormatter } from "../../utils/formatting";
import { formatDuration, formatDurationExact, formatPercent, percentFormatter, wholeNumberFormatter } from "../../utils/trimmer";
import { DataTable, type Column } from "../DataTable";
import { Panel } from "../Panel";
import { QueryState } from "../QueryState";
import { trimmerDayColumns } from "./TrimmerDaily";

const statusLabels: Record<TrimmerReportStatus, string> = {
  ok: "OK",
  empty: "Empty",
  replaced: "Replaced",
};
const statusDescriptions: Record<TrimmerReportStatus, string> = {
  ok: "Used by the dashboard",
  empty: "The report arrived with no data",
  replaced: "A newer load of this report for the same date is used instead",
};

function StatusBadge({ status }: { status: TrimmerReportStatus }) {
  return <span className={`status-badge status-${status}`} title={statusDescriptions[status]}>{statusLabels[status]}</span>;
}

function shiftText(report: TrimmerReport) {
  if (!report.reportStart || !report.reportEnd) return "—";
  return `${report.reportStart.slice(11, 16)}–${report.reportEnd.slice(11, 16)}`;
}

function ReportList({ reports, onSelect }: { reports: TrimmerReport[]; onSelect: (id: number) => void }) {
  const columns: Array<Column<TrimmerReport>> = [
    { key: "date", label: "Report date", render: (report) => report.date ? formatReportDate(report.date) : "—" },
    { key: "type", label: "Report", render: (report) => report.typeLabel },
    { key: "file", label: "Source file", render: (report) => report.fileName ?? "—" },
    { key: "records", label: "Records", numeric: true, render: (report) => report.recordCount ?? "—" },
    { key: "loaded", label: "Loaded", render: (report) => report.loadedAt ?? "—" },
    { key: "status", label: "Status", render: (report) => <StatusBadge status={report.status} /> },
    { key: "actions", label: "Details", render: (report) => <button className="text-button" type="button" onClick={() => onSelect(report.id)} aria-label={`View ${report.typeLabel} report for ${report.date ? formatReportDate(report.date) : `load ${report.id}`}`}>View report</button> },
  ];
  return <DataTable caption="Trimmer report files" columns={columns} rows={reports} rowKey={(report) => String(report.id)} emptyMessage="No Trimmer reports were loaded for these dates." />;
}

const breakdownColumns: Array<Column<TrimmerBreakdownRow>> = [
  { key: "section", label: "Section", render: (row) => row.section[0].toUpperCase() + row.section.slice(1) },
  { key: "label", label: "Label", render: (row) => row.label },
  { key: "pieces", label: "Pieces", numeric: true, render: (row) => wholeNumberFormatter.format(row.pieces) },
  { key: "volume", label: "Volume (bd ft)", numeric: true, render: (row) => wholeNumberFormatter.format(row.volume) },
  { key: "share", label: "% of Volume", numeric: true, render: (row) => `${percentFormatter.format(row.pctVolume)}%` },
];

const alarmColumns: Array<Column<TrimmerDowntimeAlarm>> = [
  { key: "alarm", label: "Alarm", render: (alarm) => alarm.description },
  { key: "id", label: "Alarm ID", numeric: true, render: (alarm) => alarm.alarmId ?? "—" },
  { key: "stops", label: "Stops", numeric: true, render: (alarm) => wholeNumberFormatter.format(alarm.occurrences) },
  { key: "total", label: "Total Time", numeric: true, render: (alarm) => formatDurationExact(alarm.totalSeconds) },
  { key: "longest", label: "Longest Stop", numeric: true, render: (alarm) => `${alarm.exceedsShift ? "⚠ " : ""}${formatDurationExact(alarm.longestSeconds)}` },
];

function SummaryGrid({ items }: { items: Array<[string, string | number]> }) {
  return <div className="detail-summary">{items.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>;
}

interface DetailProps { report: TrimmerReportDetail; rawJsonOpen: boolean; onToggleRawJson: () => void }

function ReportDetail({ report, rawJsonOpen, onToggleRawJson }: DetailProps) {
  return <div className="report-detail-content trimmer-report-detail">
    <p className="detail-name">{report.fileName ?? `Load ${report.id}`}</p>
    <SummaryGrid items={[
      ["Report", report.typeLabel],
      ["Report date", report.date ? formatReportDate(report.date) : "—"],
      ["Shift", shiftText(report)],
      ["Printed", report.printedAt ?? "—"],
      ["Loaded", report.loadedAt ?? "—"],
      ["Records", report.recordCount ?? "—"],
      ["Status", statusLabels[report.status]],
    ]} />
    {report.status !== "ok" && <p className="panel-note detail-note">{statusDescriptions[report.status]}.</p>}

    {report.kpi && <><h3>Shift KPIs</h3><SummaryGrid items={[
      ["Lug fill", formatPercent(report.kpi.lugFill)],
      ["Trim loss", formatPercent(report.kpi.trimLoss)],
      ["BF / piece", report.kpi.avgBfPerPiece === null ? "—" : numberFormatter.format(report.kpi.avgBfPerPiece)],
      ["Fast", formatPercent(report.kpi.fastPct)],
      ["Medium", formatPercent(report.kpi.mediumPct)],
      ["Slow", formatPercent(report.kpi.slowPct)],
    ]} /></>}
    {report.breakdown.length > 0 && <><h3>Breakdown</h3>
      <DataTable columns={breakdownColumns} rows={report.breakdown} rowKey={(row) => `${row.section}|${row.label}`} caption="Report breakdown" emptyMessage="" /></>}

    {report.downtime && report.downtime.alarms.length > 0 && <><h3>Downtime</h3>
      <SummaryGrid items={[["Total downtime", formatDuration(report.downtime.totalSeconds)], ["Stops", wholeNumberFormatter.format(report.downtime.totalStops)]]} />
      <DataTable columns={alarmColumns} rows={report.downtime.alarms} rowKey={(alarm) => alarm.key} caption="Report downtime alarms" emptyMessage="" /></>}

    {report.days.length > 0 && <><h3>Days in this report</h3>
      <DataTable columns={trimmerDayColumns} rows={[...report.days].reverse()} rowKey={(day) => day.date} caption="Report production days" emptyMessage="" /></>}

    <div className={`raw-json-disclosure ${rawJsonOpen ? "open" : ""}`}>
      <button className="raw-json-toggle" type="button" aria-expanded={rawJsonOpen} aria-controls="raw-trimmer-report-json" onClick={onToggleRawJson}><span className="disclosure-icon" aria-hidden="true">›</span>Raw report JSON</button>
      <div className="raw-json-collapse" id="raw-trimmer-report-json"><div><pre>{JSON.stringify(report.raw, null, 2)}</pre></div></div>
    </div>
  </div>;
}

interface Props {
  reports: TrimmerReport[];
  reportsPending: boolean;
  reportsError: Error | null;
  onRetryReports: () => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onBack: () => void;
  detail?: TrimmerReportDetail;
  detailPending: boolean;
  detailError: Error | null;
  onRetryDetail: () => void;
  rawJsonOpen: boolean;
  onToggleRawJson: () => void;
}

export function TrimmerReports(props: Props) {
  const selected = props.selectedId !== null;
  const action = selected ? <button className="secondary-button" type="button" onClick={props.onBack}>Back to reports</button> : undefined;
  const title = selected && props.detail ? `${props.detail.typeLabel}` : "Report Files";
  return <section id="reports" className="wide-panel section-anchor"><Panel title={title} eyebrow={selected ? "Complete report" : "Trimmer source reports"} action={action}>
    <div className={`report-panel-viewport ${selected ? "show-detail" : "show-list"}`}>
      <div className="report-panel-view report-list-view" aria-hidden={selected}><QueryState isPending={props.reportsPending} error={props.reportsError} onRetry={props.onRetryReports}><ReportList reports={props.reports} onSelect={props.onSelect} /></QueryState></div>
      <div className="report-panel-view report-detail-view" aria-hidden={!selected}>{selected && <QueryState isPending={props.detailPending} error={props.detailError} onRetry={props.onRetryDetail}>{props.detail && <ReportDetail report={props.detail} rawJsonOpen={props.rawJsonOpen} onToggleRawJson={props.onToggleRawJson} />}</QueryState>}</div>
    </div>
  </Panel></section>;
}
