import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { TrimmerDay } from "../../api/types";
import { formatReportDate, numberFormatter, thousandsFormatter } from "../../utils/formatting";
import { formatDuration, formatPercent, wholeNumberFormatter } from "../../utils/trimmer";
import { DataTable, type Column } from "../DataTable";
import { FloatingChartTooltip } from "../charts/FloatingChartTooltip";
import { Panel } from "../Panel";
import { QueryState } from "../QueryState";

type DailyMetric = "volume" | "pieces" | "trimLoss" | "lugFill" | "bfPerPiece" | "totalStops" | "downtimeHours";

const dailyMetrics: Record<DailyMetric, { label: string; unit: string; format: (value: number) => string; axis: (value: number) => string }> = {
  volume: { label: "Volume", unit: "bd ft", format: (value) => wholeNumberFormatter.format(value), axis: thousandsFormatter },
  pieces: { label: "Pieces", unit: "pieces", format: (value) => wholeNumberFormatter.format(value), axis: thousandsFormatter },
  trimLoss: { label: "Trim Loss", unit: "%", format: (value) => formatPercent(value), axis: (value) => `${value}%` },
  lugFill: { label: "Lug Fill", unit: "%", format: (value) => formatPercent(value), axis: (value) => `${value}%` },
  bfPerPiece: { label: "BF / Piece", unit: "bd ft", format: (value) => numberFormatter.format(value), axis: (value) => numberFormatter.format(value) },
  totalStops: { label: "Stops", unit: "stops", format: (value) => wholeNumberFormatter.format(value), axis: thousandsFormatter },
  downtimeHours: { label: "Downtime", unit: "hours", format: (value) => formatDuration(value * 3600), axis: (value) => `${value}h` },
};

const columns: Array<Column<TrimmerDay>> = [
  { key: "date", label: "Date", render: (day) => formatReportDate(day.date) },
  { key: "volume", label: "Volume (bd ft)", numeric: true, render: (day) => wholeNumberFormatter.format(day.volume) },
  { key: "pieces", label: "Pieces", numeric: true, render: (day) => day.pieces === null ? "—" : wholeNumberFormatter.format(day.pieces) },
  { key: "bfPerPiece", label: "BF / Piece", numeric: true, render: (day) => day.bfPerPiece === null ? "—" : numberFormatter.format(day.bfPerPiece) },
  { key: "lugFill", label: "Lug Fill", numeric: true, render: (day) => formatPercent(day.lugFill) },
  { key: "trimLoss", label: "Trim Loss", numeric: true, render: (day) => formatPercent(day.trimLoss) },
  { key: "totalStops", label: "Stops", numeric: true, render: (day) => wholeNumberFormatter.format(day.totalStops) },
  { key: "downtime", label: "Downtime", numeric: true, render: (day) => formatDuration(day.downtimeSeconds) },
  { key: "runs", label: "Runs", numeric: true, render: (day) => day.runs },
];

interface Props {
  days: TrimmerDay[];
  isPending: boolean;
  error: Error | null;
  onRetry: () => void;
}

export function TrimmerDaily({ days, isPending, error, onRetry }: Props) {
  const [metric, setMetric] = useState<DailyMetric>("volume");
  const definition = dailyMetrics[metric];
  const chartRows = useMemo(() => days.map((day) => ({
    label: formatReportDate(day.date).replace(/\/\d{4}$/, ""),
    value: metric === "downtimeHours" ? day.downtimeSeconds / 3600 : day[metric],
  })), [days, metric]);
  const tableRows = useMemo(() => [...days].reverse(), [days]);

  const title = <><select className="grade-group-select" aria-label="Daily production metric" value={metric} onChange={(event) => setMetric(event.target.value as DailyMetric)}>
    {(Object.entries(dailyMetrics) as Array<[DailyMetric, (typeof dailyMetrics)[DailyMetric]]>).map(([value, entry]) => <option key={value} value={value}>{entry.label}</option>)}
  </select>{" "}by Day</>;

  return <section id="trimmer-daily" className="wide-panel section-anchor">
    <Panel title={title} eyebrow="Trimmer production to-date" className="chart-panel trimmer-daily-panel">
      <QueryState isPending={isPending} error={error} onRetry={onRetry}>{days.length > 0 ? <>
        <div className="chart-wrap" aria-label={`Trimmer ${definition.label.toLowerCase()} by day bar chart`} role="img">
          <ResponsiveContainer width="100%" height="100%"><BarChart data={chartRows} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tickLine={false} minTickGap={12} />
            <YAxis tickLine={false} tickFormatter={(value) => definition.axis(Number(value))} width={72} />
            <FloatingChartTooltip formatter={(value) => [definition.format(Number(value)), definition.label]} />
            <Bar dataKey="value" fill="var(--amber)" radius={[5, 5, 0, 0]} />
          </BarChart></ResponsiveContainer>
        </div>
        <DataTable columns={columns} rows={tableRows} rowKey={(day) => day.date} caption="Trimmer production by day" emptyMessage="" />
      </> : <p className="empty-state">No Trimmer production was reported for these dates.</p>}</QueryState>
    </Panel>
  </section>;
}
