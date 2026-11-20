export interface HealthResponse {
  status: string;
}

export interface DateRange {
  start: string;
  end: string;
}

export interface FileOut {
  file_id: number;
  filename: string;
  filename_date: string;
  report_datetime: string;
}

export interface ProductionSummaryRow {
  file_id: number;
  filename: string;
  report_datetime: string;
  time_start?: string | null;
  time_run?: string | null;
  time_no_production?: string | null;
  board_input_pieces?: number | null;
  board_input_cuft?: number | null;
  average_length_ft?: number | null;
  edger_bd_ft?: number | null;
  trim_pass_count?: number | null;
  trim_pass_bd_ft?: number | null;
  lumber_value?: number | null;
  lumber_value_deducts?: number | null;
}

export interface RecoveryRow {
  file_id: number;
  report_datetime: string;
  recovery_lrf_bf_cm?: number | null;
  recovery_bf_cf?: number | null;
  fiber_ratio?: number | null;
}

export interface SolutionTotalOut {
  solution_number: number;
  total_board_count: number;
}

export interface RejectReasonTotalOut {
  reason: string;
  total_count: number;
}

export interface GradeMixRow {
  grade?: string | null;
  thickness?: string | null;
  width?: number | null;
  length_ft?: number | null;
  total_pieces: number;
  total_bd_ft: number;
}

export type GradeMixGrouping = "thickness" | "width" | "grade" | "length_ft";

export interface SummaryOut {
  time_start?: string | null;
  time_run?: string | null;
  time_no_production?: string | null;
  board_input_pieces?: number | null;
  board_input_cuft?: number | null;
  average_length_ft?: number | null;
  edger_bd_ft?: number | null;
  trim_pass_count?: number | null;
  trim_pass_bd_ft?: number | null;
  lumber_value?: number | null;
  lumber_value_deducts?: number | null;
  recovery_lrf_bf_cm?: number | null;
  recovery_bf_cf?: number | null;
  fiber_ratio?: number | null;
}

export interface FileDetail extends FileOut {
  summary?: SummaryOut | null;
  solutions: Array<{ solution_number: number; board_count: number }>;
  reject_reasons: Array<{ reason: string; count: number }>;
  detail_lines: Array<{
    wood_type: string;
    thickness: string;
    width: number;
    grade: string;
    length_ft: number;
    pieces: number;
    bd_ft: number;
  }>;
}

/** One production day on the Trimmer, combining every run that started that day. */
export interface TrimmerDay {
  date: string;
  runs: number;
  volume: number;
  /** Derived from volume ÷ bd ft per piece for each run. */
  pieces: number | null;
  bfPerPiece: number | null;
  downtimeSeconds: number;
  totalStops: number;
  lugFill: number | null;
  trimLoss: number | null;
  fastPct: number | null;
  mediumPct: number | null;
  slowPct: number | null;
}

export type TrimmerBreakdownSection = "product" | "width" | "grade" | "length";

export interface TrimmerBreakdownRow {
  section: TrimmerBreakdownSection;
  label: string;
  pieces: number;
  volume: number;
  pctVolume: number;
}

export interface TrimmerBreakdown {
  /** Dates of the Production Summary reports included in the rows. */
  reportDates: string[];
  /** Earliest report with breakdown data across all dates, or null if none. */
  firstAvailableDate: string | null;
  rows: TrimmerBreakdownRow[];
}

export interface TrimmerDowntimeAlarm {
  key: string;
  alarmId: number | null;
  description: string;
  occurrences: number;
  totalSeconds: number;
  longestSeconds: number;
  /** True when one stop lasted longer than its report's shift window. */
  exceedsShift: boolean;
}

/** A single stop longer than the shift window of the report it came from. */
export interface TrimmerLongStop {
  date: string;
  description: string;
  seconds: number;
  windowSeconds: number;
}

export interface TrimmerDowntime {
  /** Dates of the Downtime Summary reports included in the totals. */
  reportDates: string[];
  firstAvailableDate: string | null;
  totalSeconds: number;
  totalStops: number;
  alarms: TrimmerDowntimeAlarm[];
  longStops: TrimmerLongStop[];
}

export type TrimmerReportStatus = "ok" | "empty" | "replaced";

export interface TrimmerReport {
  id: number;
  date: string;
  reportType: string;
  typeLabel: string;
  fileName: string | null;
  reportStart: string | null;
  reportEnd: string | null;
  printedAt: string | null;
  loadedAt: string | null;
  recordCount: number | null;
  status: TrimmerReportStatus;
}

export interface TrimmerKpi {
  lugFill: number | null;
  trimLoss: number | null;
  avgBfPerPiece: number | null;
  fastPct: number | null;
  mediumPct: number | null;
  slowPct: number | null;
}

export interface TrimmerReportDetail extends TrimmerReport {
  kpi: TrimmerKpi | null;
  breakdown: TrimmerBreakdownRow[];
  downtime: TrimmerDowntime | null;
  days: TrimmerDay[];
  /** The bronze rows that make up this report, by table. */
  raw: Record<string, unknown[]>;
}
