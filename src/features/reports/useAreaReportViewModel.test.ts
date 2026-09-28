import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ComponentType, ReactNode } from 'react';
import { createElement } from 'react';

import { createMockArea } from '../../__mocks__/areas';
import { createMockInspectionResult } from '../../__mocks__/inspectionResults';
import { createMockNdtMeasurement } from '../../__mocks__/ndtMeasurements';
import { createMockDefectDetection } from '../../__mocks__/defectDetections';
import { createMockVessel } from '../../__mocks__/vessels';

import {
  useAreaReportViewModel,
  AreaReportViewModelContext,
} from './useAreaReportViewModel';
import type { AreaReportViewModelContextType } from './useAreaReportViewModel';

function makeSuccessResult<T>(data: T): UseQueryResult<T, Error> {
  return { data, isLoading: false, error: null, status: 'success' as const, isSuccess: true, isError: false, isPending: false, isFetching: false } as UseQueryResult<T, Error>;
}
function makePendingResult<T = never>(): UseQueryResult<T, Error> {
  return { data: undefined, isLoading: true, error: null, status: 'pending' as const, isSuccess: false, isError: false, isPending: true, isFetching: true } as UseQueryResult<T, Error>;
}
function makeErrorResult<T = never>(err: Error): UseQueryResult<T, Error> {
  return { data: undefined, isLoading: false, error: err, status: 'error' as const, isSuccess: false, isError: true, isPending: false, isFetching: false } as UseQueryResult<T, Error>;
}

