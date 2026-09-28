import { createContext, useContext, useMemo } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';

import type { Area } from '../areas/AreaService';
import { useArea } from '../viewer/useArea';
import type { InspectionResult } from '../viewer/InspectionResultService';
import { useInspectionResults } from '../viewer/useInspectionResults';
import type { NdtMeasurement } from '../viewer/NdtMeasurementService';
import type { CampaignMetric } from '../viewer/CampaignMetricService';
import type { DroneImage } from '../viewer/DroneImageService';
import type { Vessel } from '../vessels/VesselService';
import { useVessel } from '../vessels/useVessel';
import { computeBoxStats } from './ndtStats';
import type { CampaignBoxStats } from './ndtStats';
import { useNdtMeasurementsForCampaign } from './useNdtMeasurementsForCampaign';
import { useCampaignMetrics } from './useCampaignMetrics';
import { useDroneImagesForCampaign } from './useDroneImagesForCampaign';
import { AUTOASSESS_SPACE } from '../../shared/cdf/dataModel';

export interface CampaignReportViewModel {
  vesselName: string;
  areaName: string;
  campaignDate: string;
  campaignStatus: InspectionResult['status'];
  measurementCount: number;
  medianThicknessMm: number | null;
  boxStats: CampaignBoxStats | null;
  /** NDT measurements for this campaign, sorted by timestamp descending. */
  measurements: NdtMeasurement[];
  /** Campaign-level metrics from the metrics.yaml file. */
  metrics: CampaignMetric[];
  /** Drone images for this campaign, sorted by timestamp ascending. */
  images: DroneImage[];
  /** Separate from isLoading so images don't block the Overview/NDT tabs. */
  imagesIsLoading: boolean;
  imagesError: Error | null;
  isLoading: boolean;
  error: Error | null;
}

type UseNdtMeasurementsForCampaignFn = (
  campaignSpace: string,
  campaignExternalId: string,
) => UseQueryResult<NdtMeasurement[], Error>;

type UseCampaignMetricsFn = (
  campaignSpace: string,
  campaignExternalId: string,
) => UseQueryResult<CampaignMetric[], Error>;

type UseInspectionResultsFn = (
  areaSpace: string,
  areaExternalId: string,
) => UseQueryResult<InspectionResult[], Error>;

type UseAreaFn = (space: string, externalId: string) => UseQueryResult<Area, Error>;

type UseVesselFn = (
  externalId: string,
) => { data: Vessel | undefined; isLoading: boolean; error: Error | null };

type UseDroneImagesForCampaignFn = (
  campaignSpace: string,
  campaignExternalId: string,
) => UseQueryResult<DroneImage[], Error>;

export type CampaignReportViewModelContextType = {
  useNdtMeasurementsForCampaign: UseNdtMeasurementsForCampaignFn;
  useCampaignMetrics: UseCampaignMetricsFn;
  useInspectionResults: UseInspectionResultsFn;
  useArea: UseAreaFn;
  useVessel: UseVesselFn;
  useDroneImagesForCampaign: UseDroneImagesForCampaignFn;
};

const defaultDeps: CampaignReportViewModelContextType = {
  useNdtMeasurementsForCampaign,
  useCampaignMetrics,
  useInspectionResults,
  useArea,
  useVessel,
  useDroneImagesForCampaign,
};

export const CampaignReportViewModelContext =
  createContext<CampaignReportViewModelContextType>(defaultDeps);

export function useCampaignReportViewModel(
  areaSpace: string,
  areaExternalId: string,
  campaignId: string,
  vesselId: string,
): CampaignReportViewModel {
  const {
    useNdtMeasurementsForCampaign: useNdtDep,
    useCampaignMetrics: useMetricsDep,
    useInspectionResults: useResultsDep,
    useArea: useAreaDep,
    useVessel: useVesselDep,
    useDroneImagesForCampaign: useImagesDep,
  } = useContext(CampaignReportViewModelContext);

  const ndtQuery = useNdtDep(areaSpace, campaignId);
  const metricsQuery = useMetricsDep(areaSpace, campaignId);
  const resultsQuery = useResultsDep(areaSpace, areaExternalId);
  const areaQuery = useAreaDep(areaSpace, areaExternalId);
  const vesselResult = useVesselDep(vesselId);
  const imagesQuery = useImagesDep(areaSpace, campaignId);

  const measurements: NdtMeasurement[] = useMemo(() => {
    return (ndtQuery.data ?? [])
      .slice()
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [ndtQuery.data]);

  // Sort by the explicit timestamp field (Unix seconds) — never by filename
  const images: DroneImage[] = useMemo(
    () => (imagesQuery.data ?? []).slice().sort((a, b) => a.timestamp - b.timestamp),
    [imagesQuery.data],
  );

  const boxStats: CampaignBoxStats | null = useMemo(
    () => computeBoxStats(campaignId, '', ndtQuery.data ?? []),
    [campaignId, ndtQuery.data],
  );

  const campaign = (resultsQuery.data ?? []).find((r) => r.externalId === campaignId);

  const isLoading =
    ndtQuery.isLoading ||
    metricsQuery.isLoading ||
    resultsQuery.isLoading ||
    areaQuery.isLoading ||
    vesselResult.isLoading;
  const error =
    ndtQuery.error ??
    metricsQuery.error ??
    resultsQuery.error ??
    areaQuery.error ??
    vesselResult.error ??
    null;

  return {
    vesselName: vesselResult.data?.name ?? '',
    areaName: areaQuery.data?.name ?? '',
    campaignDate: campaign?.date ?? '',
    campaignStatus: campaign?.status ?? 'Complete',
    measurementCount: measurements.length,
    medianThicknessMm: boxStats?.median ?? null,
    boxStats,
    measurements,
    metrics: metricsQuery.data ?? [],
    images,
    imagesIsLoading: imagesQuery.isLoading,
    imagesError: imagesQuery.error ?? null,
    isLoading,
    error,
  };
}

export { AUTOASSESS_SPACE };
