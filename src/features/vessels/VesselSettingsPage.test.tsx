import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { VesselSettingsPage } from './VesselSettingsPage';
import { VesselSettingsViewModelContext } from './useVesselSettingsViewModel';
import type { VesselSettingsViewModelContextType } from './useVesselSettingsViewModel';
import { createMockVessel } from '../../__mocks__/vessels';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-router-dom')>();
  return { ...original, useNavigate: () => mockNavigate };
});

describe(VesselSettingsPage.name, () => {
  let mockContext: VesselSettingsViewModelContextType;

  function renderPage(context: VesselSettingsViewModelContextType) {
    return render(
      <MemoryRouter initialEntries={['/vessels/vessel-test/settings']}>
        <Routes>
          <Route
            path="/vessels/:vesselId/settings"
            element={
              <VesselSettingsViewModelContext.Provider value={context}>
                <VesselSettingsPage />
              </VesselSettingsViewModelContext.Provider>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  beforeEach(() => {
    mockNavigate.mockReset();
    mockContext = {
      useVessel: vi.fn(() => ({ data: createMockVessel(), isLoading: false, error: null })),
      useUpdateVessel: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
      useDeleteVessel: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    };
  });

  it('should render the vessel name in the name input', () => {
    renderPage(mockContext);
    const input = screen.getByRole('textbox', { name: /name/i }) as HTMLInputElement;
    expect(input.value).toBe('Test Vessel');
  });

  it('should show a loading indicator while fetching', () => {
    vi.mocked(mockContext.useVessel).mockReturnValue({ data: undefined, isLoading: true, error: null });
    renderPage(mockContext);
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('should show an error when fetch fails', () => {
    vi.mocked(mockContext.useVessel).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Server error'),
    });
    renderPage(mockContext);
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText(/Server error/)).toBeDefined();
  });

  it('should disable Save when name matches the current vessel name', () => {
    renderPage(mockContext);
    const saveButton = screen.getByRole('button', { name: /save/i }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
  });

  it('should enable Save when name differs from the current vessel name', async () => {
    renderPage(mockContext);
    const input = screen.getByRole('textbox', { name: /name/i });
    await userEvent.clear(input);
    await userEvent.type(input, 'New Name');
    const saveButton = screen.getByRole('button', { name: /save/i }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);
  });

  it('should enable Save when name matches an older name but vessel has since been updated', async () => {
    // Arrange: vessel was saved with "Test Vesse", now server returns that
    vi.mocked(mockContext.useVessel).mockReturnValue({
      data: { ...createMockVessel(), name: 'Test Vesse' },
      isLoading: false,
      error: null,
    });
    renderPage(mockContext);

    // Act: user types back the original "Test Vessel"
    const input = screen.getByRole('textbox', { name: /name/i });
    await userEvent.clear(input);
    await userEvent.type(input, 'Test Vessel');

    // Assert: Save is enabled because "Test Vessel" !== current server name "Test Vesse"
    const saveButton = screen.getByRole('button', { name: /save/i }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);
  });

  it('should call updateVessel with the new name when Save is clicked', async () => {
    const mockUpdateVessel = vi.fn();
    vi.mocked(mockContext.useUpdateVessel).mockReturnValue({ mutate: mockUpdateVessel, isPending: false });
    renderPage(mockContext);

    const input = screen.getByRole('textbox', { name: /name/i });
    await userEvent.clear(input);
    await userEvent.type(input, 'Renamed Vessel');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(mockUpdateVessel).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Renamed Vessel' }),
    );
  });

  it('should open delete confirmation dialog when Delete vessel is clicked', async () => {
    renderPage(mockContext);
    await userEvent.click(screen.getByRole('button', { name: /delete vessel/i }));
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('should call deleteVessel and navigate to / when delete is confirmed', async () => {
    const mockDeleteVessel = vi.fn();
    vi.mocked(mockContext.useDeleteVessel).mockReturnValue({ mutate: mockDeleteVessel, isPending: false });
    renderPage(mockContext);

    await userEvent.click(screen.getByRole('button', { name: /delete vessel/i }));
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(mockDeleteVessel).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('should navigate back to vessel list when Back is clicked', async () => {
    renderPage(mockContext);
    await userEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });
});
