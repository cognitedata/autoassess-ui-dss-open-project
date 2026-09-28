import { render, screen } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createElement } from 'react';

import { createMockInspectionResult } from '../../__mocks__/inspectionResults';
import { createMockNdtMeasurement } from '../../__mocks__/ndtMeasurements';
import { createMockArea } from '../../__mocks__/areas';
import { createMockDefectDetection } from '../../__mocks__/defectDetections';
import { createMockVessel } from '../../__mocks__/vessels';

import { AreaReportPage, AreaReportViewModelContext } from './AreaReportPage';
import type { AreaReportViewModelContextType } from './AreaReportPage';

vi.mock('./NdtBoxPlot', () => ({
  NdtBoxPlot: vi.fn(() => <div data-testid="ndt-box-plot" />),
}));

function makeSuccessResult<T>(data: T): UseQueryResult<T, Error> {
  return { data, isLoading: false, error: null, status: 'success' as const, isSuccess: true, isError: false, isPending: false, isFetching: false } as UseQueryResult<T, Error>;
}
function makePendingResult<T = never>(): UseQueryResult<T, Error> {
  return { data: undefined, isLoading: true, error: null, status: 'pending' as const, isSuccess: false, isError: false, isPending: true, isFetching: true } as UseQueryResult<T, Error>;
}
function makeErrorResult<T = never>(err: Error): UseQueryResult<T, Error> {
  return { data: undefined, isLoading: false, error: err, status: 'error' as const, isSuccess: false, isError: true, isPending: false, isFetching: false } as UseQueryResult<T, Error>;
}

function renderPage(
  mockContext: AreaReportViewModelContextType,
  path = '/vessels/vessel-1/areas/area-01581/report',
) {
  return render(
    createElement(
      AreaReportViewModelContext.Provider,
      { value: mockContext },
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/vessels/:vesselId/areas/:areaId/report"
            element={<AreaReportPage />}
          />
          <Route
            path="/vessels/:vesselId/areas/:areaId/report/:campaignId"
            element={<div data-testid="campaign-report-page" />}
          />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

describe(AreaReportPage.name, () => {
  let mockContext: AreaReportViewModelContextType;

  beforeEach(() => {
    mockContext = {
      useInspectionResults: vi.fn(() => makeSuccessResult([createMockInspectionResult({ externalId: 'r1', date: '2024-09-15' })])),
      useNdtMeasurements: vi.fn(() => makeSuccessResult([createMockNdtMeasurement({ campaignExternalId: 'r1' })])),
      useArea: vi.fn(() => makeSuccessResult(createMockArea({ name: 'BWT Port Side' }))),
      useVessel: vi.fn(() => ({
        data: createMockVessel({ name: 'Test Vessel' }),
        isLoading: false,
        error: null,
      })),
      useDefectDetections: vi.fn(() => makeSuccessResult([createMockDefectDetection({ defectClass: 'corrosion', status: 'New' })])),
    };
  });

  it('should render the page heading', () => {
    renderPage(mockContext);
    expect(screen.getByRole('heading', { name: 'Summary' })).toBeInTheDocument();
  });

  it('should show vessel and area name as a subtitle', () => {
    renderPage(mockContext);
    expect(screen.getByText('Test Vessel · BWT Port Side')).toBeInTheDocument();
  });

  it('should render Loader while loading', () => {
    vi.mocked(mockContext.useInspectionResults).mockReturnValue(makePendingResult());
    renderPage(mockContext);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('should render Alert on error', () => {
    vi.mocked(mockContext.useInspectionResults).mockReturnValue(makeErrorResult(new Error('CDF failure')));
    renderPage(mockContext);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('should render the NDT box plot', () => {
    renderPage(mockContext);
    expect(screen.getByTestId('ndt-box-plot')).toBeInTheDocument();
  });

  it('should render a campaign card with the campaign date', () => {
    renderPage(mockContext);
    expect(screen.getByRole('button', { name: /2024-09-15/i })).toBeInTheDocument();
  });

  it('should navigate to campaign report when a campaign card is clicked', async () => {
    const user = userEvent.setup();
    renderPage(mockContext);

    await user.click(screen.getByRole('button', { name: /2024-09-15/i }));

    expect(screen.getByTestId('campaign-report-page')).toBeInTheDocument();
  });

  it('should show empty state when there are no campaigns', () => {
    vi.mocked(mockContext.useInspectionResults).mockReturnValue(makeSuccessResult([]));
    renderPage(mockContext);
    expect(screen.getByText(/no inspection campaigns found/i)).toBeInTheDocument();
  });

  it('should show defect detections section', () => {
    renderPage(mockContext);
    expect(screen.getByRole('heading', { name: 'Defect Detections' })).toBeInTheDocument();
  });
});
