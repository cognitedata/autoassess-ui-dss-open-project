import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentType, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VesselListView } from './VesselListView';
import { VesselListViewModelContext } from './useVesselListViewModel';
import type { VesselListViewModelContextType } from './useVesselListViewModel';
import { createMockVessel } from '../../__mocks__/vessels';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-router-dom')>();
  return { ...original, useNavigate: () => mockNavigate };
});

describe(VesselListView.name, () => {
  let mockContext: VesselListViewModelContextType;

  function renderView(context: VesselListViewModelContextType) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const wrapper: ComponentType<{ children: ReactNode }> = ({ children }) =>
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          MemoryRouter,
          null,
          createElement(VesselListViewModelContext.Provider, { value: context }, children),
        ),
      );
    return render(createElement(VesselListView), { wrapper });
  }

  beforeEach(() => {
    mockNavigate.mockReset();
    mockContext = {
      useVessels: vi.fn(() => ({
        data: [createMockVessel()],
        isLoading: false,
        error: null,
      })),
    };
  });

  it('should render a card for each vessel', () => {
    renderView(mockContext);
    expect(screen.getByText('Test Vessel')).toBeDefined();
    expect(screen.getByText('Bulk Carrier')).toBeDefined();
  });

  it('should show a loading indicator while fetching', () => {
    vi.mocked(mockContext.useVessels).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });
    renderView(mockContext);
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('should show an error message on failure', () => {
    vi.mocked(mockContext.useVessels).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Connection refused'),
    });
    renderView(mockContext);
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText(/Connection refused/)).toBeDefined();
  });

  it('should show an empty state when no vessels exist', () => {
    vi.mocked(mockContext.useVessels).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });
    renderView(mockContext);
    expect(screen.getByText(/No vessels/i)).toBeDefined();
  });

  it('should navigate to the area list when a vessel card is clicked', async () => {
    renderView(mockContext);
    await userEvent.click(screen.getByRole('button', { name: 'Test Vessel' }));
    expect(mockNavigate).toHaveBeenCalledWith('/vessels/vessel-test/areas');
  });

  it('should show a settings button per vessel card', () => {
    renderView(mockContext);
    expect(screen.getByRole('button', { name: /Settings for Test Vessel/i })).toBeDefined();
  });

  it('should navigate to settings when the settings button is clicked', async () => {
    renderView(mockContext);
    await userEvent.click(screen.getByRole('button', { name: /Settings for Test Vessel/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/vessels/vessel-test/settings');
  });

  it('should render an "Add vessel" button', () => {
    renderView(mockContext);
    expect(screen.getByRole('button', { name: /add vessel/i })).toBeDefined();
  });

  it('should render the UI-DSS headline', () => {
    renderView(mockContext);
    expect(screen.getByRole('heading', { name: 'UI-DSS', level: 1 })).toBeDefined();
  });
});
