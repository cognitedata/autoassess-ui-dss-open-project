import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import App from './App';
import { VesselListViewModelContext } from './features/vessels/useVesselListViewModel';
import { VesselSettingsViewModelContext } from './features/vessels/useVesselSettingsViewModel';
import { AreaListViewModelContext } from './features/areas/useAreaListViewModel';
import { AreaSettingsViewModelContext } from './features/areas/useAreaSettingsViewModel';
import { createMockVessel } from './__mocks__/vessels';
import { createMockArea } from './__mocks__/areas';

const mockVesselListDeps = {
  useVessels: vi.fn(() => ({ data: [createMockVessel()], isLoading: false, error: null })),
};
const mockVesselSettingsDeps = {
  useVessel: vi.fn(() => ({ data: createMockVessel(), isLoading: false, error: null })),
  useUpdateVessel: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteVessel: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
};
const mockAreaListDeps = {
  useAreas: vi.fn(() => ({ data: [createMockArea()], isLoading: false, error: null })),
  useVessel: vi.fn(() => ({ data: createMockVessel(), isLoading: false, error: null })),
};
const mockAreaSettingsDeps = {
  useAreas: vi.fn(() => ({ data: [createMockArea()], isLoading: false, error: null })),
  useUpdateArea: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteArea: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
};

function renderApp(initialPath = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <VesselListViewModelContext.Provider value={mockVesselListDeps}>
          <VesselSettingsViewModelContext.Provider value={mockVesselSettingsDeps}>
            <AreaListViewModelContext.Provider value={mockAreaListDeps}>
              <AreaSettingsViewModelContext.Provider value={mockAreaSettingsDeps}>
                <App />
              </AreaSettingsViewModelContext.Provider>
            </AreaListViewModelContext.Provider>
          </VesselSettingsViewModelContext.Provider>
        </VesselListViewModelContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the vessel list at /', () => {
    renderApp('/');
    expect(screen.getByText('Select a vessel')).toBeDefined();
  });

  it('renders the area list at /vessels/:vesselId/areas', () => {
    renderApp('/vessels/vessel-test/areas');
    expect(screen.getByText('Select an area')).toBeDefined();
  });

  it('renders the vessel settings page at /vessels/:vesselId/settings', () => {
    renderApp('/vessels/vessel-test/settings');
    expect(screen.getByText('Vessel settings')).toBeDefined();
  });

  it('renders the area settings page at /vessels/:vesselId/areas/:areaId/settings', () => {
    renderApp('/vessels/vessel-test/areas/area-01581/settings');
    expect(screen.getByText('Area settings')).toBeDefined();
  });
});
