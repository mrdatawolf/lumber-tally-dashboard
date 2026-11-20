import type { DateRange, TrimmerBreakdown, TrimmerBreakdownRow, TrimmerBreakdownSection, TrimmerDay } from "./types";
import { loadBronzeTable } from "./client";
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
  production_todate_day: readonly TrimmerTodateDayPayload[];
  production_summary_breakdown: readonly TrimmerBreakdownPayload[];
}

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
  const newestByDate = new Map<string, TrimmerFileLoadPayload>();
  for (const load of tables.file_load) {
    if (load.report_type !== "production_summary") continue;
    const date = (load.report_start ?? load.printed_at ?? "").slice(0, 10);
    if (!date) continue;
    const current = newestByDate.get(date);
    if (!current || newerLoad(load, current) < 0) newestByDate.set(date, load);
  }
  const loadDates = new Map([...newestByDate].map(([date, load]) => [load.id, date]));

  const rowsByLoad = new Map<number, TrimmerBreakdownPayload[]>();
  for (const row of tables.production_summary_breakdown) {
    if (!loadDates.has(row.file_load_id) || Boolean(row.is_total)) continue;
    if (!breakdownSections.includes(row.section as TrimmerBreakdownSection)) continue;
    rowsByLoad.set(row.file_load_id, [...(rowsByLoad.get(row.file_load_id) ?? []), row]);
  }

  const totals = new Map<string, TrimmerBreakdownRow>();
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
      const key = `${section}|${row.label}`;
      const current = totals.get(key) ?? { section, label: row.label, pieces: 0, volume: 0, pctVolume: 0 };
      current.pieces += row.pieces ?? 0;
      current.volume += row.volume ?? 0;
      totals.set(key, current);
    }
  }

  const sectionVolume = new Map<TrimmerBreakdownSection, number>();
  for (const row of totals.values()) sectionVolume.set(row.section, (sectionVolume.get(row.section) ?? 0) + row.volume);
  const rows = [...totals.values()].map((row) => {
    const total = sectionVolume.get(row.section) ?? 0;
    return { ...row, pctVolume: total > 0 ? row.volume / total * 100 : 0 };
  }).sort(sortBreakdownRows);

  return { reportDates: reportDates.sort(), firstAvailableDate: availableDates.sort()[0] ?? null, rows };
}

export interface TrimmerApi {
  days: (range: DateRange, signal?: AbortSignal) => Promise<TrimmerDay[]>;
  breakdown: (range: DateRange, signal?: AbortSignal) => Promise<TrimmerBreakdown>;
}

const bronzeTrimmerApi: TrimmerApi = {
  days: async (range) => {
    const [fileLoad, todate] = await Promise.all([
      loadBronzeTable<TrimmerFileLoadPayload>("trimmer", "file_load"),
      loadBronzeTable<TrimmerTodateDayPayload>("trimmer", "production_todate_day"),
    ]);
    return buildTrimmerDays({ file_load: fileLoad, production_todate_day: todate }, range);
  },
  breakdown: async (range) => {
    const [fileLoad, breakdown] = await Promise.all([
      loadBronzeTable<TrimmerFileLoadPayload>("trimmer", "file_load"),
      loadBronzeTable<TrimmerBreakdownPayload>("trimmer", "production_summary_breakdown"),
    ]);
    return buildTrimmerBreakdown({ file_load: fileLoad, production_summary_breakdown: breakdown }, range);
  },
};

const demoTrimmerApi: TrimmerApi = {
  days: async (range) => buildTrimmerDays(demoTrimmerTables, range),
  breakdown: async (range) => buildTrimmerBreakdown(demoTrimmerTables, range),
};

// Demo mode never reaches a real API, matching the tally client.
export const trimmerApi: TrimmerApi = demoMode || currentMill.api.adapter === "mock"
  ? demoTrimmerApi
  : bronzeTrimmerApi;
