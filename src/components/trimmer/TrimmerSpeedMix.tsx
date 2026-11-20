import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { TrimmerDay } from "../../api/types";
import { formatReportDate } from "../../utils/formatting";
import { formatPercent, summarizeTrimmerDays } from "../../utils/trimmer";
import { FloatingChartTooltip } from "../charts/FloatingChartTooltip";
import { Panel } from "../Panel";
import { QueryState } from "../QueryState";

const speeds = [
  { key: "fast", label: "Fast", color: "var(--forest)" },
  // Neutral tones keep the three series distinct under every mill theme,
  // whose primary and accent colors can be nearly identical.
  { key: "medium", label: "Medium", color: "#8a7b72" },
  { key: "slow", label: "Slow", color: "#d4cbc4" },
] as const;

interface Props {
  days: TrimmerDay[];
  isPending: boolean;
  error: Error | null;
  onRetry: () => void;
}

export function TrimmerSpeedMix({ days, isPending, error, onRetry }: Props) {
  const rows = useMemo(() => days.map((day) => ({
    label: formatReportDate(day.date).replace(/\/\d{4}$/, ""),
    fast: day.fastPct,
    medium: day.mediumPct,
    slow: day.slowPct,
  })), [days]);
  const total = useMemo(() => summarizeTrimmerDays(days), [days]);
  const overall = days.length === 0 ? null : speeds.map((speed) => {
    const value = speed.key === "fast" ? total.fastPct : speed.key === "medium" ? total.mediumPct : total.slowPct;
    return `${speed.label} ${formatPercent(value)}`;
  }).join(" · ");

  return <section id="trimmer-speed" className="wide-panel section-anchor">
    <Panel title="Speed Mix" eyebrow="Share of run time at each trimmer speed" className="chart-panel trimmer-speed-panel">
      <QueryState isPending={isPending} error={error} onRetry={onRetry}>{days.length > 0 ? <>
        {overall && <p className="panel-note">Range average (volume-weighted): {overall}</p>}
        <div className="chart-wrap" aria-label="Trimmer speed mix by day stacked bar chart" role="img">
          <ResponsiveContainer width="100%" height="100%"><BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tickLine={false} minTickGap={12} />
            <YAxis tickLine={false} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(value) => `${value}%`} width={56} />
            <FloatingChartTooltip formatter={(value, name) => [formatPercent(value === null || value === undefined ? null : Number(value)), name]} />
            <Legend verticalAlign="top" height={28} />
            {speeds.map((speed) => <Bar key={speed.key} dataKey={speed.key} name={speed.label} stackId="speed" fill={speed.color} />)}
          </BarChart></ResponsiveContainer>
        </div>
      </> : <p className="empty-state">No Trimmer speed data was reported for these dates.</p>}</QueryState>
    </Panel>
  </section>;
}
