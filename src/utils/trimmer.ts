import type { TrimmerDay } from "../api/types";
import { combineTrimmerRuns } from "../api/trimmer";
import { numberFormatter } from "./formatting";

export const wholeNumberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
export const percentFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

/** Formats seconds as H:MM, allowing totals beyond 24 hours. */
export function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Formats seconds as H:MM:SS, matching the Trimmer's own reports. */
export function formatDurationExact(seconds: number) {
  const whole = Math.max(0, Math.round(seconds));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${Math.floor(whole / 3600)}:${pad(Math.floor(whole / 60) % 60)}:${pad(whole % 60)}`;
}

export function formatPercent(value: number | null) {
  return value === null ? "—" : `${percentFormatter.format(value)}%`;
}

/** Totals for the selected range: sums, with percentages weighted by volume. */
export function summarizeTrimmerDays(days: TrimmerDay[]) {
  return combineTrimmerRuns(days);
}

export function trimmerMetrics(days: TrimmerDay[]) {
  const total = summarizeTrimmerDays(days);
  const empty = days.length === 0;
  return [
    {
      label: "Total Volume",
      value: wholeNumberFormatter.format(total.volume),
      unit: `bd ft · ${days.length} ${days.length === 1 ? "day" : "days"}`,
    },
    { label: "Pieces", value: total.pieces === null ? "—" : wholeNumberFormatter.format(total.pieces) },
    { label: "BF / Piece", value: total.bfPerPiece === null ? "—" : numberFormatter.format(total.bfPerPiece), unit: "bd ft" },
    { label: "Lug Fill", value: empty ? "—" : formatPercent(total.lugFill), unit: "volume-weighted" },
    { label: "Trim Loss", value: empty ? "—" : formatPercent(total.trimLoss), unit: "volume-weighted" },
  ];
}
