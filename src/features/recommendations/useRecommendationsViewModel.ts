import { createContext, useContext, useMemo } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';

import { useInspectionResults } from '../viewer/useInspectionResults';
import type { InspectionResult } from '../viewer/InspectionResultService';
import { useNdtMeasurementsForCampaign } from '../reports/useNdtMeasurementsForCampaign';
import type { NdtMeasurement } from '../viewer/NdtMeasurementService';
import { useDefectDetections } from '../viewer/useDefectDetections';
import type { DefectDetection } from '../viewer/DefectDetectionService';
import { ndtRepeatRecommendations, confirmedDefectRecommendations } from './recommendationRules';
import type { Recommendation } from './types';

// ---- Dependency injection types ----

type UseInspectionResultsFn = (
  areaSpace: string,
  areaExternalId: string,
) => UseQueryResult<InspectionResult[], Error>;

type UseNdtMeasurementsForCampaignFn = (
  campaignSpace: string,
  campaignExternalId: string,
) => UseQueryResult<NdtMeasurement[], Error>;

type UseDefectDetectionsFn = (
  areaSpace: string,
  areaExternalId: string,
) => UseQueryResult<DefectDetection[], Error>;

export type RecommendationsViewModelContextType = {
  useInspectionResults: UseInspectionResultsFn;
  useNdtMeasurementsForCampaign: UseNdtMeasurementsForCampaignFn;
  useDefectDetections: UseDefectDetectionsFn;
};

const defaultDeps: RecommendationsViewModelContextType = {
  useInspectionResults,
  useNdtMeasurementsForCampaign,
  useDefectDetections,
};

export const RecommendationsViewModelContext =
  createContext<RecommendationsViewModelContextType>(defaultDeps);

// ---- Public interface ----

export interface RecommendationsViewModel {
  recommendations: Recommendation[];
  isLoading: boolean;
  error: Error | null;
}

// ---- Implementation ----

export function useRecommendationsViewModel(
  areaSpace: string,
  areaExternalId: string,
): RecommendationsViewModel {
  const {
    useInspectionResults: useResultsDep,
    useNdtMeasurementsForCampaign: useNdtDep,
    useDefectDetections: useDefectsDep,
  } = useContext(RecommendationsViewModelContext);

  const resultsQuery = useResultsDep(areaSpace, areaExternalId);

  // Pick the latest complete campaign for NDT repeat recommendations.
  const latestCompleteCampaign = useMemo(() => {
    return (resultsQuery.data ?? []).find((r) => r.status === 'Complete') ?? null;
  }, [resultsQuery.data]);

  const ndtQuery = useNdtDep(
    latestCompleteCampaign?.space ?? '',
    latestCompleteCampaign?.externalId ?? '',
  );

  const defectsQuery = useDefectsDep(areaSpace, areaExternalId);

  const recommendations: Recommendation[] = useMemo(() => {
    const campaigns = resultsQuery.data ?? [];
    const measurements = ndtQuery.data ?? [];
    const defects = defectsQuery.data ?? [];

    const ndtRecs = latestCompleteCampaign
      ? ndtRepeatRecommendations(measurements, latestCompleteCampaign.date)
      : [];
    const defectRecs = confirmedDefectRecommendations(defects, campaigns);

    return [...ndtRecs, ...defectRecs];
  }, [resultsQuery.data, ndtQuery.data, defectsQuery.data, latestCompleteCampaign]);

  const isLoading =
    resultsQuery.isLoading || ndtQuery.isLoading || defectsQuery.isLoading;
  const error = resultsQuery.error ?? ndtQuery.error ?? defectsQuery.error ?? null;

  return { recommendations, isLoading, error };
}
