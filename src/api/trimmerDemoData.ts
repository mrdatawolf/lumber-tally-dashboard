import { runtimeFakeDataSeed } from "../config/runtimeConfig";
import type { TrimmerBreakdownPayload, TrimmerFileLoadPayload, TrimmerTables, TrimmerTodateDayPayload } from "./trimmer";

// Deterministic Trimmer demo data in the same shape as the bronze tables, so
// demo mode exercises the same de-duplication and aggregation as production.
// It uses its own random sequence so the Board Edger demo data is unchanged.
const dayCount = 90;
const breakdownDayCount = 14;
let randomState = [...`${runtimeFakeDataSeed}:trimmer`].reduce(
  (hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16_777_619),
  2_166_136_261,
) >>> 0;

function random() {
  randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
  return randomState / 2 ** 32;
}

function between(min: number, max: number) {
  return min + random() * (max - min);
}

function duration(seconds: number) {
  const whole = Math.max(0, Math.round(seconds));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(whole / 3600))}:${pad(Math.floor(whole / 60) % 60)}:${pad(whole % 60)}`;
}

const today = new Date();
const endDate = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate(), 12));
const dates = Array.from({ length: dayCount }, (_, offset) => {
  const date = new Date(endDate);
  date.setUTCDate(date.getUTCDate() - (dayCount - offset - 1));
  return date.toISOString().slice(0, 10);
});
const lastDate = dates[dates.length - 1];

const products = [
  { width: "4.00", grade: "Gold", share: 0.2 },
  { width: "4.00", grade: "Pallet", share: 0.12 },
  { width: "6.00", grade: "Gold", share: 0.16 },
  { width: "6.00", grade: "Silver", share: 0.1 },
  { width: "8.00", grade: "Gold", share: 0.24 },
  { width: "8.00", grade: "Bronze", share: 0.18 },
] as const;
const lengths = [{ label: "4'", share: 0.12 }, { label: "5'", share: 0.4 }, { label: "6'", share: 0.22 }, { label: "8'", share: 0.26 }] as const;

const todateLoadId = 1;
const fileLoad: TrimmerFileLoadPayload[] = [{
  id: todateLoadId,
  report_type: "production_todate",
  report_start: null,
  report_end: null,
  printed_at: `${lastDate} 15:40:00`,
}];

const todateDays: TrimmerTodateDayPayload[] = dates.map((date, index) => {
  const fast = Math.round(between(30, 75));
  const medium = Math.round(between(8, 25));
  return {
    id: index + 1,
    file_load_id: todateLoadId,
    run_start: `${date} 05:00:00`,
    volume: Math.round(between(135_000, 175_000) * 10) / 10,
    downtime: duration(between(5_400, 10_800)),
    total_stops: Math.round(between(180, 720)),
    lug_fill: Math.round(between(78, 95)),
    trimloss: Math.round(between(11.5, 16) * 10) / 10,
    bf_per_piece: Math.round(between(2.8, 3.4) * 1e6) / 1e6,
    fast_pct: fast,
    medium_pct: medium,
    slow_pct: Math.max(0, 100 - fast - medium),
  };
});

const breakdown: TrimmerBreakdownPayload[] = [];
for (const day of todateDays.slice(-breakdownDayCount)) {
  const date = day.run_start.slice(0, 10);
  const loadId = fileLoad.length + 1;
  fileLoad.push({
    id: loadId,
    report_type: "production_summary",
    report_start: `${date} 05:00:00`,
    report_end: `${date} 15:40:00`,
    printed_at: `${date} 15:40:00`,
  });
  const volume = day.volume ?? 0;
  const pieces = volume / (day.bf_per_piece ?? 3);
  const add = (section: string, label: string, share: number, isTotal = false) => breakdown.push({
    id: breakdown.length + 1,
    file_load_id: loadId,
    section,
    label,
    pieces: Math.round(pieces * share),
    volume: volume * share,
    is_total: isTotal ? 1 : 0,
  });

  const productShares = products.map((product) => product.share * between(0.8, 1.2));
  const shareTotal = productShares.reduce((sum, share) => sum + share, 0);
  const normalized = productShares.map((share) => share / shareTotal);
  products.forEach((product, index) => add("product", `${product.width} x ${product.grade}`, normalized[index]));
  for (const width of new Set(products.map((product) => product.width))) {
    add("width", width, products.reduce((sum, product, index) => sum + (product.width === width ? normalized[index] : 0), 0));
  }
  for (const grade of new Set(products.map((product) => product.grade))) {
    add("grade", grade, products.reduce((sum, product, index) => sum + (product.grade === grade ? normalized[index] : 0), 0));
  }
  lengths.forEach((length) => add("length", length.label, length.share));
  // Reports include a "Total" row per section; the dashboard must ignore them.
  for (const section of ["product", "width", "grade", "length"]) add(section, "Total", 1, true);
}

export const demoTrimmerTables: TrimmerTables = {
  file_load: fileLoad,
  production_todate_day: todateDays,
  production_summary_breakdown: breakdown,
};
