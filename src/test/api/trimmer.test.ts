import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTallyApiCache } from "../../api/client";
import {
  buildTrimmerBreakdown,
  buildTrimmerDays,
  durationSeconds,
  type TrimmerBreakdownPayload,
  type TrimmerFileLoadPayload,
  type TrimmerTodateDayPayload,
} from "../../api/trimmer";
import { demoTrimmerTables } from "../../api/trimmerDemoData";

const all = { start: "", end: "" };

function load(id: number, report_type: string, printed_at: string, report_start: string | null = null): TrimmerFileLoadPayload {
  return { id, report_type, printed_at, report_start, report_end: null };
}

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

  it("uses only the newest report when a date was loaded twice", () => {
    const result = buildTrimmerBreakdown({
      file_load: [...fileLoad, load(20, "production_summary", "2026-11-16 18:00:00", "2026-11-16 05:00:02")],
      production_summary_breakdown: [...breakdown, breakdownRow(9, 20, "product", "8 x Gold", 25, 125)],
    }, { start: "2026-11-16", end: "2026-11-16" });
    expect(result.rows.map((row) => [row.label, row.volume])).toEqual([["8 x Gold", 125]]);
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
