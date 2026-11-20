import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTallyApiCache } from "../../api/client";
import {
  buildTrimmerBreakdown,
  buildTrimmerDays,
  buildTrimmerDowntime,
  buildTrimmerReportDetail,
  buildTrimmerReports,
  durationSeconds,
  type TrimmerBreakdownPayload,
  type TrimmerDowntimeAlarmPayload,
  type TrimmerTables,
  type TrimmerFileLoadPayload,
  type TrimmerTodateDayPayload,
} from "../../api/trimmer";
import { demoTrimmerTables } from "../../api/trimmerDemoData";

const all = { start: "", end: "" };

function load(id: number, report_type: string, printed_at: string, report_start: string | null = null, report_end: string | null = null): TrimmerFileLoadPayload {
  return { id, report_type, printed_at, report_start, report_end, archived_file_id: id };
}

function alarm(id: number, file_load_id: number, alarm_id: number | null, description: string, occurrences: number, total_duration: string, max_duration: string): TrimmerDowntimeAlarmPayload {
  return { id, file_load_id, alarm_id, description, occurrences, total_duration, max_duration };
}

const emptyTables: TrimmerTables = {
  file_load: [], archived_file: [], production_todate_day: [], production_summary_kpi: [],
  production_summary_breakdown: [], downtime_total: [], downtime_alarm: [],
};

function day(id: number, file_load_id: number, run_start: string, overrides: Partial<TrimmerTodateDayPayload> = {}): TrimmerTodateDayPayload {
  return {
    id, file_load_id, run_start,
    volume: 1000, downtime: "01:00:00", total_stops: 10, lug_fill: 90, trimloss: 12,
    bf_per_piece: 2.5, fast_pct: 60, medium_pct: 20, slow_pct: 20,
    ...overrides,
  };
}

function breakdownRow(id: number, file_load_id: number, section: string, label: string, pieces: number, volume: number, is_total = 0): TrimmerBreakdownPayload {
  return { id, file_load_id, section, label, pieces, volume, is_total };
}

describe("durationSeconds", () => {
  it("parses durations longer than a day and rejects malformed values", () => {
    expect(durationSeconds("26:14:04")).toBe(26 * 3600 + 14 * 60 + 4);
    expect(durationSeconds("00:00:00")).toBe(0);
    expect(durationSeconds(null)).toBe(0);
    expect(durationSeconds("bad")).toBe(0);
  });
});

describe("buildTrimmerDays", () => {
  it("takes each date from the newest To-date report that contains it", () => {
    const days = buildTrimmerDays({
      file_load: [load(3, "production_todate", "2026-11-09 15:40:00"), load(16, "production_todate", "2026-11-11 15:40:00"), load(19, "production_todate", "2026-11-18 15:40:00")],
      production_todate_day: [
        // An older parser rounded volumes and dropped run times; the newest load wins.
        day(1, 3, "2026-11-06 05:00:00", { volume: 1819.5 }),
        day(2, 16, "2026-11-06 00:00:00", { volume: 1820 }),
        day(3, 19, "2026-11-06 05:00:00", { volume: 1819.5 }),
        // Only present in an older load (it scrolled out of the newest report).
        day(4, 3, "2026-06-16 05:00:00", { volume: 500 }),
      ],
    }, all);

    expect(days.map((entry) => [entry.date, entry.volume, entry.runs])).toEqual([
      ["2026-06-16", 500, 1],
      ["2026-11-06", 1819.5, 1],
    ]);
  });

  it("combines several runs on one day, weighting percentages by volume", () => {
    const [entry] = buildTrimmerDays({
      file_load: [load(19, "production_todate", "2026-11-18 15:40:00")],
      production_todate_day: [
        day(1, 19, "2026-09-16 05:00:02", { volume: 1000, bf_per_piece: 2.5, downtime: "02:00:00", total_stops: 10, lug_fill: 90, slow_pct: 20 }),
        day(2, 19, "2026-09-16 15:40:02", { volume: 3000, bf_per_piece: 3, downtime: "15:16:03", total_stops: 30, lug_fill: 80, slow_pct: null }),
      ],
    }, all);

    expect(entry.runs).toBe(2);
    expect(entry.volume).toBe(4000);
    expect(entry.pieces).toBeCloseTo(400 + 1000);
    expect(entry.bfPerPiece).toBeCloseTo(4000 / 1400);
    expect(entry.totalStops).toBe(40);
    expect(entry.downtimeSeconds).toBe(2 * 3600 + 15 * 3600 + 16 * 60 + 3);
    expect(entry.lugFill).toBeCloseTo((90 * 1000 + 80 * 3000) / 4000);
    // A missing value is left out rather than counted as zero.
    expect(entry.slowPct).toBe(20);
  });

  it("filters by run date inclusively", () => {
    const days = buildTrimmerDays({
      file_load: [load(1, "production_todate", "2026-11-18 15:40:00")],
      production_todate_day: ["2026-11-01", "2026-11-02", "2026-11-03"].map((date, index) => day(index, 1, `${date} 05:00:00`)),
    }, { start: "2026-11-02", end: "2026-11-03" });
    expect(days.map((entry) => entry.date)).toEqual(["2026-11-02", "2026-11-03"]);
  });
});

