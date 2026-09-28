import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { createElement } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import {
  useRecommendationsViewModel,
  RecommendationsViewModelContext,
} from './useRecommendationsViewModel';
import type { RecommendationsViewModelContextType } from './useRecommendationsViewModel';
import { createMockInspectionResult } from '../../__mocks__/inspectionResults';
import { createMockNdtMeasurement } from '../../__mocks__/ndtMeasurements';
import { createMockDefectDetection } from '../../__mocks__/defectDetections';
import type { InspectionResult } from '../viewer/InspectionResultService';
import type { DefectDetection } from '../viewer/DefectDetectionService';
import { NDT_REPEAT_THRESHOLD_MM } from './recommendationRules';

// ---- Helpers ----

function makeSuccess<T>(data: T): UseQueryResult<T, Error> {
  return {
    data,
    isLoading: false,
    error: null,
    status: 'success',
    isSuccess: true,
    isError: false,
    isPending: false,
    isFetching: false,
  } as UseQueryResult<T, Error>;
}

function makePending<T>(): UseQueryResult<T, Error> {
  return {
    data: undefined,
    isLoading: true,
    error: null,
    status: 'pending',
    isSuccess: false,
    isError: false,
    isPending: true,
    isFetching: true,
  } as UseQueryResult<T, Error>;
}

function makeError<T>(message: string): UseQueryResult<T, Error> {
  return {
    data: undefined,
    isLoading: false,
    error: new Error(message),
    status: 'error',
    isSuccess: false,
    isError: true,
    isPending: false,
    isFetching: false,
  } as UseQueryResult<T, Error>;
}

const AREA_SPACE = 'autoassess';
const AREA_ID = 'area-01581';

// ---- Tests ----

describe(useRecommendationsViewModel.name, () => {
  let mockContext: RecommendationsViewModelContextType;
  let wrapper: ComponentType<{ children: ReactNode }>;

  const campaign = createMockInspectionResult({ externalId: 'campaign-1', date: '2024-09-15', status: 'Complete' });

  beforeEach(() => {
    mockContext = {
      useInspectionResults: vi.fn(() => makeSuccess([campaign])),
      useNdtMeasurementsForCampaign: vi.fn(() => makeSuccess([])),
      useDefectDetections: vi.fn(() => makeSuccess([])),
    };
    wrapper = ({ children }) =>
      createElement(RecommendationsViewModelContext.Provider, { value: mockContext }, children);
  });

  it('returns empty recommendations when all data is empty', () => {
    const { result } = renderHook(() => useRecommendationsViewModel(AREA_SPACE, AREA_ID), { wrapper });
    expect(result.current.recommendations).toHaveLength(0);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('returns NDT repeat recommendation when measurement is below threshold', () => {
    const lowMeasurement = createMockNdtMeasurement({
      externalId: 'ndt-low',
      thicknessMm: NDT_REPEAT_THRESHOLD_MM - 1,
    });
    vi.mocked(mockContext.useNdtMeasurementsForCampaign).mockReturnValue(
      makeSuccess([lowMeasurement]),
    );

    const { result } = renderHook(() => useRecommendationsViewModel(AREA_SPACE, AREA_ID), { wrapper });
    expect(result.current.recommendations).toHaveLength(1);
    expect(result.current.recommendations[0].kind).toBe('ndt_repeat');
    expect(result.current.recommendations[0].id).toBe('ndt_repeat:ndt-low');
  });

  it('returns confirmed defect recommendation when defect is confirmed', () => {
    const confirmed = createMockDefectDetection({
      externalId: 'defect-confirmed',
      status: 'Confirmed',
      campaignExternalId: 'campaign-1',
    });
    vi.mocked(mockContext.useDefectDetections).mockReturnValue(makeSuccess([confirmed]));

    const { result } = renderHook(() => useRecommendationsViewModel(AREA_SPACE, AREA_ID), { wrapper });
    expect(result.current.recommendations).toHaveLength(1);
    expect(result.current.recommendations[0].kind).toBe('confirmed_defect');
    expect(result.current.recommendations[0].id).toBe('confirmed_defect:defect-confirmed');
  });

  it('combines NDT and defect recommendations', () => {
    const lowMeasurement = createMockNdtMeasurement({
      externalId: 'ndt-x',
      thicknessMm: 5,
    });
    const confirmed = createMockDefectDetection({
      externalId: 'def-y',
      status: 'Confirmed',
      campaignExternalId: 'campaign-1',
    });
    vi.mocked(mockContext.useNdtMeasurementsForCampaign).mockReturnValue(makeSuccess([lowMeasurement]));
    vi.mocked(mockContext.useDefectDetections).mockReturnValue(makeSuccess([confirmed]));

    const { result } = renderHook(() => useRecommendationsViewModel(AREA_SPACE, AREA_ID), { wrapper });
    expect(result.current.recommendations).toHaveLength(2);
  });

  it('uses only the latest complete campaign for NDT recommendations', () => {
    const inProgress = createMockInspectionResult({
      externalId: 'campaign-new',
      date: '2025-01-01',
      status: 'InProgress',
    });
    const complete = createMockInspectionResult({
      externalId: 'campaign-old',
      date: '2024-06-01',
      status: 'Complete',
    });
    vi.mocked(mockContext.useInspectionResults).mockReturnValue(makeSuccess([inProgress, complete]));

    renderHook(() => useRecommendationsViewModel(AREA_SPACE, AREA_ID), { wrapper });

    // Should fetch NDT for the complete campaign (first complete in sorted-by-date list)
    expect(vi.mocked(mockContext.useNdtMeasurementsForCampaign)).toHaveBeenCalledWith(
      complete.space,
      complete.externalId,
    );
  });

  it('does not fetch NDT when there are no complete campaigns', () => {
    const inProgress = createMockInspectionResult({
      externalId: 'campaign-wip',
      status: 'InProgress',
    });
    vi.mocked(mockContext.useInspectionResults).mockReturnValue(makeSuccess([inProgress]));

    renderHook(() => useRecommendationsViewModel(AREA_SPACE, AREA_ID), { wrapper });

    // useNdtMeasurementsForCampaign called with empty strings (disabled by the hook)
    expect(vi.mocked(mockContext.useNdtMeasurementsForCampaign)).toHaveBeenCalledWith('', '');
  });

  it('reflects loading state when any query is pending', () => {
    vi.mocked(mockContext.useInspectionResults).mockReturnValue(makePending<InspectionResult[]>());

    const { result } = renderHook(() => useRecommendationsViewModel(AREA_SPACE, AREA_ID), { wrapper });
    expect(result.current.isLoading).toBe(true);
  });

  it('surfaces an error when any query fails', () => {
    vi.mocked(mockContext.useDefectDetections).mockReturnValue(makeError<DefectDetection[]>('network error'));

    const { result } = renderHook(() => useRecommendationsViewModel(AREA_SPACE, AREA_ID), { wrapper });
    expect(result.current.error?.message).toBe('network error');
  });

  it('returns no NDT recommendations when measurement is above threshold', () => {
    const okMeasurement = createMockNdtMeasurement({
      externalId: 'ndt-ok',
      thicknessMm: NDT_REPEAT_THRESHOLD_MM + 1,
    });
    vi.mocked(mockContext.useNdtMeasurementsForCampaign).mockReturnValue(makeSuccess([okMeasurement]));

    const { result } = renderHook(() => useRecommendationsViewModel(AREA_SPACE, AREA_ID), { wrapper });
    expect(result.current.recommendations).toHaveLength(0);
  });
});
