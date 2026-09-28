import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as appSdk from '@cognite/app-sdk/react';
import { usePlyUrls } from './usePlyUrls';

vi.mock(import('@cognite/app-sdk/react'));

type CogniteSdkResult = ReturnType<typeof appSdk.useCogniteSdk>;

function makeWrapper(): ComponentType<{ children: ReactNode }> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe(usePlyUrls.name, () => {
  let mockGetDownloadUrls: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGetDownloadUrls = vi.fn();
    vi.mocked(appSdk.useCogniteSdk).mockReturnValue({
      files: { getDownloadUrls: mockGetDownloadUrls },
    } as unknown as CogniteSdkResult);
  });

  it('returns pending (disabled query) when fileIds is empty', () => {
    const { result } = renderHook(() => usePlyUrls([]), { wrapper: makeWrapper() });
    expect(result.current.isPending).toBe(true);
    expect(mockGetDownloadUrls).not.toHaveBeenCalled();
  });

  it('fetches and returns a single download URL', async () => {
    const url = 'https://storage.example.test/mesh.ply?signed=1';
    mockGetDownloadUrls.mockResolvedValue([{ id: 42, downloadUrl: url }]);

    const { result } = renderHook(() => usePlyUrls([42]), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([url]);
    expect(mockGetDownloadUrls).toHaveBeenCalledWith([{ id: 42 }]);
  });

  it('fetches and returns multiple download URLs matched by id', async () => {
    const meshUrl = 'https://storage.example.test/mesh.ply?signed=1';
    const pcdUrl = 'https://storage.example.test/labeled.pcd?signed=2';
    mockGetDownloadUrls.mockResolvedValue([
      { id: 42, downloadUrl: meshUrl },
      { id: 99, downloadUrl: pcdUrl },
    ]);

    const { result } = renderHook(() => usePlyUrls([42, 99]), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([meshUrl, pcdUrl]);
    expect(mockGetDownloadUrls).toHaveBeenCalledWith([{ id: 42 }, { id: 99 }]);
  });

  it('matches responses returned out of request order', async () => {
    const meshUrl = 'https://storage.example.test/mesh.ply?signed=1';
    const pcdUrl = 'https://storage.example.test/labeled.pcd?signed=2';
    // CDF's downloadlink response is not guaranteed to preserve request order.
    mockGetDownloadUrls.mockResolvedValue([
      { id: 99, downloadUrl: pcdUrl },
      { id: 42, downloadUrl: meshUrl },
    ]);

    const { result } = renderHook(() => usePlyUrls([42, 99]), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([meshUrl, pcdUrl]);
  });

  it('throws naming the specific file when a response entry is missing a downloadUrl', async () => {
    mockGetDownloadUrls.mockResolvedValue([
      { id: 1, downloadUrl: 'https://storage.example.test/a.ply' },
      { id: 2 },
    ]);

    const { result } = renderHook(() => usePlyUrls([1, 2]), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch('No download URL for file 2');
  });

  it('throws naming the specific file when the response omits its entry entirely', async () => {
    // Regression test: if CDF collapses a duplicate id elsewhere in the batch or drops an
    // inaccessible file, the response array can come back shorter than the request. Matching
    // by array position (instead of by id) would previously hand the wrong URL — or an empty
    // string — to every file after the gap.
    mockGetDownloadUrls.mockResolvedValue([
      { id: 1, downloadUrl: 'https://storage.example.test/a.ply' },
    ]);

    const { result } = renderHook(() => usePlyUrls([1, 2]), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch('No download URL for file 2');
  });

  it('propagates SDK errors', async () => {
    mockGetDownloadUrls.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => usePlyUrls([7]), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Network error');
  });
});
