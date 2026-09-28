import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AreaSettingsPage } from './AreaSettingsPage';
import { AreaSettingsViewModelContext } from './useAreaSettingsViewModel';
import type { AreaSettingsViewModelContextType } from './useAreaSettingsViewModel';
import { createMockArea } from '../../__mocks__/areas';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-router-dom')>();
  return { ...original, useNavigate: () => mockNavigate };
});

describe(AreaSettingsPage.name, () => {
  let mockContext: AreaSettingsViewModelContextType;

  function renderPage(context: AreaSettingsViewModelContextType) {
    return render(
      <MemoryRouter initialEntries={['/vessels/vessel-test/areas/area-01581/settings']}>
        <Routes>
          <Route
            path="/vessels/:vesselId/areas/:areaId/settings"
            element={
              <AreaSettingsViewModelContext.Provider value={context}>
                <AreaSettingsPage />
              </AreaSettingsViewModelContext.Provider>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  beforeEach(() => {
    mockNavigate.mockReset();
    mockContext = {
      useAreas: vi.fn(() => ({ data: [createMockArea()], isLoading: false, error: null })),
      useUpdateArea: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
      useDeleteArea: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    };
  });

  it('should render the area name in the name input', () => {
    renderPage(mockContext);
    const input = screen.getByRole('textbox', { name: /name/i }) as HTMLInputElement;
    expect(input.value).toBe('Ballast Water Tank 01581');
  });

  it('should show a loading indicator while fetching', () => {
    vi.mocked(mockContext.useAreas).mockReturnValue({ data: undefined, isLoading: true, error: null });
    renderPage(mockContext);
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('should show an error when fetch fails', () => {
    vi.mocked(mockContext.useAreas).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Server error'),
    });
    renderPage(mockContext);
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText(/Server error/)).toBeDefined();
  });

  it('should disable Save when name matches the current area name', () => {
    renderPage(mockContext);
    const saveButton = screen.getByRole('button', { name: /save/i }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
  });

  it('should enable Save when name differs from the current area name', async () => {
    renderPage(mockContext);
    const input = screen.getByRole('textbox', { name: /name/i });
    await userEvent.clear(input);
    await userEvent.type(input, 'New Name');
    const saveButton = screen.getByRole('button', { name: /save/i }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);
  });

  it('should enable Save when name matches an older name but area has since been updated', async () => {
    // Arrange: area was saved with "Ballast Tank 0158", now server returns that
    vi.mocked(mockContext.useAreas).mockReturnValue({
      data: [{ ...createMockArea(), name: 'Ballast Tank 0158' }],
      isLoading: false,
      error: null,
    });
    renderPage(mockContext);

    // Act: user types back the original name
    const input = screen.getByRole('textbox', { name: /name/i });
    await userEvent.clear(input);
    await userEvent.type(input, 'Ballast Water Tank 01581');

    // Assert: Save is enabled because it differs from the current server name
    const saveButton = screen.getByRole('button', { name: /save/i }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);
  });

  it('should call updateArea with the new name when Save is clicked', async () => {
    const mockUpdateArea = vi.fn();
    vi.mocked(mockContext.useUpdateArea).mockReturnValue({ mutate: mockUpdateArea, isPending: false });
    renderPage(mockContext);

    const input = screen.getByRole('textbox', { name: /name/i });
    await userEvent.clear(input);
    await userEvent.type(input, 'Renamed Tank');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(mockUpdateArea).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Renamed Tank' }),
    );
  });

  it('should open delete confirmation dialog when Delete area is clicked', async () => {
    renderPage(mockContext);
    await userEvent.click(screen.getByRole('button', { name: /delete area/i }));
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('should call deleteArea and navigate to areas list when delete is confirmed', async () => {
    const mockDeleteArea = vi.fn();
    vi.mocked(mockContext.useDeleteArea).mockReturnValue({ mutate: mockDeleteArea, isPending: false });
    renderPage(mockContext);

    await userEvent.click(screen.getByRole('button', { name: /delete area/i }));
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(mockDeleteArea).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/vessels/vessel-test/areas');
  });

  it('should navigate back to areas when Back is clicked', async () => {
    renderPage(mockContext);
    await userEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/vessels/vessel-test/areas');
  });
});
