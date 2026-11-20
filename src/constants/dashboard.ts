import type { GradeMixGrouping } from "../api/types";
import { allPlcs, type PlcOption } from "../config/mills";

export const plcOptions = allPlcs;
export type { PlcOption };

export const dashboardSections = [
  "data-selection", "summary", "product-breakdown", "output&rejects", "reports",
  "trimmer-daily", "trimmer-breakdown", "trimmer-speed", "trimmer-downtime",
] as const;
export type DashboardSection = (typeof dashboardSections)[number];

export const dashboardSectionLabels: Record<DashboardSection, string> = {
  "data-selection": "Data Selection",
  summary: "Summary",
  "product-breakdown": "Product Breakdown",
  "output&rejects": "Output & Rejects",
  reports: "Reports",
  "trimmer-daily": "Production by Day",
  "trimmer-breakdown": "Product Breakdown",
  "trimmer-speed": "Speed Mix",
  "trimmer-downtime": "Downtime",
};

const boardEdgerSections: readonly DashboardSection[] = ["data-selection", "summary", "product-breakdown", "output&rejects", "reports"];
const trimmerSections: readonly DashboardSection[] = ["data-selection", "trimmer-daily", "trimmer-breakdown", "trimmer-speed", "trimmer-downtime", "reports"];

/** The sidebar sections shown for each PLC's dashboard. */
export function sectionsForPlc(plc: PlcOption): readonly DashboardSection[] {
  return plc === "Trimmer" ? trimmerSections : boardEdgerSections;
}

export const gradeMixLabels: Record<GradeMixGrouping, string> = {
  grade: "Grade",
  thickness: "Thickness",
  width: "Width",
  length_ft: "Length Ft",
};
