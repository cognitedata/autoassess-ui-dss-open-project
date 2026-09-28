import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AddVesselDialog } from './AddVesselDialog';
import { UseMutateVesselContext } from './useMutateVessel';
import type { CogniteClient } from '@cognite/sdk';

describe(AddVesselDialog.name, () => {
  let mockInstancesUpsert: ReturnType<typeof vi.fn>;
  let mockContext: { useCogniteSdk: () => CogniteClient };
  let queryClient: QueryClient;
  let wrapper: ComponentType<{ children: ReactNode }>;

  beforeEach(() => {
    mockInstancesUpsert = vi.fn();
    const mockSdk = {
      instances: { upsert: mockInstancesUpsert },
    } as unknown as CogniteClient;
    mockContext = { useCogniteSdk: vi.fn(() => mockSdk) };

    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(UseMutateVesselContext.Provider, { value: mockContext }, children),
      );
  });

  function renderDialog(open = true, onOpenChange = vi.fn()) {
    return render(
      createElement(AddVesselDialog, { open, onOpenChange }),
      { wrapper },
    );
  }

  it('should render the name and vessel type inputs when open', () => {
    renderDialog();
    expect(screen.getByLabelText(/name/i)).toBeDefined();
    expect(screen.getByLabelText(/vessel type/i)).toBeDefined();
  });

  it('should disable the submit button when fields are empty', () => {
    renderDialog();
    const submitButton = screen.getByRole('button', { name: /add vessel/i });
    expect((submitButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('should enable the submit button when both fields are filled', async () => {
    renderDialog();
    await userEvent.type(screen.getByLabelText(/name/i), 'My Vessel');
    await userEvent.type(screen.getByLabelText(/vessel type/i), 'Tanker');
    const submitButton = screen.getByRole('button', { name: /add vessel/i });
    expect((submitButton as HTMLButtonElement).disabled).toBe(false);
  });

  it('should call the create mutation on submit', async () => {
    // Arrange
    mockInstancesUpsert.mockResolvedValue({
      items: [{ instanceType: 'node', space: 'autoassess', externalId: 'vessel-new', version: 1, lastUpdatedTime: 0, createdTime: 0 }],
    });
    renderDialog();

    // Act
    await userEvent.type(screen.getByLabelText(/name/i), 'My Vessel');
    await userEvent.type(screen.getByLabelText(/vessel type/i), 'Tanker');
    await userEvent.click(screen.getByRole('button', { name: /add vessel/i }));

    // Assert
    expect(mockInstancesUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            sources: [expect.objectContaining({ properties: { name: 'My Vessel', vesselType: 'Tanker' } })],
          }),
        ],
      }),
    );
  });
});