describe("buildTrimmerBreakdown", () => {
  const fileLoad = [
    load(2, "production_summary", "2026-11-09 15:40:00", "2026-11-09 05:00:01"),
    load(5, "production_summary", "2026-11-13 15:40:00", "2026-11-13 05:00:01"),
    load(8, "production_summary", "2026-11-16 15:41:00", "2026-11-16 05:00:02"),
    load(9, "production_todate", "2026-11-16 15:41:00"),
  ];
  const breakdown = [
    breakdownRow(1, 2, "product", "8 x Gold", 100, 400),
    breakdownRow(2, 2, "product", "4 x Pallet", 50, 100),
    breakdownRow(3, 2, "product", "Total", 150, 500, 1),
    breakdownRow(4, 2, "length", "8'", 60, 300),
    breakdownRow(5, 2, "length", "10'", 40, 150),
    breakdownRow(6, 2, "length", "5'", 50, 50),
    // An empty report (all zeros) adds nothing and is not counted as covered.
    breakdownRow(7, 5, "product", "Total", 0, 0, 1),
    breakdownRow(8, 8, "product", "8 x Gold", 20, 100),
  ];

  it("sums across reports, ignores Total rows and skips empty reports", () => {
    const result = buildTrimmerBreakdown({ file_load: fileLoad, production_summary_breakdown: breakdown }, all);
    const products = result.rows.filter((row) => row.section === "product");

    expect(result.reportDates).toEqual(["2026-11-09", "2026-11-16"]);
    expect(result.firstAvailableDate).toBe("2026-11-09");
    expect(products.map((row) => [row.label, row.pieces, row.volume])).toEqual([
      ["8 x Gold", 120, 500],
      ["4 x Pallet", 50, 100],
    ]);
    expect(products[0].pctVolume).toBeCloseTo(500 / 600 * 100);
  });

  it("orders lengths and widths numerically", () => {
    const result = buildTrimmerBreakdown({ file_load: fileLoad, production_summary_breakdown: breakdown }, all);
    expect(result.rows.filter((row) => row.section === "length").map((row) => row.label)).toEqual(["5'", "8'", "10'"]);
  });

  it("keeps the earliest available date when the range has no reports", () => {
    const result = buildTrimmerBreakdown({ file_load: fileLoad, production_summary_breakdown: breakdown }, { start: "2026-07-01", end: "2026-07-31" });
    expect(result.rows).toEqual([]);
    expect(result.reportDates).toEqual([]);
    expect(result.firstAvailableDate).toBe("2026-11-09");
  });

  it("merges labels that differ only by case, but not by punctuation", () => {
    const result = buildTrimmerBreakdown({
      file_load: fileLoad,
      production_summary_breakdown: [
        breakdownRow(1, 2, "product", "2x4 x HQ Gold", 10, 100),
        breakdownRow(2, 8, "product", "2x4 x hq Gold", 30, 300),
        breakdownRow(3, 8, "product", "2x4 .HQ Gold", 5, 50),
      ],
    }, all);

    expect(result.rows.map((row) => [row.label, row.pieces, row.volume])).toEqual([
      // The merged row shows the spelling with the most volume.
      ["2x4 x hq Gold", 40, 400],
      ["2x4 .HQ Gold", 5, 50],
    ]);
  });

  it("uses only the newest report when a date was loaded twice", () => {
    const result = buildTrimmerBreakdown({
      file_load: [...fileLoad, load(20, "production_summary", "2026-11-16 18:00:00", "2026-11-16 05:00:02")],
      production_summary_breakdown: [...breakdown, breakdownRow(9, 20, "product", "8 x Gold", 25, 125)],
    }, { start: "2026-11-16", end: "2026-11-16" });
    expect(result.rows.map((row) => [row.label, row.volume])).toEqual([["8 x Gold", 125]]);
  });
});

