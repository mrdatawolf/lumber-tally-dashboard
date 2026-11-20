import type {
  DateRange, TrimmerBreakdown, TrimmerBreakdownRow, TrimmerBreakdownSection, TrimmerDay, TrimmerDowntime,
  TrimmerDowntimeAlarm, TrimmerKpi, TrimmerLongStop, TrimmerReport, TrimmerReportDetail, TrimmerReportStatus,
} from "./types";
import { ApiError, loadBronzeTable } from "./client";
import { currentMill, demoMode } from "../config/currentMill";
import { demoTrimmerTables } from "./trimmerDemoData";

// Raw bronze payloads. The Trimmer delivers three reports per day, each stored
// as a file load: a one-shift Production Summary, a one-shift Downtime Summary,
// and a Production To-date report that repeats roughly 80 days of history.

export interface TrimmerFileLoadPayload {
  id: number;
  report_type: "production_summary" | "downtime_summary" | "production_todate" | string;
  report_start: string | null;
  report_end: string | null;
  printed_at: string | null;
  loaded_at?: string | null;
  record_count?: number | null;
  archived_file_id?: number | null;
}

export interface TrimmerArchivedFilePayload {
  id: number;
  archive_name: string | null;
  original_name: string | null;
  copy_date?: string | null;
  archived_at?: string | null;
  size_bytes?: number | null;
  sha256?: string | null;
}

export interface TrimmerKpiPayload {
  id: number;
  file_load_id: number;
  lug_fill: number | null;
  trimloss: number | null;
  avg_bf_per_piece: number | null;
  trimmer_speed_fast_pct: number | null;
  trimmer_speed_medium_pct: number | null;
  trimmer_speed_slow_pct: number | null;
}

export interface TrimmerDowntimeTotalPayload {
  id: number;
  file_load_id: number;
  occurrences: number | null;
  total_duration: string | null;
}

export interface TrimmerDowntimeAlarmPayload {
  id: number;
  file_load_id: number;
  alarm_id: number | null;
  description: string;
  occurrences: number | null;
  total_duration: string | null;
  min_duration?: string | null;
  max_duration: string | null;
  row_order?: number | null;
}

export interface TrimmerTodateDayPayload {
  id: number;
  file_load_id: number;
  run_start: string;
  volume: number | null;
  downtime: string | null;
  total_stops: number | null;
  lug_fill: number | null;
  trimloss: number | null;
  bf_per_piece: number | null;
  fast_pct: number | null;
  medium_pct: number | null;
  slow_pct: number | null;
}

export interface TrimmerBreakdownPayload {
  id: number;
  file_load_id: number;
  section: string;
  label: string;
  pieces: number | null;
  volume: number | null;
  is_total: number | boolean;
}

export interface TrimmerTables {
  file_load: readonly TrimmerFileLoadPayload[];
  archived_file: readonly TrimmerArchivedFilePayload[];
  production_todate_day: readonly TrimmerTodateDayPayload[];
  production_summary_kpi: readonly TrimmerKpiPayload[];
  production_summary_breakdown: readonly TrimmerBreakdownPayload[];
  downtime_total: readonly TrimmerDowntimeTotalPayload[];
  downtime_alarm: readonly TrimmerDowntimeAlarmPayload[];
}

const reportTypeLabels: Record<string, string> = {
  production_summary: "Production Summary",
  downtime_summary: "Downtime Summary",
  production_todate: "Production To-date",
};
const reportTypeOrder = Object.keys(reportTypeLabels);

const breakdownSections: readonly TrimmerBreakdownSection[] = ["product", "width", "grade", "length"];

function inRange(date: string, range: DateRange) {
  return (!range.start || date >= range.start) && (!range.end || date <= range.end);
}

