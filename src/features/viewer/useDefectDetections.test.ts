import type { CogniteClient } from '@cognite/sdk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { createElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  DEFECT_DETECTION_VIEW,
  INSPECTION_RESULT_VIEW,
} from '../../shared/cdf/dataModel';

import {
  useDefectDetections,
  useUpdateDefectStatus,
  useUpdateDefect,
  useCreateDefect,
  useDeleteDefect,
  UseDefectDetectionsContext,
} from './useDefectDetections';

type ContextType = { useCogniteSdk: () => CogniteClient };

function makeMockResultNode() {
  return {
    instanceType: 'node' as const,
    space: 'autoassess',
    externalId: 'result-01581',
    version: 1,
    lastUpdatedTime: 0,
    createdTime: 0,
    properties: {
      [INSPECTION_RESULT_VIEW.space]: {
        [`${INSPECTION_RESULT_VIEW.externalId}/${INSPECTION_RESULT_VIEW.version}`]: {
          area: { space: 'autoassess', externalId: 'area-01581' },
          campaignDate: '2024-09-15',
          status: 'Complete',
          cdfFileIds: [],
        },
      },
    },
  };
}

function makeMockDefectNode() {
  return {
    instanceType: 'node' as const,
    space: 'autoassess',
    externalId: 'defect-001',
    version: 1,
    lastUpdatedTime: 0,
    createdTime: 0,
    properties: {
      [DEFECT_DETECTION_VIEW.space]: {
        [`${DEFECT_DETECTION_VIEW.externalId}/${DEFECT_DETECTION_VIEW.version}`]: {
          campaign: { space: 'autoassess', externalId: 'result-01581' },
          probability: 0.87,
          defectClass: 'corrosion',
          boundingBox3d: [1, 2, 3, 0.1, 0.1, 0.1, 0, 0, 0],
          status: 'New',
        },
      },
    },
  };
}

describe(useDefectDetections.name, () => {
  let mockInstancesList: ReturnType<typeof vi.fn>;
  let mockContext: ContextType;
  let wrapper: ComponentType<{ children: ReactNode }>;

  beforeEach(() => {
    mockInstancesList = vi.fn();
    const mockSdk = {
      instances: { list: mockInstancesList },
    } as unknown as CogniteClient;
    mockContext = { useCogniteSdk: vi.fn(() => mockSdk) };

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(UseDefectDetectionsContext.Provider, { value: mockContext }, children),
      );
  });

  it('should return loading state initially', () => {
    mockInstancesList.mockResolvedValue({ items: [] });

    const { result } = renderHook(
      () => useDefectDetections('autoassess', 'area-01581'),
      { wrapper },
    );

    expect(result.current.isLoading).toBe(true);
  });

  it('should return defects on success', async () => {
    mockInstancesList
      .mockResolvedValueOnce({ items: [makeMockResultNode()] })
      .mockResolvedValueOnce({ items: [makeMockDefectNode()] });

    const { result } = renderHook(
      () => useDefectDetections('autoassess', 'area-01581'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].externalId).toBe('defect-001');
  });

  it('should return empty array when area has no campaigns', async () => {
    mockInstancesList.mockResolvedValue({ items: [] });

    const { result } = renderHook(
      () => useDefectDetections('autoassess', 'area-01581'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('should return error state on failure', async () => {
    mockInstancesList.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(
      () => useDefectDetections('autoassess', 'area-01581'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Network error');
  });

  it('should not fetch when areaExternalId is empty', () => {
    const { result } = renderHook(
      () => useDefectDetections('autoassess', ''),
      { wrapper },
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockInstancesList).not.toHaveBeenCalled();
  });
});

describe(useUpdateDefectStatus.name, () => {
  let mockInstancesList: ReturnType<typeof vi.fn>;
  let mockInstancesUpsert: ReturnType<typeof vi.fn>;
  let mockContext: ContextType;
  let wrapper: ComponentType<{ children: ReactNode }>;

  beforeEach(() => {
    mockInstancesList = vi.fn().mockResolvedValue({ items: [] });
    mockInstancesUpsert = vi.fn().mockResolvedValue({ items: [] });
    const mockSdk = {
      instances: { list: mockInstancesList, upsert: mockInstancesUpsert },
    } as unknown as CogniteClient;
    mockContext = { useCogniteSdk: vi.fn(() => mockSdk) };

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(UseDefectDetectionsContext.Provider, { value: mockContext }, children),
      );
  });

  it('should call updateStatus on the service', async () => {
    const { result } = renderHook(
      () => useUpdateDefectStatus('autoassess', 'area-01581'),
      { wrapper },
    );

    await act(async () => {
      await result.current.mutateAsync({
        space: 'autoassess',
        externalId: 'defect-001',
        status: 'Confirmed',
      });
    });

    expect(mockInstancesUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({
            externalId: 'defect-001',
            sources: [expect.objectContaining({ properties: { status: 'Confirmed' } })],
          }),
        ]),
      }),
    );
  });

  it('should invalidate defectDetections query on success', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const wrapperWithQc = ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(UseDefectDetectionsContext.Provider, { value: mockContext }, children),
      );

    const { result } = renderHook(
      () => useUpdateDefectStatus('autoassess', 'area-01581'),
      { wrapper: wrapperWithQc },
    );

    await act(async () => {
      await result.current.mutateAsync({
        space: 'autoassess',
        externalId: 'defect-001',
        status: 'Confirmed',
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['defectDetections', 'autoassess', 'area-01581'] }),
    );
  });
});