describe("buildTrimmerDowntime", () => {
  const tables = {
    file_load: [
      load(1, "downtime_summary", "2026-11-09 15:40:00", "2026-11-09 05:00:01", "2026-11-09 15:40:00"),
      load(4, "downtime_summary", "2026-11-13 15:40:00", "2026-11-13 05:00:01", "2026-11-13 15:40:02"),
      load(17, "downtime_summary", "2026-11-18 15:40:00", "2026-11-18 05:00:00", "2026-11-18 15:40:00"),
    ],
    downtime_total: [
      { id: 1, file_load_id: 1, occurrences: 15, total_duration: "00:30:00" },
      // 11/13 arrived empty.
      { id: 2, file_load_id: 4, occurrences: 0, total_duration: null },
      { id: 3, file_load_id: 17, occurrences: 80, total_duration: "24:10:00" },
    ],
    downtime_alarm: [
      alarm(1, 1, 239, "Green Chain #2 Operator Stopped", 5, "00:10:00", "00:04:00"),
      alarm(2, 1, 65, "Sorter Stop", 10, "00:20:00", "00:05:00"),
      alarm(3, 17, 239, "Green Chain #2 Operator Stopped (renamed)", 70, "24:00:00", "23:59:57"),
      alarm(4, 17, 65, "Sorter Stop", 10, "00:10:00", "00:02:00"),
    ],
  };

  it("totals the newest reports, matches alarms by id and skips empty reports", () => {
    const downtime = buildTrimmerDowntime(tables, all);

    expect(downtime.reportDates).toEqual(["2026-11-09", "2026-11-18"]);
    expect(downtime.firstAvailableDate).toBe("2026-11-09");
    expect(downtime.totalStops).toBe(95);
    expect(downtime.totalSeconds).toBe(30 * 60 + 24 * 3600 + 10 * 60);
    expect(downtime.alarms.map((entry) => [entry.alarmId, entry.description, entry.occurrences, entry.totalSeconds])).toEqual([
      // The newest description is shown.
      [239, "Green Chain #2 Operator Stopped (renamed)", 75, 10 * 60 + 24 * 3600],
      [65, "Sorter Stop", 20, 30 * 60],
    ]);
  });

  it("flags stops longer than the report's shift window but keeps them as reported", () => {
    const downtime = buildTrimmerDowntime(tables, all);
    const flagged = downtime.alarms.find((entry) => entry.alarmId === 239);

    expect(flagged).toMatchObject({ longestSeconds: 23 * 3600 + 59 * 60 + 57, exceedsShift: true });
    expect(downtime.alarms.find((entry) => entry.alarmId === 65)?.exceedsShift).toBe(false);
    expect(downtime.longStops).toEqual([{
      date: "2026-11-18",
      description: "Green Chain #2 Operator Stopped (renamed)",
      seconds: 23 * 3600 + 59 * 60 + 57,
      windowSeconds: 10 * 3600 + 40 * 60,
    }]);
  });

  it("falls back to summing alarms when a report has no total row", () => {
    const downtime = buildTrimmerDowntime({ ...tables, downtime_total: [] }, { start: "2026-11-09", end: "2026-11-09" });
    expect(downtime.totalStops).toBe(15);
    expect(downtime.totalSeconds).toBe(30 * 60);
  });
});

