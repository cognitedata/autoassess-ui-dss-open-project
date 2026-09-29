import type { CogniteClient } from '@cognite/sdk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { createElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useDroneImages, useDroneImageDownloadUrl, UseDroneImagesContext } from './useDroneImages';

type ContextType = { useCogniteSdk: () => CogniteClient };

describe(useDroneImages.name, () => {
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
        createElement(UseDroneImagesContext.Provider, { value: mockContext }, children),
      );
  });

  it('is disabled (pending) when areaExternalId is empty', () => {
    const { result } = renderHook(() => useDroneImages('autoassess', ''), { wrapper });
    expect(result.current.isPending).toBe(true);
    expect(mockInstancesList).not.toHaveBeenCalled();
  });

  it('returns an empty array when the area has no campaigns', async () => {
    mockInstancesList.mockResolvedValue({ items: [] });

    const { result } = renderHook(() => useDroneImages('autoassess', 'area-ship-ch-sim'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('propagates SDK errors', async () => {
    mockInstancesList.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useDroneImages('autoassess', 'area-ship-ch-sim'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Network error');
  });
});

describe(useDroneImageDownloadUrl.name, () => {
  let mockGetDownloadUrls: ReturnType<typeof vi.fn>;
  let mockContext: ContextType;
  let wrapper: ComponentType<{ children: ReactNode }>;

  beforeEach(() => {
    mockGetDownloadUrls = vi.fn();
    const mockSdk = {
      files: { getDownloadUrls: mockGetDownloadUrls },
    } as unknown as CogniteClient;
    mockContext = { useCogniteSdk: vi.fn(() => mockSdk) };

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(UseDroneImagesContext.Provider, { value: mockContext }, children),
      );
  });

  it('does not fetch when cdfFileId is null', () => {
    renderHook(() => useDroneImageDownloadUrl(null), { wrapper });
    expect(mockGetDownloadUrls).not.toHaveBeenCalled();
  });

  it('does not fetch when cdfFileId is 0', () => {
    renderHook(() => useDroneImageDownloadUrl(0), { wrapper });
    expect(mockGetDownloadUrls).not.toHaveBeenCalled();
  });

  it('fetches and returns the download URL for a valid cdfFileId', async () => {
    mockGetDownloadUrls.mockResolvedValue([
      { downloadUrl: 'https://storage.example.test/frame-42.png' },
    ]);

    const { result } = renderHook(() => useDroneImageDownloadUrl(1592278063986069), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBe('https://storage.example.test/frame-42.png');
    expect(mockGetDownloadUrls).toHaveBeenCalledWith([{ id: 1592278063986069 }]);
  });

  it('fetches a fresh URL when the image is opened again instead of reusing an expired one', async () => {
    // CDF signed download URLs expire after ~30 s, so a cached URL is useless on the next open.
    mockGetDownloadUrls
      .mockResolvedValueOnce([{ downloadUrl: 'https://storage.example.test/first.png' }])
      .mockResolvedValueOnce([{ downloadUrl: 'https://storage.example.test/second.png' }]);
    const first = renderHook(() => useDroneImageDownloadUrl(42), { wrapper });
    await waitFor(() => expect(first.result.current.data).toBe('https://storage.example.test/first.png'));
    first.unmount();
    await new Promise((resolve) => setTimeout(resolve, 0)); // the image is reopened later

    const second = renderHook(() => useDroneImageDownloadUrl(42), { wrapper });

    expect(second.result.current.data).toBeUndefined();
    await waitFor(() => expect(second.result.current.data).toBe('https://storage.example.test/second.png'));
    expect(mockGetDownloadUrls).toHaveBeenCalledTimes(2);
  });

  it('propagates error from getDownloadUrl', async () => {
    mockGetDownloadUrls.mockResolvedValue([{}]); // no downloadUrl field → service throws

    const { result } = renderHook(() => useDroneImageDownloadUrl(99999), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.data).toBeUndefined();
  });
});
