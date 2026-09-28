import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ComponentType, ReactNode } from 'react';
import { createElement } from 'react';

import { createMockInspectionResult } from '../../__mocks__/inspectionResults';
import { createMockNdtMeasurement } from '../../__mocks__/ndtMeasurements';
import { createMockDroneImage } from '../../__mocks__/droneImages';
import { createMockArea } from '../../__mocks__/areas';
import { createMockVessel } from '../../__mocks__/vessels';
import type { CampaignMetric } from '../viewer/CampaignMetricService';

import {
  useCampaignReportViewModel,
  CampaignReportViewModelContext,
} from './useCampaignReportViewModel';
import type { CampaignReportViewModelContextType } from './useCampaignReportViewModel';

function makeSuccessResult<T>(data: T): UseQueryResult<T, Error> {
  return { data, isLoading: false, error: null, status: 'success' as const, isSuccess: true, isError: false, isPending: false, isFetching: false } as UseQueryResult<T, Error>;
}
function makePendingResult<T = never>(): UseQueryResult<T, Error> {
  return { data: undefined, isLoading: true, error: null, status: 'pending' as const, isSuccess: false, isError: false, isPending: true, isFetching: true } as UseQueryResult<T, Error>;
}
function makeErrorResult<T = never>(err: Error): UseQueryResult<T, Error> {
  return { data: undefined, isLoading: false, error: err, status: 'error' as const, isSuccess: false, isError: true, isPending: false, isFetching: false } as UseQueryResult<T, Error>;
}