describe("Trimmer reports", () => {
  const tables: TrimmerTables = {
    ...emptyTables,
    file_load: [
      load(2, "production_summary", "2026-11-09 15:40:00", "2026-11-09 05:00:01"),
      load(5, "production_summary", "2026-11-13 15:40:00", "2026-11-13 05:00:01"),
      load(6, "production_todate", "2026-11-13 15:40:00"),
      load(7, "production_summary", "2026-11-09 18:00:00", "2026-11-09 05:00:01"),
    ],
    archived_file: [{ id: 2, archive_name: "2026-11-09_Production Summary.xls", original_name: "Production Summary.xls" }],
    production_todate_day: [day(1, 6, "2026-11-12 05:00:00")],
    production_summary_kpi: [{ id: 1, file_load_id: 7, lug_fill: 91, trimloss: 12.1, avg_bf_per_piece: 3.16, trimmer_speed_fast_pct: 65, trimmer_speed_medium_pct: 22, trimmer_speed_slow_pct: 13 }],
    production_summary_breakdown: [
      breakdownRow(1, 2, "product", "8 x Gold", 10, 40),
      breakdownRow(2, 5, "product", "Total", 0, 0, 1),
      breakdownRow(3, 7, "product", "8 x Gold", 12, 48),
      breakdownRow(4, 7, "product", "Total", 12, 48, 1),
    ],
  };

  it("lists loads newest date first, marking empty and replaced reports", () => {
    const reports = buildTrimmerReports(tables, all);
    expect(reports.map((report) => [report.id, report.date, report.typeLabel, report.status])).toEqual([
      [5, "2026-11-13", "Production Summary", "empty"],
      [6, "2026-11-13", "Production To-date", "ok"],
      [7, "2026-11-09", "Production Summary", "ok"],
      [2, "2026-11-09", "Production Summary", "replaced"],
    ]);
    expect(reports.find((report) => report.id === 2)?.fileName).toBe("2026-11-09_Production Summary.xls");
  });

  it("filters the list by report date", () => {
    expect(buildTrimmerReports(tables, { start: "2026-11-10", end: "" }).map((report) => report.id)).toEqual([5, 6]);
  });

  it("builds a report's contents and raw rows", () => {
    const detail = buildTrimmerReportDetail(tables, 7);
    expect(detail?.kpi).toMatchObject({ lugFill: 91, trimLoss: 12.1, fastPct: 65 });
    expect(detail?.breakdown.map((row) => row.label)).toEqual(["8 x Gold"]);
    expect(Object.keys(detail?.raw ?? {})).toEqual(["file_load", "production_summary_kpi", "production_summary_breakdown"]);
    expect(buildTrimmerReportDetail(tables, 6)?.days.map((entry) => entry.date)).toEqual(["2026-11-12"]);
    expect(buildTrimmerReportDetail(tables, 999)).toBeNull();
  });
});

describe("Trimmer demo data", () => {
  it("produces 90 days with breakdowns for the last 14 and excludes Total rows", () => {
    const days = buildTrimmerDays(demoTrimmerTables, all);
    const breakdown = buildTrimmerBreakdown(demoTrimmerTables, all);
    expect(days).toHaveLength(90);
    expect(breakdown.reportDates).toHaveLength(14);
    expect(breakdown.rows.some((row) => row.label === "Total")).toBe(false);
    const productShare = breakdown.rows.filter((row) => row.section === "product").reduce((sum, row) => sum + row.pctVolume, 0);
    expect(productShare).toBeCloseTo(100);
  });

  it("includes downtime reports whose alarms add up to each day's totals", () => {
    const downtime = buildTrimmerDowntime(demoTrimmerTables, all);
    const reports = buildTrimmerReports(demoTrimmerTables, all);
    expect(downtime.reportDates).toHaveLength(14);
    expect(downtime.alarms.reduce((sum, entry) => sum + entry.totalSeconds, 0)).toBe(downtime.totalSeconds);
    expect(downtime.alarms.reduce((sum, entry) => sum + entry.occurrences, 0)).toBe(downtime.totalStops);
    expect(downtime.longStops).toEqual([]);
    expect(reports).toHaveLength(1 + 14 * 2);
    expect(reports.every((report) => report.status === "ok" && report.fileName)).toBe(true);
  });
});

describe("bronze Trimmer requests", () => {
  beforeEach(resetTallyApiCache);
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("reads trimmer tables from the trimmer route", async () => {
    const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/tables")) return json({ tables: [{ table_name: "trimmer__file_load", row_count: 1 }, { table_name: "trimmer__production_todate_day", row_count: 1 }] });
      if (url.includes("/trimmer/file-load?")) return json({ rows: [{ payload: load(1, "production_todate", "2026-11-18 15:40:00") }] });
      if (url.includes("/trimmer/production-todate-day?")) return json({ rows: [{ payload: day(1, 1, "2026-11-18 05:00:00") }] });
      throw new Error(`Unexpected request: ${url}`);
    });
    window.__LUMBER_TALLY_CONFIG__ = { millId: "sequoia", demoMode: false };
    vi.resetModules();
    const { trimmerApi } = await import("../../api/trimmer");

    const days = await trimmerApi.days(all);

    expect(days.map((entry) => entry.date)).toEqual(["2026-11-18"]);
    expect(fetchSpy.mock.calls.map(([input]) => String(input))).toEqual(expect.arrayContaining([
      "/api/bronze/trimmer/file-load?limit=1000&offset=0",
      "/api/bronze/trimmer/production-todate-day?limit=1000&offset=0",
    ]));
    delete window.__LUMBER_TALLY_CONFIG__;
  });
});
