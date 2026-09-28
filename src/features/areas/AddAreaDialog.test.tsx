import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AddAreaDialog } from './AddAreaDialog';
import { UseMutateAreaContext } from './useMutateArea';
import type { CogniteClient } from '@cognite/sdk';
import { AUTOASSESS_SPACE } from '../../shared/cdf/dataModel';

describe(AddAreaDialog.name, () => {
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
        createElement(UseMutateAreaContext.Provider, { value: mockContext }, children),
      );
  });

  function renderDialog(open = true, onOpenChange = vi.fn()) {
    return render(
      createElement(AddAreaDialog, {
        open,
        onOpenChange,
        vesselSpace: AUTOASSESS_SPACE,
        vesselExternalId: 'vessel-test',
      }),
      { wrapper },
    );
  }

  it('should render the name and area type inputs when open', () => {
    renderDialog();
    expect(screen.getByLabelText(/name/i)).toBeDefined();
    expect(screen.getByLabelText(/area type/i)).toBeDefined();
  });

  it('should disable the submit button when fields are empty', () => {
    renderDialog();
    const submitButton = screen.getByRole('button', { name: /add area/i });
    expect((submitButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('should enable the submit button when both fields are filled', async () => {
    renderDialog();
    await userEvent.type(screen.getByLabelText(/name/i), 'Ballast Water Tank');
    await userEvent.type(screen.getByLabelText(/area type/i), 'BWT');
    const submitButton = screen.getByRole('button', { name: /add area/i });
    expect((submitButton as HTMLButtonElement).disabled).toBe(false);
  });

  it('should call the create mutation on submit', async () => {
    // Arrange
    mockInstancesUpsert.mockResolvedValue({
      items: [{ instanceType: 'node', space: AUTOASSESS_SPACE, externalId: 'area-new', version: 1, lastUpdatedTime: 0, createdTime: 0 }],
    });
    renderDialog();

    // Act
    await userEvent.type(screen.getByLabelText(/name/i), 'Ballast Water Tank');
    await userEvent.type(screen.getByLabelText(/area type/i), 'BWT');
    await userEvent.click(screen.getByRole('button', { name: /add area/i }));

    // Assert
    expect(mockInstancesUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            sources: [
              expect.objectContaining({
                properties: expect.objectContaining({
                  name: 'Ballast Water Tank',
                  areaType: 'BWT',
                  vessel: { space: AUTOASSESS_SPACE, externalId: 'vessel-test' },
                }),
              }),
            ],
          }),
        ],
      }),
    );
  });
});