describe(useCampaignReportViewModel.name, () => {
  const CAMPAIGN_ID = 'result-01581';
  const AREA_SPACE = 'autoassess';
  const AREA_ID = 'area-01581';
  const VESSEL_ID = 'vessel-test';

  let mockContext: CampaignReportViewModelContextType;
  let wrapper: ComponentType<{ children: ReactNode }>;

  beforeEach(() => {
    mockContext = {
      useNdtMeasurementsForCampaign: vi.fn(() => makeSuccessResult([
        createMockNdtMeasurement({ thicknessMm: 10, timestamp: '2024-09-15T10:00:00Z' }),
        createMockNdtMeasurement({ thicknessMm: 14, timestamp: '2024-09-15T08:00:00Z' }),
      ])),
      useCampaignMetrics: vi.fn(() => makeSuccessResult([] as CampaignMetric[])),
      useInspectionResults: vi.fn(() => makeSuccessResult([
        createMockInspectionResult({ externalId: CAMPAIGN_ID, date: '2024-09-15', status: 'Complete' }),
      ])),
      useArea: vi.fn(() => makeSuccessResult(createMockArea({ name: 'BWT Port Side' }))),
      useVessel: vi.fn(() => ({
        data: createMockVessel({ name: 'Test Vessel' }),
        isLoading: false,
        error: null,
      })),
      useDroneImagesForCampaign: vi.fn(() => makeSuccessResult([])),
    };
    wrapper = ({ children }) =>
      createElement(CampaignReportViewModelContext.Provider, { value: mockContext }, children);
  });

  it('should return isLoading=true while any query is loading', () => {
    vi.mocked(mockContext.useNdtMeasurementsForCampaign).mockReturnValue(makePendingResult());

    const { result } = renderHook(
      () => useCampaignReportViewModel(AREA_SPACE, AREA_ID, CAMPAIGN_ID, VESSEL_ID),
      { wrapper },
    );

    expect(result.current.isLoading).toBe(true);
  });

  it('should return error when a query fails', () => {
    const error = new Error('CDF failure');
    vi.mocked(mockContext.useInspectionResults).mockReturnValue(makeErrorResult(error));

    const { result } = renderHook(
      () => useCampaignReportViewModel(AREA_SPACE, AREA_ID, CAMPAIGN_ID, VESSEL_ID),
      { wrapper },
    );

    expect(result.current.error).toBe(error);
  });

  it('should extract campaignDate and campaignStatus from matching InspectionResult', () => {
    const { result } = renderHook(
      () => useCampaignReportViewModel(AREA_SPACE, AREA_ID, CAMPAIGN_ID, VESSEL_ID),
      { wrapper },
    );

    expect(result.current.campaignDate).toBe('2024-09-15');
    expect(result.current.campaignStatus).toBe('Complete');
  });

  it('should count measurements correctly', () => {
    const { result } = renderHook(
      () => useCampaignReportViewModel(AREA_SPACE, AREA_ID, CAMPAIGN_ID, VESSEL_ID),
      { wrapper },
    );

    expect(result.current.measurementCount).toBe(2);
  });

  it('should sort measurements by timestamp descending', () => {
    const { result } = renderHook(
      () => useCampaignReportViewModel(AREA_SPACE, AREA_ID, CAMPAIGN_ID, VESSEL_ID),
      { wrapper },
    );

    expect(result.current.measurements[0].timestamp).toBe('2024-09-15T10:00:00Z');
    expect(result.current.measurements[1].timestamp).toBe('2024-09-15T08:00:00Z');
  });

  it('should return medianThicknessMm from measurements', () => {
    const { result } = renderHook(
      () => useCampaignReportViewModel(AREA_SPACE, AREA_ID, CAMPAIGN_ID, VESSEL_ID),
      { wrapper },
    );

    expect(result.current.medianThicknessMm).toBe(12);
  });

  it('should return vessel name from useVessel', () => {
    const { result } = renderHook(
      () => useCampaignReportViewModel(AREA_SPACE, AREA_ID, CAMPAIGN_ID, VESSEL_ID),
      { wrapper },
    );

    expect(result.current.vesselName).toBe('Test Vessel');
  });

  it('should return area name from useArea', () => {
    const { result } = renderHook(
      () => useCampaignReportViewModel(AREA_SPACE, AREA_ID, CAMPAIGN_ID, VESSEL_ID),
      { wrapper },
    );

    expect(result.current.areaName).toBe('BWT Port Side');
  });

  it('should return null medianThicknessMm when no measurements', () => {
    vi.mocked(mockContext.useNdtMeasurementsForCampaign).mockReturnValue(makeSuccessResult([]));

    const { result } = renderHook(
      () => useCampaignReportViewModel(AREA_SPACE, AREA_ID, CAMPAIGN_ID, VESSEL_ID),
      { wrapper },
    );

    expect(result.current.medianThicknessMm).toBeNull();
  });

  it('should return metrics from useCampaignMetrics', () => {
    const mockMetrics: CampaignMetric[] = [
      {
        space: 'autoassess',
        externalId: 'result-01581-metric-coverage',
        campaignExternalId: CAMPAIGN_ID,
        name: 'Coverage',
        value: 91.3,
        unit: 'percentage',
      },
    ];
    vi.mocked(mockContext.useCampaignMetrics).mockReturnValue(makeSuccessResult(mockMetrics));

    const { result } = renderHook(
      () => useCampaignReportViewModel(AREA_SPACE, AREA_ID, CAMPAIGN_ID, VESSEL_ID),
      { wrapper },
    );

    expect(result.current.metrics).toEqual(mockMetrics);
  });

  it('should return empty metrics array when useCampaignMetrics has no data', () => {
    vi.mocked(mockContext.useCampaignMetrics).mockReturnValue(makePendingResult());

    const { result } = renderHook(
      () => useCampaignReportViewModel(AREA_SPACE, AREA_ID, CAMPAIGN_ID, VESSEL_ID),
      { wrapper },
    );

    expect(result.current.metrics).toEqual([]);
  });

  it('should return isLoading=true when metrics query is loading', () => {
    vi.mocked(mockContext.useCampaignMetrics).mockReturnValue(makePendingResult());

    const { result } = renderHook(
      () => useCampaignReportViewModel(AREA_SPACE, AREA_ID, CAMPAIGN_ID, VESSEL_ID),
      { wrapper },
    );

    expect(result.current.isLoading).toBe(true);
  });

  it('should return images sorted by timestamp ascending', () => {
    const older = createMockDroneImage({ timestamp: 1000 });
    const newer = createMockDroneImage({ timestamp: 2000 });
    vi.mocked(mockContext.useDroneImagesForCampaign).mockReturnValue(makeSuccessResult([newer, older]));

    const { result } = renderHook(
      () => useCampaignReportViewModel(AREA_SPACE, AREA_ID, CAMPAIGN_ID, VESSEL_ID),
      { wrapper },
    );

    expect(result.current.images[0].timestamp).toBe(1000);
    expect(result.current.images[1].timestamp).toBe(2000);
  });

  it('should return empty images array when useDroneImagesForCampaign has no data', () => {
    vi.mocked(mockContext.useDroneImagesForCampaign).mockReturnValue(makePendingResult());

    const { result } = renderHook(
      () => useCampaignReportViewModel(AREA_SPACE, AREA_ID, CAMPAIGN_ID, VESSEL_ID),
      { wrapper },
    );

    expect(result.current.images).toEqual([]);
  });

  it('should expose imagesIsLoading separately from main isLoading', () => {
    vi.mocked(mockContext.useDroneImagesForCampaign).mockReturnValue(makePendingResult());

    const { result } = renderHook(
      () => useCampaignReportViewModel(AREA_SPACE, AREA_ID, CAMPAIGN_ID, VESSEL_ID),
      { wrapper },
    );

    expect(result.current.imagesIsLoading).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it('should expose imagesError separately from main error', () => {
    const imagesError = new Error('Images CDF failure');
    vi.mocked(mockContext.useDroneImagesForCampaign).mockReturnValue(makeErrorResult(imagesError));

    const { result } = renderHook(
      () => useCampaignReportViewModel(AREA_SPACE, AREA_ID, CAMPAIGN_ID, VESSEL_ID),
      { wrapper },
    );

    expect(result.current.imagesError).toBe(imagesError);
    expect(result.current.error).toBeNull();
  });
});