describe(useAreaReportViewModel.name, () => {
  let mockContext: AreaReportViewModelContextType;
  let wrapper: ComponentType<{ children: ReactNode }>;

  beforeEach(() => {
    mockContext = {
      useInspectionResults: vi.fn(() => makeSuccessResult([
        createMockInspectionResult({ externalId: 'r1', date: '2024-09-15' }),
        createMockInspectionResult({ externalId: 'r2', date: '2024-03-01' }),
      ])),
      useNdtMeasurements: vi.fn(() => makeSuccessResult([
        createMockNdtMeasurement({ campaignExternalId: 'r1', thicknessMm: 10 }),
        createMockNdtMeasurement({ campaignExternalId: 'r1', thicknessMm: 12 }),
        createMockNdtMeasurement({ campaignExternalId: 'r2', thicknessMm: 14 }),
      ])),
      useArea: vi.fn(() => makeSuccessResult(createMockArea({ name: 'BWT Port Side' }))),
      useVessel: vi.fn(() => ({
        data: createMockVessel({ name: 'Test Vessel' }),
        isLoading: false,
        error: null,
      })),
      useDefectDetections: vi.fn(() => makeSuccessResult([
        createMockDefectDetection({ defectClass: 'corrosion', status: 'Confirmed' }),
        createMockDefectDetection({ defectClass: 'corrosion', status: 'New' }),
        createMockDefectDetection({ defectClass: 'crack', status: 'New' }),
      ])),
    };
    wrapper = ({ children }) =>
      createElement(AreaReportViewModelContext.Provider, { value: mockContext }, children);
  });

  it('should return isLoading=true while any query is loading', () => {
    vi.mocked(mockContext.useInspectionResults).mockReturnValue(makePendingResult());

    const { result } = renderHook(
      () => useAreaReportViewModel('autoassess', 'area-01581', 'vessel-test'),
      { wrapper },
    );

    expect(result.current.isLoading).toBe(true);
  });

  it('should return error when a query fails', () => {
    const error = new Error('CDF failure');
    vi.mocked(mockContext.useNdtMeasurements).mockReturnValue(makeErrorResult(error));

    const { result } = renderHook(
      () => useAreaReportViewModel('autoassess', 'area-01581', 'vessel-test'),
      { wrapper },
    );

    expect(result.current.error).toBe(error);
  });

  it('should return area name from useArea', () => {
    const { result } = renderHook(
      () => useAreaReportViewModel('autoassess', 'area-01581', 'vessel-test'),
      { wrapper },
    );

    expect(result.current.areaName).toBe('BWT Port Side');
  });

  it('should return empty areaName when area data is unavailable', () => {
    vi.mocked(mockContext.useArea).mockReturnValue(makePendingResult());

    const { result } = renderHook(
      () => useAreaReportViewModel('autoassess', 'area-01581', 'vessel-test'),
      { wrapper },
    );

    expect(result.current.areaName).toBe('');
  });

  it('should return vessel name from useVessel', () => {
    const { result } = renderHook(
      () => useAreaReportViewModel('autoassess', 'area-01581', 'vessel-test'),
      { wrapper },
    );

    expect(result.current.vesselName).toBe('Test Vessel');
  });

  it('should return empty vesselName when vessel data is unavailable', () => {
    vi.mocked(mockContext.useVessel).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    });

    const { result } = renderHook(
      () => useAreaReportViewModel('autoassess', 'area-01581', 'vessel-test'),
      { wrapper },
    );

    expect(result.current.vesselName).toBe('');
  });

  it('should return all campaigns sorted desc by date', () => {
    const { result } = renderHook(
      () => useAreaReportViewModel('autoassess', 'area-01581', 'vessel-test'),
      { wrapper },
    );

    expect(result.current.campaigns).toHaveLength(2);
    expect(result.current.campaigns[0].campaignId).toBe('r1');
    expect(result.current.campaigns[1].campaignId).toBe('r2');
  });

  it('should limit recentCampaigns to at most 3', () => {
    vi.mocked(mockContext.useInspectionResults).mockReturnValue(makeSuccessResult([
      createMockInspectionResult({ externalId: 'r1', date: '2024-09-15' }),
      createMockInspectionResult({ externalId: 'r2', date: '2024-06-01' }),
      createMockInspectionResult({ externalId: 'r3', date: '2024-03-01' }),
      createMockInspectionResult({ externalId: 'r4', date: '2023-09-15' }),
    ]));

    const { result } = renderHook(
      () => useAreaReportViewModel('autoassess', 'area-01581', 'vessel-test'),
      { wrapper },
    );

    expect(result.current.campaigns).toHaveLength(4);
    expect(result.current.recentCampaigns).toHaveLength(3);
    expect(result.current.recentCampaigns.map((c) => c.campaignId)).toEqual(['r1', 'r2', 'r3']);
  });

  it('should compute boxStats for recent campaigns with measurements', () => {
    const { result } = renderHook(
      () => useAreaReportViewModel('autoassess', 'area-01581', 'vessel-test'),
      { wrapper },
    );

    expect(result.current.boxStats).toHaveLength(2);
    const r1Stats = result.current.boxStats.find((s) => s.campaignId === 'r1');
    expect(r1Stats?.n).toBe(2);
    expect(r1Stats?.min).toBe(10);
    expect(r1Stats?.max).toBe(12);
  });

  it('should omit boxStats for campaigns with no measurements', () => {
    vi.mocked(mockContext.useNdtMeasurements).mockReturnValue(makeSuccessResult([]));

    const { result } = renderHook(
      () => useAreaReportViewModel('autoassess', 'area-01581', 'vessel-test'),
      { wrapper },
    );

    expect(result.current.boxStats).toHaveLength(0);
  });

  it('should aggregate defects across all campaigns grouped by class', () => {
    const { result } = renderHook(
      () => useAreaReportViewModel('autoassess', 'area-01581', 'vessel-test'),
      { wrapper },
    );

    expect(result.current.defectSummary).toHaveLength(2);
    const corrosion = result.current.defectSummary.find((r) => r.defectClass === 'corrosion');
    expect(corrosion?.total).toBe(2);
    expect(corrosion?.confirmed).toBe(1);
    expect(corrosion?.newCount).toBe(1);
    const crack = result.current.defectSummary.find((r) => r.defectClass === 'crack');
    expect(crack?.total).toBe(1);
  });

  it('should return empty defectSummary when no defects exist', () => {
    vi.mocked(mockContext.useDefectDetections).mockReturnValue(makeSuccessResult([]));

    const { result } = renderHook(
      () => useAreaReportViewModel('autoassess', 'area-01581', 'vessel-test'),
      { wrapper },
    );

    expect(result.current.defectSummary).toHaveLength(0);
  });
});