/** Parses "HH:MM:SS" durations, which may exceed 24 hours. */
export function durationSeconds(value: string | null | undefined): number {
  if (!value) return 0;
  const parts = value.split(":").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return 0;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

/** Orders loads newest first by print time, then by id. */
function newerLoad(a: TrimmerFileLoadPayload, b: TrimmerFileLoadPayload) {
  const printed = (b.printed_at ?? "").localeCompare(a.printed_at ?? "");
  return printed !== 0 ? printed : b.id - a.id;
}

/** The production date a load reports on: its shift start, or its print date. */
function loadDate(load: TrimmerFileLoadPayload) {
  return (load.report_start ?? load.printed_at ?? "").slice(0, 10);
}

/** The newest load of one report type for each date. */
function newestLoadsByDate(loads: readonly TrimmerFileLoadPayload[], reportType: string) {
  const newest = new Map<string, TrimmerFileLoadPayload>();
  for (const load of loads) {
    if (load.report_type !== reportType) continue;
    const date = loadDate(load);
    if (!date) continue;
    const current = newest.get(date);
    if (!current || newerLoad(load, current) < 0) newest.set(date, load);
  }
  return newest;
}

function timestampSeconds(value: string | null | undefined) {
  if (!value) return null;
  const time = Date.parse(`${value.replace(" ", "T")}Z`);
  return Number.isFinite(time) ? time / 1000 : null;
}

function groupByLoad<T extends { file_load_id: number }>(rows: readonly T[]) {
  const groups = new Map<number, T[]>();
  for (const row of rows) groups.set(row.file_load_id, [...(groups.get(row.file_load_id) ?? []), row]);
  return groups;
}

interface WeightedValue { value: number | null; weight: number }

function weightedAverage(values: WeightedValue[]): number | null {
  let total = 0;
  let weight = 0;
  for (const entry of values) {
    if (entry.value === null || !Number.isFinite(entry.value)) continue;
    total += entry.value * entry.weight;
    weight += entry.weight;
  }
  if (weight > 0) return total / weight;
  // With no volume to weight by, fall back to a plain mean.
  const plain = values.map((entry) => entry.value).filter((value): value is number => value !== null && Number.isFinite(value));
  return plain.length > 0 ? plain.reduce((sum, value) => sum + value, 0) / plain.length : null;
}

interface RunLike {
  volume: number;
  pieces: number | null;
  downtimeSeconds: number;
  totalStops: number;
  lugFill: number | null;
  trimLoss: number | null;
  fastPct: number | null;
  mediumPct: number | null;
  slowPct: number | null;
}

/** Sums volumes, stops and downtime, and weights the percentages by volume. */
export function combineTrimmerRuns(runs: RunLike[]): Omit<TrimmerDay, "date" | "runs"> {
  const volume = runs.reduce((sum, run) => sum + run.volume, 0);
  const knownPieces = runs.filter((run) => run.pieces !== null);
  const pieces = knownPieces.length > 0 ? knownPieces.reduce((sum, run) => sum + (run.pieces ?? 0), 0) : null;
  const piecesVolume = knownPieces.reduce((sum, run) => sum + run.volume, 0);
  const weighted = (pick: (run: RunLike) => number | null) =>
    weightedAverage(runs.map((run) => ({ value: pick(run), weight: run.volume })));
  return {
    volume,
    pieces,
    bfPerPiece: pieces ? piecesVolume / pieces : null,
    downtimeSeconds: runs.reduce((sum, run) => sum + run.downtimeSeconds, 0),
    totalStops: runs.reduce((sum, run) => sum + run.totalStops, 0),
    lugFill: weighted((run) => run.lugFill),
    trimLoss: weighted((run) => run.trimLoss),
    fastPct: weighted((run) => run.fastPct),
    mediumPct: weighted((run) => run.mediumPct),
    slowPct: weighted((run) => run.slowPct),
  };
}

/**
 * Builds one row per production day from the repeating To-date reports. Each
 * date is taken from the newest load that contains it, and a day with several
 * runs (for example a second shift) is combined into one row.
 */
export function buildTrimmerDays(tables: Pick<TrimmerTables, "file_load" | "production_todate_day">, range: DateRange): TrimmerDay[] {
  const loads = new Map(tables.file_load.map((load) => [load.id, load]));
  const rowsByDate = new Map<string, TrimmerTodateDayPayload[]>();
  for (const row of tables.production_todate_day) {
    if (!row.run_start) continue;
    const date = row.run_start.slice(0, 10);
    if (!inRange(date, range)) continue;
    rowsByDate.set(date, [...(rowsByDate.get(date) ?? []), row]);
  }

  const days: TrimmerDay[] = [];
  for (const [date, rows] of rowsByDate) {
    const loadIds = [...new Set(rows.map((row) => row.file_load_id))];
    const newest = loadIds
      .map((id) => loads.get(id) ?? { id, report_type: "production_todate", report_start: null, report_end: null, printed_at: null })
      .sort(newerLoad)[0];
    const runs = rows.filter((row) => row.file_load_id === newest.id);
    days.push({
      date,
      runs: runs.length,
      ...combineTrimmerRuns(runs.map((run) => {
        const volume = run.volume ?? 0;
        return {
          volume,
          pieces: run.bf_per_piece && run.bf_per_piece > 0 ? volume / run.bf_per_piece : null,
          downtimeSeconds: durationSeconds(run.downtime),
          totalStops: run.total_stops ?? 0,
          lugFill: run.lug_fill,
          trimLoss: run.trimloss,
          fastPct: run.fast_pct,
          mediumPct: run.medium_pct,
          slowPct: run.slow_pct,
        };
      })),
    });
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

function numericLabel(label: string) {
  const value = Number.parseFloat(label);
  return Number.isFinite(value) ? value : null;
}

function sortBreakdownRows(a: TrimmerBreakdownRow, b: TrimmerBreakdownRow) {
  if (a.section !== b.section) return breakdownSections.indexOf(a.section) - breakdownSections.indexOf(b.section);
  if (a.section === "width" || a.section === "length") {
    const left = numericLabel(a.label);
    const right = numericLabel(b.label);
    if (left !== null && right !== null && left !== right) return left - right;
  }
  return b.volume - a.volume || a.label.localeCompare(b.label);
}

/**
 * Sums the daily Production Summary breakdowns across the range. "Total" rows
 * are excluded so nothing is counted twice, each date uses its newest report,
 * and reports with no production are skipped.
 */
export function buildTrimmerBreakdown(tables: Pick<TrimmerTables, "file_load" | "production_summary_breakdown">, range: DateRange): TrimmerBreakdown {
  const newestByDate = newestLoadsByDate(tables.file_load, "production_summary");
  const loadDates = new Map([...newestByDate].map(([date, load]) => [load.id, date]));

  const rowsByLoad = new Map<number, TrimmerBreakdownPayload[]>();
  for (const row of tables.production_summary_breakdown) {
    if (!loadDates.has(row.file_load_id) || Boolean(row.is_total)) continue;
    if (!breakdownSections.includes(row.section as TrimmerBreakdownSection)) continue;
    rowsByLoad.set(row.file_load_id, [...(rowsByLoad.get(row.file_load_id) ?? []), row]);
  }

  const totals = new Map<string, TrimmerBreakdownRow>();
  // Labels are matched without regard to case ("HQ" and "hq" are one product),
  // but punctuation and spacing are kept, since they may be meaningful.
  const labelVolumes = new Map<string, Map<string, number>>();
  const availableDates: string[] = [];
  const reportDates: string[] = [];
  for (const [loadId, rows] of rowsByLoad) {
    // Some reports arrive empty (all zeros); they carry no breakdown.
    if (!rows.some((row) => (row.volume ?? 0) > 0 || (row.pieces ?? 0) > 0)) continue;
    const date = loadDates.get(loadId) ?? "";
    availableDates.push(date);
    if (!inRange(date, range)) continue;
    reportDates.push(date);
    for (const row of rows) {
      const section = row.section as TrimmerBreakdownSection;
      const key = `${section}|${row.label.toLowerCase()}`;
      const current = totals.get(key) ?? { section, label: row.label, pieces: 0, volume: 0, pctVolume: 0 };
      current.pieces += row.pieces ?? 0;
      current.volume += row.volume ?? 0;
      totals.set(key, current);
      const variants = labelVolumes.get(key) ?? new Map<string, number>();
      variants.set(row.label, (variants.get(row.label) ?? 0) + (row.volume ?? 0));
      labelVolumes.set(key, variants);
    }
  }
  // Display the spelling that carries the most volume.
  for (const [key, row] of totals) {
    const variants = [...(labelVolumes.get(key) ?? [])];
    row.label = variants.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? row.label;
  }

  const sectionVolume = new Map<TrimmerBreakdownSection, number>();
  for (const row of totals.values()) sectionVolume.set(row.section, (sectionVolume.get(row.section) ?? 0) + row.volume);
  const rows = [...totals.values()].map((row) => {
    const total = sectionVolume.get(row.section) ?? 0;
    return { ...row, pctVolume: total > 0 ? row.volume / total * 100 : 0 };
  }).sort(sortBreakdownRows);

  return { reportDates: reportDates.sort(), firstAvailableDate: availableDates.sort()[0] ?? null, rows };
}

/**
 * Totals the daily Downtime Summary reports across the range, using the newest
 * report for each date and skipping empty reports. Alarms are matched by alarm
 * id. Durations are shown exactly as reported; stops longer than their
 * report's shift window are listed so the page can point them out.
 */
export function buildTrimmerDowntime(tables: Pick<TrimmerTables, "file_load" | "downtime_total" | "downtime_alarm">, range: DateRange): TrimmerDowntime {
  const newestByDate = [...newestLoadsByDate(tables.file_load, "downtime_summary")].sort(([a], [b]) => a.localeCompare(b));
  const alarmsByLoad = groupByLoad(tables.downtime_alarm);
  const totalsByLoad = new Map(tables.downtime_total.map((row) => [row.file_load_id, row]));

  const alarms = new Map<string, TrimmerDowntimeAlarm>();
  const longStops: TrimmerLongStop[] = [];
  const availableDates: string[] = [];
  const reportDates: string[] = [];
  let totalSeconds = 0;
  let totalStops = 0;

  for (const [date, load] of newestByDate) {
    const loadAlarms = alarmsByLoad.get(load.id) ?? [];
    const total = totalsByLoad.get(load.id);
    const stops = total?.occurrences ?? loadAlarms.reduce((sum, alarm) => sum + (alarm.occurrences ?? 0), 0);
    const seconds = total?.total_duration
      ? durationSeconds(total.total_duration)
      : loadAlarms.reduce((sum, alarm) => sum + durationSeconds(alarm.total_duration), 0);
    // Some reports arrive empty; they carry no downtime information.
    if (loadAlarms.length === 0 && stops === 0 && seconds === 0) continue;
    availableDates.push(date);
    if (!inRange(date, range)) continue;
    reportDates.push(date);
    totalSeconds += seconds;
    totalStops += stops;

    const start = timestampSeconds(load.report_start);
    const end = timestampSeconds(load.report_end);
    const windowSeconds = start !== null && end !== null && end > start ? end - start : null;
    for (const alarm of loadAlarms) {
      const key = alarm.alarm_id !== null ? `id:${alarm.alarm_id}` : `description:${alarm.description.toLowerCase()}`;
      const longest = durationSeconds(alarm.max_duration);
      const exceedsShift = windowSeconds !== null && longest > windowSeconds;
      const current = alarms.get(key) ?? {
        key, alarmId: alarm.alarm_id, description: alarm.description,
        occurrences: 0, totalSeconds: 0, longestSeconds: 0, exceedsShift: false,
      };
      // Dates are visited oldest first, so the newest description wins.
      current.description = alarm.description;
      current.occurrences += alarm.occurrences ?? 0;
      current.totalSeconds += durationSeconds(alarm.total_duration);
      current.longestSeconds = Math.max(current.longestSeconds, longest);
      current.exceedsShift ||= exceedsShift;
      alarms.set(key, current);
      if (exceedsShift && windowSeconds !== null) {
        longStops.push({ date, description: alarm.description, seconds: longest, windowSeconds });
      }
    }
  }

  return {
    reportDates,
    firstAvailableDate: availableDates[0] ?? null,
    totalSeconds,
    totalStops,
    alarms: [...alarms.values()].sort((a, b) => b.totalSeconds - a.totalSeconds || b.occurrences - a.occurrences),
    longStops,
  };
}

function reportHasContent(load: TrimmerFileLoadPayload, tables: TrimmerTables) {
  switch (load.report_type) {
    case "production_summary":
      return tables.production_summary_breakdown.some((row) => row.file_load_id === load.id && !row.is_total && ((row.volume ?? 0) > 0 || (row.pieces ?? 0) > 0));
    case "downtime_summary":
      return tables.downtime_alarm.some((row) => row.file_load_id === load.id)
        || tables.downtime_total.some((row) => row.file_load_id === load.id && (row.occurrences ?? 0) > 0);
    case "production_todate":
      return tables.production_todate_day.some((row) => row.file_load_id === load.id);
    default:
      return (load.record_count ?? 0) > 0;
  }
}

function toReport(load: TrimmerFileLoadPayload, tables: TrimmerTables, status: TrimmerReportStatus): TrimmerReport {
  const archived = tables.archived_file.find((file) => file.id === load.archived_file_id);
  return {
    id: load.id,
    date: loadDate(load),
    reportType: load.report_type,
    typeLabel: reportTypeLabels[load.report_type] ?? load.report_type.replaceAll("_", " "),
    fileName: archived?.archive_name ?? archived?.original_name ?? null,
    reportStart: load.report_start,
    reportEnd: load.report_end,
    printedAt: load.printed_at,
    loadedAt: load.loaded_at ?? null,
    recordCount: load.record_count ?? null,
    status,
  };
}

function reportStatus(load: TrimmerFileLoadPayload, tables: TrimmerTables): TrimmerReportStatus {
  const newest = newestLoadsByDate(tables.file_load, load.report_type).get(loadDate(load));
  if (newest && newest.id !== load.id) return "replaced";
  return reportHasContent(load, tables) ? "ok" : "empty";
}

/** Lists every Trimmer file load in the range, newest date first. */
export function buildTrimmerReports(tables: TrimmerTables, range: DateRange): TrimmerReport[] {
  return tables.file_load
    .filter((load) => inRange(loadDate(load), range))
    .map((load) => toReport(load, tables, reportStatus(load, tables)))
    .sort((a, b) => b.date.localeCompare(a.date)
      || orderOf(a.reportType) - orderOf(b.reportType)
      || b.id - a.id);
}

function orderOf(reportType: string) {
  const index = reportTypeOrder.indexOf(reportType);
  return index === -1 ? reportTypeOrder.length : index;
}

/** One file load with its contents, built with the same rules as the dashboard. */
export function buildTrimmerReportDetail(tables: TrimmerTables, id: number): TrimmerReportDetail | null {
  const load = tables.file_load.find((row) => row.id === id);
  if (!load) return null;
  const own = <T extends { file_load_id: number }>(rows: readonly T[]) => rows.filter((row) => row.file_load_id === id);
  const single: TrimmerTables = {
    file_load: [load],
    archived_file: tables.archived_file.filter((file) => file.id === load.archived_file_id),
    production_todate_day: own(tables.production_todate_day),
    production_summary_kpi: own(tables.production_summary_kpi),
    production_summary_breakdown: own(tables.production_summary_breakdown),
    downtime_total: own(tables.downtime_total),
    downtime_alarm: own(tables.downtime_alarm),
  };
  const kpiRow = single.production_summary_kpi[0];
  const kpi: TrimmerKpi | null = kpiRow ? {
    lugFill: kpiRow.lug_fill,
    trimLoss: kpiRow.trimloss,
    avgBfPerPiece: kpiRow.avg_bf_per_piece,
    fastPct: kpiRow.trimmer_speed_fast_pct,
    mediumPct: kpiRow.trimmer_speed_medium_pct,
    slowPct: kpiRow.trimmer_speed_slow_pct,
  } : null;
  const all = { start: "", end: "" };
  return {
    ...toReport(load, tables, reportStatus(load, tables)),
    kpi,
    breakdown: load.report_type === "production_summary" ? buildTrimmerBreakdown(single, all).rows : [],
    downtime: load.report_type === "downtime_summary" ? buildTrimmerDowntime(single, all) : null,
    days: load.report_type === "production_todate" ? buildTrimmerDays(single, all) : [],
    raw: Object.fromEntries(Object.entries(single).filter(([, rows]) => rows.length > 0)),
  };
}

export interface TrimmerApi {
  days: (range: DateRange, signal?: AbortSignal) => Promise<TrimmerDay[]>;
  breakdown: (range: DateRange, signal?: AbortSignal) => Promise<TrimmerBreakdown>;
  downtime: (range: DateRange, signal?: AbortSignal) => Promise<TrimmerDowntime>;
  reports: (range: DateRange, signal?: AbortSignal) => Promise<TrimmerReport[]>;
  report: (id: number, signal?: AbortSignal) => Promise<TrimmerReportDetail>;
}

const tableNames = [
  "file_load", "archived_file", "production_todate_day", "production_summary_kpi",
  "production_summary_breakdown", "downtime_total", "downtime_alarm",
] as const satisfies ReadonlyArray<keyof TrimmerTables>;

/** Loads the named Trimmer tables; the client caches each for one minute. */
async function loadTrimmerTables<K extends keyof TrimmerTables>(names: readonly K[]): Promise<Pick<TrimmerTables, K>> {
  const rows = await Promise.all(names.map((name) => loadBronzeTable<unknown>("trimmer", name)));
  return Object.fromEntries(names.map((name, index) => [name, rows[index]])) as unknown as Pick<TrimmerTables, K>;
}

function requireReport(detail: TrimmerReportDetail | null, id: number) {
  if (!detail) throw new ApiError(`Trimmer report ${id} was not found.`, 404);
  return detail;
}

const bronzeTrimmerApi: TrimmerApi = {
  days: async (range) => buildTrimmerDays(await loadTrimmerTables(["file_load", "production_todate_day"]), range),
  breakdown: async (range) => buildTrimmerBreakdown(await loadTrimmerTables(["file_load", "production_summary_breakdown"]), range),
  downtime: async (range) => buildTrimmerDowntime(await loadTrimmerTables(["file_load", "downtime_total", "downtime_alarm"]), range),
  reports: async (range) => buildTrimmerReports(await loadTrimmerTables(tableNames), range),
  report: async (id) => requireReport(buildTrimmerReportDetail(await loadTrimmerTables(tableNames), id), id),
};

const demoTrimmerApi: TrimmerApi = {
  days: async (range) => buildTrimmerDays(demoTrimmerTables, range),
  breakdown: async (range) => buildTrimmerBreakdown(demoTrimmerTables, range),
  downtime: async (range) => buildTrimmerDowntime(demoTrimmerTables, range),
  reports: async (range) => buildTrimmerReports(demoTrimmerTables, range),
  report: async (id) => requireReport(buildTrimmerReportDetail(demoTrimmerTables, id), id),
};

// Demo mode never reaches a real API, matching the tally client.
export const trimmerApi: TrimmerApi = demoMode || currentMill.api.adapter === "mock"
  ? demoTrimmerApi
  : bronzeTrimmerApi;
