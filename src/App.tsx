import { useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { tallyApi } from "./api/client";
import { trimmerApi } from "./api/trimmer";
import type { DateRange, GradeMixGrouping } from "./api/types";
import { MixChart } from "./components/charts/MixChart";
import { RejectReasons } from "./components/charts/RejectReasons";
import { ProductBreakdown } from "./components/charts/ProductBreakdown";
import { DataSelectionHeader } from "./components/data-selection/DataSelectionHeader";
import { DataSelectionPanel } from "./components/data-selection/DataSelectionPanel";
import { MetricsOverview } from "./components/MetricsOverview";
import { ProductionSummary } from "./components/production/ProductionSummary";
import { ReportsPanel } from "./components/reports/ReportsPanel";
import { Sidebar } from "./components/sidebar/Sidebar";
import { TrimmerBreakdown } from "./components/trimmer/TrimmerBreakdown";
import { TrimmerDaily } from "./components/trimmer/TrimmerDaily";
import { TrimmerDowntime } from "./components/trimmer/TrimmerDowntime";
import { TrimmerReports } from "./components/trimmer/TrimmerReports";
import { TrimmerSpeedMix } from "./components/trimmer/TrimmerSpeedMix";
import { sectionsForPlc, type PlcOption } from "./constants/dashboard";
import { currentMill } from "./config/currentMill";
import { useScrollSpy } from "./hooks/useScrollSpy";
import { reportDetailQueryOptions, useReportDetailPrefetch } from "./hooks/useReportDetailPrefetch";
import { buildBoardShapes, countReportDays, latestReportDate, mergeProductionRecovery, sumAdjustedRuntimeHours, sumNullable } from "./utils/dashboardData";
import { defaultReportRange, formatReportDate, moneyFormatter, numberFormatter, previousProductionDaysRange } from "./utils/formatting";
import { trimmerMetrics } from "./utils/trimmer";

const allDates: DateRange = { start: "", end: "" };

const initialReportRange: DateRange = currentMill.initialReportRange === "all"
  ? { start: "", end: "" }
  : defaultReportRange();

export function App() {
  const [draftRange, setDraftRange] = useState<DateRange>(initialReportRange);
  const [range, setRange] = useState<DateRange>(initialReportRange);
  const [selectedPlc, setSelectedPlc] = useState<PlcOption>(currentMill.defaultPlc);
  const [gradeMixGrouping, setGradeMixGrouping] = useState<GradeMixGrouping>("grade");
  const [productView, setProductView] = useState<"table" | "boards">("table");
  const [selectedFileId, setSelectedFileId] = useState<number | null>(null);
  const [rawJsonOpen, setRawJsonOpen] = useState(false);
  const { activeSection, selectSection } = useScrollSpy();
  const invalidRange = Boolean(draftRange.start && draftRange.end && draftRange.start > draftRange.end);
  const isTrimmer = selectedPlc === "Trimmer";
  const isBoardEdger = !isTrimmer;

  useQuery({ queryKey: ["health"], queryFn: ({ signal }) => tallyApi.health(signal), refetchInterval: 60_000 });
  const files = useQuery({ queryKey: ["files", selectedPlc, range], queryFn: ({ signal }) => tallyApi.files(range, signal), enabled: isBoardEdger });
  const availableFiles = useQuery({ queryKey: ["available-files", selectedPlc], queryFn: ({ signal }) => tallyApi.files(allDates, signal), enabled: isBoardEdger });
  const production = useQuery({ queryKey: ["production-summary", selectedPlc, range], queryFn: ({ signal }) => tallyApi.productionSummary(range, signal), enabled: isBoardEdger });
  const recovery = useQuery({ queryKey: ["recovery", selectedPlc, range], queryFn: ({ signal }) => tallyApi.recovery(range, signal), enabled: isBoardEdger });
  const rejects = useQuery({ queryKey: ["reject-reason-totals", selectedPlc, range], queryFn: ({ signal }) => tallyApi.rejectReasonTotals(range, signal), enabled: isBoardEdger });
  const gradeMix = useQuery({
    queryKey: ["grade-mixes", selectedPlc, range],
    enabled: isBoardEdger,
    queryFn: async ({ signal }) => {
      const groupings: GradeMixGrouping[] = ["grade", "width", "thickness", "length_ft"];
      const entries = await Promise.all(groupings.map(async (grouping) =>
        [grouping, await tallyApi.gradeMix(range, grouping, signal)] as const));
      return Object.fromEntries(entries) as Record<GradeMixGrouping, Awaited<ReturnType<typeof tallyApi.gradeMix>>>;
    },
  });
  const boardDimensionMix = useQuery({ queryKey: ["board-dimension-mix", selectedPlc, range], queryFn: ({ signal }) => tallyApi.boardDimensionMix(range, signal), enabled: isBoardEdger });
  const trimmerDays = useQuery({ queryKey: ["trimmer-days", range], queryFn: ({ signal }) => trimmerApi.days(range, signal), enabled: isTrimmer });
  const trimmerAllDays = useQuery({ queryKey: ["trimmer-days", allDates], queryFn: ({ signal }) => trimmerApi.days(allDates, signal), enabled: isTrimmer });
  const trimmerBreakdown = useQuery({ queryKey: ["trimmer-breakdown", range], queryFn: ({ signal }) => trimmerApi.breakdown(range, signal), enabled: isTrimmer });
  const trimmerDowntime = useQuery({ queryKey: ["trimmer-downtime", range], queryFn: ({ signal }) => trimmerApi.downtime(range, signal), enabled: isTrimmer });
  const trimmerReports = useQuery({ queryKey: ["trimmer-reports", range], queryFn: ({ signal }) => trimmerApi.reports(range, signal), enabled: isTrimmer });
  const trimmerReportDetail = useQuery({
    queryKey: ["trimmer-report", selectedFileId],
    queryFn: ({ signal }) => trimmerApi.report(selectedFileId ?? 0, signal),
    enabled: isTrimmer && selectedFileId !== null,
  });
  const fileDetail = useQuery({ ...reportDetailQueryOptions(selectedFileId ?? 0), enabled: isBoardEdger && selectedFileId !== null });
  const dashboardInitialLoadComplete = [production, recovery, rejects, gradeMix, boardDimensionMix]
    .every((query) => !query.isPending);
  useReportDetailPrefetch(availableFiles.data ?? [], dashboardInitialLoadComplete && availableFiles.isSuccess);

  const edgerMetrics = useMemo(() => {
    const rows = production.data ?? [];
    const days = countReportDays(files.data ?? []);
    const runtimeHours = sumAdjustedRuntimeHours(rows.map((row) => row.time_run));
    return [
      {
        label: "Run Time",
        value: `${numberFormatter.format(runtimeHours)} hrs`,
        unit: `${numberFormatter.format(days)} ${days === 1 ? "day" : "days"}`,
      },
      { label: "Input Pieces", value: numberFormatter.format(sumNullable(rows.map((row) => row.board_input_pieces))) },
      { label: "Input Volume", value: numberFormatter.format(sumNullable(rows.map((row) => row.board_input_cuft))), unit: "cu ft" },
      { label: "Total Output", value: numberFormatter.format(sumNullable(rows.map((row) => row.edger_bd_ft))), unit: "bd ft" },
      { label: "Projected Lumber Value", value: moneyFormatter.format(sumNullable(rows.map((row) => row.lumber_value))) },
    ];
  }, [files.data, production.data]);
  const trimmerDayRows = useMemo(() => trimmerDays.data ?? [], [trimmerDays.data]);
  const metrics = useMemo(
    () => isTrimmer ? trimmerMetrics(trimmerDayRows) : edgerMetrics,
    [isTrimmer, trimmerDayRows, edgerMetrics],
  );
  const productionRows = useMemo(() => mergeProductionRecovery(production.data ?? [], recovery.data ?? []), [production.data, recovery.data]);
  const boardShapes = useMemo(() => buildBoardShapes(boardDimensionMix.data ?? []), [boardDimensionMix.data]);
  const latestAvailableDate = useMemo(() => {
    const date = isTrimmer
      ? trimmerAllDays.data?.at(-1)?.date ?? null
      : latestReportDate(availableFiles.data ?? []);
    return date ? formatReportDate(date) : null;
  }, [isTrimmer, trimmerAllDays.data, availableFiles.data]);
  const availability = isTrimmer ? trimmerAllDays : availableFiles;

  const applyRange = (event: FormEvent) => {
    event.preventDefault();
    if (!invalidRange) {
      setSelectedFileId(null);
      setRange(draftRange);
    }
  };
  const showAllDates = () => {
    setDraftRange(allDates);
    setRange(allDates);
    setSelectedFileId(null);
  };
  const showPresetDays = (days: number) => {
    const presetRange = previousProductionDaysRange(days);
    setDraftRange(presetRange);
    setRange(presetRange);
    setSelectedFileId(null);
  };
  const selectPlc = (plc: PlcOption) => {
    setSelectedPlc(plc);
    setSelectedFileId(null);
  };
  const backToReports = () => {
    setRawJsonOpen(false);
    setSelectedFileId(null);
  };

  return <div className="app-shell">
    <Sidebar sections={sectionsForPlc(selectedPlc)} activeSection={activeSection} onSelectSection={selectSection} />
    <div className="dashboard-surface">
      <DataSelectionHeader />
      <main>
        <DataSelectionPanel draftRange={draftRange} range={range} selectedPlc={selectedPlc} invalidRange={invalidRange} latestAvailableDate={latestAvailableDate} availabilityPending={availability.isPending} availabilityError={availability.isError} onDraftRangeChange={setDraftRange} onPlcChange={selectPlc} onApply={applyRange} onAllDates={showAllDates} onPresetDays={showPresetDays} />
        <MetricsOverview metrics={metrics} />
        {isTrimmer ? <div className="dashboard-grid">
          <TrimmerDaily days={trimmerDayRows} isPending={trimmerDays.isPending} error={trimmerDays.error} onRetry={() => { void trimmerDays.refetch(); }} />
          <TrimmerBreakdown breakdown={trimmerBreakdown.data} productionDates={trimmerDayRows.map((day) => day.date)} isPending={trimmerBreakdown.isPending} error={trimmerBreakdown.error} onRetry={() => { void trimmerBreakdown.refetch(); }} />
          <TrimmerSpeedMix days={trimmerDayRows} isPending={trimmerDays.isPending} error={trimmerDays.error} onRetry={() => { void trimmerDays.refetch(); }} />
          <TrimmerDowntime downtime={trimmerDowntime.data} productionDates={trimmerDayRows.map((day) => day.date)} isPending={trimmerDowntime.isPending} error={trimmerDowntime.error} onRetry={() => { void trimmerDowntime.refetch(); }} />
          <TrimmerReports
            reports={trimmerReports.data ?? []} reportsPending={trimmerReports.isPending} reportsError={trimmerReports.error} onRetryReports={() => { void trimmerReports.refetch(); }}
            selectedId={selectedFileId} onSelect={setSelectedFileId} onBack={backToReports}
            detail={trimmerReportDetail.data} detailPending={trimmerReportDetail.isPending} detailError={trimmerReportDetail.error} onRetryDetail={() => { void trimmerReportDetail.refetch(); }}
            rawJsonOpen={rawJsonOpen} onToggleRawJson={() => setRawJsonOpen((open) => !open)}
          />
        </div> : <div className="dashboard-grid">
          <ProductionSummary
            rows={productionRows}
            tablePending={production.isPending || recovery.isPending} tableError={production.error ?? recovery.error}
            onRetryTable={() => { void production.refetch(); void recovery.refetch(); }}
          />
          <ProductBreakdown shapes={boardShapes} view={productView} onViewChange={setProductView} isPending={boardDimensionMix.isPending} error={boardDimensionMix.error} onRetry={() => { void boardDimensionMix.refetch(); }} />
          <section id="output&rejects" className="wide-panel paired-panel-row section-anchor">
            <MixChart grouping={gradeMixGrouping} onGroupingChange={setGradeMixGrouping} rows={gradeMix.data?.[gradeMixGrouping] ?? []} isPending={gradeMix.isPending} error={gradeMix.error} onRetry={() => { void gradeMix.refetch(); }} />
            <RejectReasons rows={rejects.data ?? []} isPending={rejects.isPending} error={rejects.error} onRetry={() => { void rejects.refetch(); }} />
          </section>
          <ReportsPanel
            files={files.data ?? []} filesPending={files.isPending} filesError={files.error} onRetryFiles={() => { void files.refetch(); }}
            selectedFileId={selectedFileId} onSelectFile={setSelectedFileId} onBack={backToReports}
            detail={fileDetail.data} detailPending={fileDetail.isPending} detailError={fileDetail.error} onRetryDetail={() => { void fileDetail.refetch(); }}
            rawJsonOpen={rawJsonOpen} onToggleRawJson={() => setRawJsonOpen((open) => !open)}
          />
        </div>}
      </main>
    </div>
  </div>;
}
