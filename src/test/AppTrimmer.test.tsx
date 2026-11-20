import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrimmerBreakdown, TrimmerDay } from "../api/types";
import { App } from "../App";

const api = vi.hoisted(() => ({
  health: vi.fn(), files: vi.fn(), file: vi.fn(), productionSummary: vi.fn(), recovery: vi.fn(),
  solutionTotals: vi.fn(), rejectReasonTotals: vi.fn(), gradeMix: vi.fn(), boardDimensionMix: vi.fn(),
}));
const trimmer = vi.hoisted(() => ({ days: vi.fn(), breakdown: vi.fn() }));

vi.mock("../api/client", () => ({ tallyApi: api }));
vi.mock("../api/trimmer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/trimmer")>()),
  trimmerApi: trimmer,
}));
// Sequoia is the profile with a real Trimmer feed.
vi.mock("../config/currentMill", async (importOriginal) => {
  const { getMillProfile } = await import("../config/mills");
  return { ...(await importOriginal<typeof import("../config/currentMill")>()), currentMill: getMillProfile("sequoia"), demoMode: false };
});

const trimmerDays: TrimmerDay[] = [
  { date: "2026-11-17", runs: 1, volume: 159_795, pieces: 50_000, bfPerPiece: 3.2, downtimeSeconds: 8_465, totalStops: 698, lugFill: 90, trimLoss: 12, fastPct: 70, mediumPct: 20, slowPct: 10 },
  { date: "2026-11-18", runs: 1, volume: 164_010, pieces: 51_896, bfPerPiece: 3.16, downtimeSeconds: 94_444, totalStops: 725, lugFill: 91, trimLoss: 12.1, fastPct: 65, mediumPct: 22, slowPct: 13 },
];
const trimmerBreakdown: TrimmerBreakdown = {
  reportDates: ["2026-11-18"],
  firstAvailableDate: "2026-11-09",
  rows: [
    { section: "product", label: "8 x Gold", pieces: 3_360, volume: 14_755, pctVolume: 60 },
    { section: "product", label: "4 x Pallet", pieces: 900, volume: 9_836, pctVolume: 40 },
    { section: "width", label: "8.00", pieces: 19_652, volume: 71_899, pctVolume: 100 },
  ],
};

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  return render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  api.health.mockResolvedValue({ status: "ok" });
  api.files.mockResolvedValue([]);
  api.productionSummary.mockResolvedValue([]);
  api.recovery.mockResolvedValue([]);
  api.rejectReasonTotals.mockResolvedValue([]);
  api.gradeMix.mockResolvedValue([]);
  api.boardDimensionMix.mockResolvedValue([]);
  trimmer.days.mockResolvedValue(trimmerDays);
  trimmer.breakdown.mockResolvedValue(trimmerBreakdown);
});

async function switchToTrimmer() {
  const user = userEvent.setup();
  renderApp();
  await user.selectOptions(screen.getByLabelText("PLC"), "Trimmer");
  await screen.findByRole("table", { name: "Trimmer production by day" });
  return user;
}

describe("Trimmer dashboard", () => {
  it("enables Trimmer for Sequoia and leaves unbuilt PLCs disabled", () => {
    renderApp();
    expect(screen.getByRole("option", { name: "Trimmer" })).toBeEnabled();
    expect(screen.getByRole("option", { name: "Chopsaw" })).toBeDisabled();
    expect(trimmer.days).not.toHaveBeenCalled();
  });

  it("shows production by day, metric cards, breakdown and speed mix", async () => {
    const user = await switchToTrimmer();

    const overview = screen.getByRole("region", { name: "Production overview" });
    expect(within(overview).getByText("323,805")).toBeInTheDocument();
    expect(within(overview).getByText("101,896")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Last data: 11/18/2026");

    // Newest day first, with downtime past 24 hours shown as reported.
    const dailyRows = within(screen.getByRole("table", { name: "Trimmer production by day" })).getAllByRole("row");
    expect(dailyRows[1]).toHaveTextContent("11/18/2026");
    expect(dailyRows[1]).toHaveTextContent("26:14");
    expect(screen.getByLabelText("Trimmer volume by day bar chart")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Daily production metric"), "trimLoss");
    expect(screen.getByLabelText("Trimmer trim loss by day bar chart")).toBeInTheDocument();

    const breakdown = screen.getByRole("table", { name: "Trimmer product breakdown" });
    expect(within(breakdown).getByText("8 x Gold")).toBeInTheDocument();
    expect(screen.getByText(/1 production day has no breakdown report/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Group Trimmer breakdown by"), "width");
    expect(within(screen.getByRole("table", { name: "Trimmer width breakdown" })).getByText("8.00")).toBeInTheDocument();

    expect(screen.getByLabelText("Trimmer speed mix by day stacked bar chart")).toBeInTheDocument();

    const nav = screen.getByRole("navigation", { name: "Dashboard sections" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual(["Data Selection", "Production by Day", "Product Breakdown", "Speed Mix"]);
    expect(screen.queryByRole("table", { name: "Production Summary" })).not.toBeInTheDocument();
  });

  it("explains when the range has no breakdown reports", async () => {
    trimmer.breakdown.mockResolvedValue({ reportDates: [], firstAvailableDate: "2026-11-09", rows: [] });
    await switchToTrimmer();
    expect(await screen.findByText(/Breakdowns are available from 11\/9\/2026/)).toBeInTheDocument();
  });

  it("has no automatically detectable serious accessibility violations", async () => {
    await switchToTrimmer();
    const results = await axe.run(document.body, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } });
    expect(results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
  });
});
