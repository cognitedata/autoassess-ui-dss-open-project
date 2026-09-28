import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AreaListView } from './AreaListView';
import { AreaListViewModelContext } from './useAreaListViewModel';
import type { AreaListViewModelContextType } from './useAreaListViewModel';
import { createMockArea } from '../../__mocks__/areas';
import { createMockVessel } from '../../__mocks__/vessels';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-router-dom')>();
  return { ...original, useNavigate: () => mockNavigate };
});

describe(AreaListView.name, () => {
  let mockContext: AreaListViewModelContextType;

  function renderView(context: AreaListViewModelContextType) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/vessels/vessel-test/areas']}>
          <Routes>
            <Route
              path="/vessels/:vesselId/areas"
              element={
                <AreaListViewModelContext.Provider value={context}>
                  <AreaListView />
                </AreaListViewModelContext.Provider>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    mockNavigate.mockReset();
    mockContext = {
      useAreas: vi.fn(() => ({
        data: [createMockArea()],
        isLoading: false,
        error: null,
      })),
      useVessel: vi.fn(() => ({
        data: createMockVessel(),
        isLoading: false,
        error: null,
      })),
    };
  });

  it('should render a card for each area', () => {
    renderView(mockContext);
    expect(screen.getByText('Ballast Water Tank 01581')).toBeDefined();
    expect(screen.getByText('BWT')).toBeDefined();
  });

  it('should show a loading indicator while fetching', () => {
    vi.mocked(mockContext.useAreas).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });
    renderView(mockContext);
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('should show an error message on failure', () => {
    vi.mocked(mockContext.useAreas).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Timeout'),
    });
    renderView(mockContext);
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText(/Timeout/)).toBeDefined();
  });

  it('should show an empty state when no areas exist', () => {
    vi.mocked(mockContext.useAreas).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });
    renderView(mockContext);
    expect(screen.getByText(/No areas/i)).toBeDefined();
  });

  it('should navigate back to vessel list when back button is clicked', async () => {
    renderView(mockContext);
    await userEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('should show the vessel name as context below the heading', () => {
    vi.mocked(mockContext.useVessel).mockReturnValue({
      data: createMockVessel({ name: 'MV Atlantic' }),
      isLoading: false,
      error: null,
    });
    renderView(mockContext);
    expect(screen.getByText('MV Atlantic')).toBeDefined();
  });

  it('should navigate to the viewer when an area card is clicked', async () => {
    renderView(mockContext);
    await userEvent.click(screen.getByRole('button', { name: 'Ballast Water Tank 01581' }));
    expect(mockNavigate).toHaveBeenCalledWith('/vessels/vessel-test/areas/area-01581');
  });

  it('should render an "Add area" button', () => {
    renderView(mockContext);
    expect(screen.getByRole('button', { name: /add area/i })).toBeDefined();
  });

  it('should show a settings button per area card', () => {
    renderView(mockContext);
    expect(screen.getByRole('button', { name: /Settings for Ballast Water Tank 01581/i })).toBeDefined();
  });

  it('should navigate to settings when the settings button is clicked', async () => {
    renderView(mockContext);
    await userEvent.click(screen.getByRole('button', { name: /Settings for Ballast Water Tank 01581/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/vessels/vessel-test/areas/area-01581/settings');
  });
});
