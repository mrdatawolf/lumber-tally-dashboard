import { useMemo, useState } from "react";
import type { TrimmerDowntime as Downtime, TrimmerDowntimeAlarm, TrimmerLongStop } from "../../api/types";
import { formatReportDate } from "../../utils/formatting";
import { formatDuration, formatDurationExact, percentFormatter, wholeNumberFormatter } from "../../utils/trimmer";
import { DataTable, type Column } from "../DataTable";
import { Panel } from "../Panel";
import { QueryState } from "../QueryState";

type DowntimeSort = "duration" | "stops";

const sortLabels: Record<DowntimeSort, string> = { duration: "Duration", stops: "Stops" };

function columnsFor(sort: DowntimeSort, total: number, max: number): Array<Column<TrimmerDowntimeAlarm>> {
  const share = (alarm: TrimmerDowntimeAlarm) => sort === "duration" ? alarm.totalSeconds : alarm.occurrences;
  return [
    { key: "alarm", label: "Alarm", render: (alarm) => alarm.description },
    { key: "stops", label: "Stops", numeric: true, render: (alarm) => wholeNumberFormatter.format(alarm.occurrences) },
    { key: "total", label: "Total Time", numeric: true, render: (alarm) => formatDuration(alarm.totalSeconds) },
    {
      key: "share",
      label: sort === "duration" ? "% of Downtime" : "% of Stops",
      render: (alarm) => <span className="share-cell">
        <span className="share-bar" aria-hidden="true"><span style={{ width: `${max > 0 ? share(alarm) / max * 100 : 0}%` }} /></span>
        <span className="share-value">{percentFormatter.format(total > 0 ? share(alarm) / total * 100 : 0)}%</span>
      </span>,
    },
    {
      key: "longest",
      label: "Longest Stop",
      numeric: true,
      render: (alarm) => alarm.exceedsShift
        ? <span className="flagged-value" title="Longer than the report's shift window">⚠ {formatDurationExact(alarm.longestSeconds)}</span>
        : formatDurationExact(alarm.longestSeconds),
    },
  ];
}

function longStopText(stop: TrimmerLongStop) {
  return `“${stop.description}” on ${formatReportDate(stop.date)} has a single stop of ${formatDurationExact(stop.seconds)}, `
    + `longer than that report's ${formatDuration(stop.windowSeconds)} shift window.`;
}

interface Props {
  downtime: Downtime | undefined;
  /** Production dates in the range, used to report days without a downtime report. */
  productionDates: string[];
  isPending: boolean;
  error: Error | null;
  onRetry: () => void;
}

export function TrimmerDowntime({ downtime, productionDates, isPending, error, onRetry }: Props) {
  const [sort, setSort] = useState<DowntimeSort>("duration");
  const alarms = useMemo(() => [...(downtime?.alarms ?? [])].sort(sort === "duration"
    ? (a, b) => b.totalSeconds - a.totalSeconds || b.occurrences - a.occurrences
    : (a, b) => b.occurrences - a.occurrences || b.totalSeconds - a.totalSeconds), [downtime, sort]);
  const totals = alarms.reduce((sum, alarm) => sum + (sort === "duration" ? alarm.totalSeconds : alarm.occurrences), 0);
  const max = Math.max(0, ...alarms.map((alarm) => sort === "duration" ? alarm.totalSeconds : alarm.occurrences));
  const reportDates = downtime?.reportDates ?? [];
  const covered = new Set(reportDates);
  const missingDays = productionDates.filter((date) => !covered.has(date)).length;

  const title = <><select className="grade-group-select" aria-label="Sort downtime alarms by" value={sort} onChange={(event) => setSort(event.target.value as DowntimeSort)}>
    {(Object.entries(sortLabels) as Array<[DowntimeSort, string]>).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
  </select>{" "}by Alarm</>;

  return <section id="trimmer-downtime" className="wide-panel section-anchor">
    <Panel title={title} eyebrow="Trimmer downtime" className="trimmer-downtime-panel">
      <QueryState isPending={isPending} error={error} onRetry={onRetry}>
        {downtime && alarms.length > 0 ? <>
          <div className="downtime-summary" aria-label="Downtime totals">
            <div><span>Total downtime</span><strong>{formatDuration(downtime.totalSeconds)}</strong></div>
            <div><span>Stops</span><strong>{wholeNumberFormatter.format(downtime.totalStops)}</strong></div>
            <div><span>Reports</span><strong>{reportDates.length}</strong></div>
          </div>
          {missingDays > 0 && <p className="panel-note">{missingDays} production {missingDays === 1 ? "day has" : "days have"} no Downtime Summary report.</p>}
          {downtime.longStops.length > 0 && <div className="panel-warning" role="note">
            <strong>Some stops are longer than their shift.</strong>
            {downtime.longStops.map((stop) => <span key={`${stop.date}|${stop.description}`}>{longStopText(stop)}</span>)}
            <span>These may include time outside production hours. Totals are shown as reported.</span>
          </div>}
          <DataTable columns={columnsFor(sort, totals, max)} rows={alarms} rowKey={(alarm) => alarm.key} caption="Trimmer downtime by alarm" emptyMessage="" />
        </> : <p className="empty-state">{emptyMessage(downtime?.firstAvailableDate ?? null)}</p>}
      </QueryState>
    </Panel>
  </section>;
}

function emptyMessage(firstAvailableDate: string | null) {
  const base = "No Downtime Summary was reported for these dates.";
  return firstAvailableDate ? `${base} Downtime reports are available from ${formatReportDate(firstAvailableDate)}.` : base;
}
