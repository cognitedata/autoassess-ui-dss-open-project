import { render, screen } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createElement } from 'react';

import { createMockInspectionResult } from '../../__mocks__/inspectionResults';
import { ReportShell, ReportShellContext } from './ReportShell';
import type { ReportShellContextType } from './ReportShell';

function makeSuccessResult<T>(data: T): UseQueryResult<T, Error> {
  return { data, isLoading: false, error: null, status: 'success' as const, isSuccess: true, isError: false, isPending: false, isFetching: false } as UseQueryResult<T, Error>;
}

const AREA_PATH = '/vessels/vessel-1/areas/area-01581/report';

function renderShell(mockContext: ReportShellContextType, path = AREA_PATH) {
  return render(
    createElement(
      ReportShellContext.Provider,
      { value: mockContext },
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/vessels/:vesselId/areas/:areaId/report" element={<ReportShell />}>
            <Route index element={<div data-testid="area-report-page" />} />
            <Route path=":campaignId" element={<div data-testid="campaign-report-page" />} />
          </Route>
          <Route
            path="/vessels/:vesselId/areas/:areaId"
            element={<div data-testid="viewer-page" />}
          />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

describe(ReportShell.name, () => {
  let mockContext: ReportShellContextType;

  beforeEach(() => {
    mockContext = {
      useInspectionResults: vi.fn(() => makeSuccessResult([
        createMockInspectionResult({ externalId: 'r1', date: '2024-09-15' }),
        createMockInspectionResult({ externalId: 'r2', date: '2024-08-10' }),
      ])),
    };
  });

  it('should render the Summary nav item', () => {
    renderShell(mockContext);
    expect(screen.getByRole('link', { name: 'Summary' })).toBeInTheDocument();
  });

  it('should render a nav item for each campaign', () => {
    renderShell(mockContext);
    expect(screen.getByRole('link', { name: '2024-09-15' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '2024-08-10' })).toBeInTheDocument();
  });

  it('should mark Summary as active on the area report route', () => {
    renderShell(mockContext, AREA_PATH);
    expect(screen.getByRole('link', { name: 'Summary' })).toHaveAttribute('aria-current', 'page');
  });

  it('should not mark Summary as active on a campaign route', () => {
    renderShell(mockContext, `${AREA_PATH}/r1`);
    expect(screen.getByRole('link', { name: 'Summary' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('should mark the matching campaign as active on its route', () => {
    renderShell(mockContext, `${AREA_PATH}/r1`);
    expect(screen.getByRole('link', { name: '2024-09-15' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('should navigate to the 3D viewer when the back button is clicked', async () => {
    const user = userEvent.setup();
    renderShell(mockContext);
    await user.click(screen.getByRole('button', { name: /3d viewer/i }));
    expect(screen.getByTestId('viewer-page')).toBeInTheDocument();
  });

  it('should render child page content via Outlet', () => {
    renderShell(mockContext);
    expect(screen.getByTestId('area-report-page')).toBeInTheDocument();
  });

  it('should render campaign page content via Outlet on a campaign route', () => {
    renderShell(mockContext, `${AREA_PATH}/r1`);
    expect(screen.getByTestId('campaign-report-page')).toBeInTheDocument();
  });

  it('should not render campaign nav items when there are no campaigns', () => {
    vi.mocked(mockContext.useInspectionResults).mockReturnValue(makeSuccessResult([]));
    renderShell(mockContext);
    expect(screen.queryByRole('link', { name: /2024/ })).not.toBeInTheDocument();
  });
});