describe(useUpdateDefect.name, () => {
  let mockInstancesUpsert: ReturnType<typeof vi.fn>;
  let mockContext: ContextType;
  let wrapper: ComponentType<{ children: ReactNode }>;

  beforeEach(() => {
    mockInstancesUpsert = vi.fn().mockResolvedValue({ items: [] });
    const mockSdk = {
      instances: { list: vi.fn().mockResolvedValue({ items: [] }), upsert: mockInstancesUpsert },
    } as unknown as CogniteClient;
    mockContext = { useCogniteSdk: vi.fn(() => mockSdk) };

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(UseDefectDetectionsContext.Provider, { value: mockContext }, children),
      );
  });

  it('should call update on the service with provided fields', async () => {
    const { result } = renderHook(
      () => useUpdateDefect('autoassess', 'area-01581'),
      { wrapper },
    );

    await act(async () => {
      await result.current.mutateAsync({
        space: 'autoassess',
        externalId: 'defect-001',
        updates: { defectClass: 'crack', probability: 0.5 },
      });
    });

    expect(mockInstancesUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({
            externalId: 'defect-001',
            sources: [
              expect.objectContaining({
                properties: { defectClass: 'crack', probability: 0.5 },
              }),
            ],
          }),
        ]),
      }),
    );
  });

  it('should invalidate defectDetections query on success', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapperWithQc = ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(UseDefectDetectionsContext.Provider, { value: mockContext }, children),
      );

    const { result } = renderHook(
      () => useUpdateDefect('autoassess', 'area-01581'),
      { wrapper: wrapperWithQc },
    );

    await act(async () => {
      await result.current.mutateAsync({
        space: 'autoassess',
        externalId: 'defect-001',
        updates: { status: 'Confirmed' },
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['defectDetections', 'autoassess', 'area-01581'] }),
    );
  });
});

describe(useCreateDefect.name, () => {
  let mockInstancesUpsert: ReturnType<typeof vi.fn>;
  let mockContext: ContextType;
  let wrapper: ComponentType<{ children: ReactNode }>;

  beforeEach(() => {
    mockInstancesUpsert = vi.fn().mockResolvedValue({ items: [] });
    const mockSdk = {
      instances: { list: vi.fn().mockResolvedValue({ items: [] }), upsert: mockInstancesUpsert },
    } as unknown as CogniteClient;
    mockContext = { useCogniteSdk: vi.fn(() => mockSdk) };

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(UseDefectDetectionsContext.Provider, { value: mockContext }, children),
      );
  });

  it('should call createManual on the service and return the new defect', async () => {
    const { result } = renderHook(
      () => useCreateDefect('autoassess', 'area-01581'),
      { wrapper },
    );

    let created;
    await act(async () => {
      created = await result.current.mutateAsync({
        position: [1, 2, 3],
        normal: [0, 1, 0],
        defectClass: 'crack',
        probability: 0.8,
      });
    });

    expect(mockInstancesUpsert).toHaveBeenCalled();
    expect(created).toMatchObject({
      defectClass: 'crack',
      probability: 0.8,
      source: 'manual',
      status: 'New',
    });
  });

  it('should invalidate defectDetections query on success', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapperWithQc = ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(UseDefectDetectionsContext.Provider, { value: mockContext }, children),
      );

    const { result } = renderHook(
      () => useCreateDefect('autoassess', 'area-01581'),
      { wrapper: wrapperWithQc },
    );

    await act(async () => {
      await result.current.mutateAsync({
        position: [0, 0, 0],
        defectClass: 'corrosion',
        probability: 0.5,
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['defectDetections', 'autoassess', 'area-01581'] }),
    );
  });
});

describe(useDeleteDefect.name, () => {
  let mockInstancesDelete: ReturnType<typeof vi.fn>;
  let mockContext: ContextType;
  let wrapper: ComponentType<{ children: ReactNode }>;

  beforeEach(() => {
    mockInstancesDelete = vi.fn().mockResolvedValue({ items: [] });
    const mockSdk = {
      instances: {
        list: vi.fn().mockResolvedValue({ items: [] }),
        delete: mockInstancesDelete,
      },
    } as unknown as CogniteClient;
    mockContext = { useCogniteSdk: vi.fn(() => mockSdk) };

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(UseDefectDetectionsContext.Provider, { value: mockContext }, children),
      );
  });

  it('should call delete on the service', async () => {
    const { result } = renderHook(
      () => useDeleteDefect('autoassess', 'area-01581'),
      { wrapper },
    );

    await act(async () => {
      await result.current.mutateAsync({ space: 'autoassess', externalId: 'defect-001' });
    });

    expect(mockInstancesDelete).toHaveBeenCalledWith([
      { instanceType: 'node', space: 'autoassess', externalId: 'defect-001' },
    ]);
  });

  it('should invalidate defectDetections query on success', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapperWithQc = ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(UseDefectDetectionsContext.Provider, { value: mockContext }, children),
      );

    const { result } = renderHook(
      () => useDeleteDefect('autoassess', 'area-01581'),
      { wrapper: wrapperWithQc },
    );

    await act(async () => {
      await result.current.mutateAsync({ space: 'autoassess', externalId: 'defect-001' });
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['defectDetections', 'autoassess', 'area-01581'] }),
    );
  });
});
