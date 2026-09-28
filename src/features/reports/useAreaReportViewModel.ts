import { createContext, useContext, useMemo } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';

import type { Area } from '../areas/AreaService';
import type { DefectDetection } from '../viewer/DefectDetectionService';
import { useDefectDetections } from '../viewer/useDefectDetections';
import type { InspectionResult } from '../viewer/InspectionResultService';
import type { NdtMeasurement } from '../viewer/NdtMeasurementService';
import { useArea } from '../viewer/useArea';
import { useInspectionResults } from '../viewer/useInspectionResults';
import { useNdtMeasurements } from '../viewer/useNdtMeasurements';
import type { Vessel } from '../vessels/VesselService';
import { useVessel } from '../vessels/useVessel';
import { computeBoxStats } from './ndtStats';
import type { CampaignBoxStats } from './ndtStats';
import { AUTOASSESS_SPACE } from '../../shared/cdf/dataModel';

export interface DefectSummaryRow {
  defectClass: string;
  total: number;
  confirmed: number;
  dismissed: number;
  underReview: number;
  newCount: number;
}

export interface CampaignSummary {
  campaignId: string;
  campaignSpace: string;
  date: string;
  status: InspectionResult['status'];
}

export interface AreaReportViewModel {
  vesselName: string;
  areaName: string;
  /** All campaigns for the area, sorted most recent first. */
  campaigns: CampaignSummary[];
  /** Up to 3 most recent campaigns, used for the box plot. */
  recentCampaigns: CampaignSummary[];
  /** Box stats for each entry in recentCampaigns (entries with no data are omitted). */
  boxStats: CampaignBoxStats[];
  /** All defect detections for the area, aggregated across campaigns. */
  defectSummary: DefectSummaryRow[];
  isLoading: boolean;
  error: Error | null;
}

type UseInspectionResultsFn = (
  areaSpace: string,
  areaExternalId: string,
) => UseQueryResult<InspectionResult[], Error>;

type UseNdtMeasurementsFn = (
  areaSpace: string,
  areaExternalId: string,
) => UseQueryResult<NdtMeasurement[], Error>;

type UseAreaFn = (space: string, externalId: string) => UseQueryResult<Area, Error>;

type UseVesselFn = (
  externalId: string,
) => { data: Vessel | undefined; isLoading: boolean; error: Error | null };

type UseDefectDetectionsFn = (
  areaSpace: string,
  areaExternalId: string,
) => UseQueryResult<DefectDetection[], Error>;

export type AreaReportViewModelContextType = {
  useInspectionResults: UseInspectionResultsFn;
  useNdtMeasurements: UseNdtMeasurementsFn;
  useArea: UseAreaFn;
  useVessel: UseVesselFn;
  useDefectDetections: UseDefectDetectionsFn;
};

const defaultDeps: AreaReportViewModelContextType = {
  useInspectionResults,
  useNdtMeasurements,
  useArea,
  useVessel,
  useDefectDetections,
};

export const AreaReportViewModelContext =
  createContext<AreaReportViewModelContextType>(defaultDeps);

export function useAreaReportViewModel(
  areaSpace: string,
  areaExternalId: string,
  vesselId: string,
): AreaReportViewModel {
  const {
    useInspectionResults: useResultsDep,
    useNdtMeasurements: useNdtDep,
    useArea: useAreaDep,
    useVessel: useVesselDep,
    useDefectDetections: useDefectsDep,
  } = useContext(AreaReportViewModelContext);

  const resultsQuery = useResultsDep(areaSpace, areaExternalId);
  const ndtQuery = useNdtDep(areaSpace, areaExternalId);
  const areaQuery = useAreaDep(areaSpace, areaExternalId);
  const vesselResult = useVesselDep(vesselId);
  const defectsQuery = useDefectsDep(areaSpace, areaExternalId);

  const campaigns: CampaignSummary[] = useMemo(
    () =>
      (resultsQuery.data ?? []).map((r) => ({
        campaignId: r.externalId,
        campaignSpace: r.space,
        date: r.date,
        status: r.status,
      })),
    [resultsQuery.data],
  );

  const recentCampaigns = useMemo(() => campaigns.slice(0, 3), [campaigns]);

  const boxStats: CampaignBoxStats[] = useMemo(() => {
    const measurements = ndtQuery.data ?? [];
    return recentCampaigns
      .map((c) => {
        const forCampaign = measurements.filter(
          (m) => m.campaignExternalId === c.campaignId,
        );
        return computeBoxStats(c.campaignId, c.date, forCampaign);
      })
      .filter((s): s is CampaignBoxStats => s !== null);
  }, [recentCampaigns, ndtQuery.data]);

  const defectSummary: DefectSummaryRow[] = useMemo(() => {
    const byClass = new Map<string, DefectSummaryRow>();
    for (const d of defectsQuery.data ?? []) {
      const row = byClass.get(d.defectClass) ?? {
        defectClass: d.defectClass,
        total: 0,
        confirmed: 0,
        dismissed: 0,
        underReview: 0,
        newCount: 0,
      };
      row.total++;
      if (d.status === 'Confirmed') row.confirmed++;
      else if (d.status === 'Dismissed') row.dismissed++;
      else if (d.status === 'UnderReview') row.underReview++;
      else if (d.status === 'New') row.newCount++;
      byClass.set(d.defectClass, row);
    }
    return Array.from(byClass.values()).sort((a, b) =>
      a.defectClass.localeCompare(b.defectClass),
    );
  }, [defectsQuery.data]);

  const isLoading =
    resultsQuery.isLoading ||
    ndtQuery.isLoading ||
    areaQuery.isLoading ||
    vesselResult.isLoading ||
    defectsQuery.isLoading;
  const error =
    resultsQuery.error ??
    ndtQuery.error ??
    areaQuery.error ??
    vesselResult.error ??
    defectsQuery.error ??
    null;

  return {
    vesselName: vesselResult.data?.name ?? '',
    areaName: areaQuery.data?.name ?? '',
    campaigns,
    recentCampaigns,
    boxStats,
    defectSummary,
    isLoading,
    error,
  };
}

export { AUTOASSESS_SPACE };
