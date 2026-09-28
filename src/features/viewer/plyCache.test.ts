import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchPlyWithCache, derivePlyKey } from './plyCache';

const TEST_URL = 'https://storage.example.test/bucket/mesh.ply?sig=abc123&expires=999';
const STABLE_KEY = 'https://storage.example.test/bucket/mesh.ply';
const MOCK_BYTES = new Uint8Array([1, 2, 3, 4]).buffer;

function makeResponse(buffer: ArrayBuffer) {
  return new Response(buffer, { headers: { 'Content-Length': String(buffer.byteLength) } });
}

function makeStreamResponse(buffer: ArrayBuffer) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(buffer.byteLength),
    },
  });
}

describe('derivePlyKey', () => {
  it('strips query string from presigned URL', () => {
    expect(derivePlyKey(TEST_URL)).toBe(STABLE_KEY);
  });

  it('preserves origin and pathname with no query string', () => {
    expect(derivePlyKey('https://storage.example.test/bucket/mesh.ply')).toBe(STABLE_KEY);
  });
});

describe('fetchPlyWithCache', () => {
  let mockCache: { match: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockCache = { match: vi.fn(), put: vi.fn() };
    vi.stubGlobal('caches', {
      open: vi.fn().mockResolvedValue(mockCache),
    });
    vi.stubGlobal('fetch', vi.fn());
  });

  it('returns cached bytes on cache hit without fetching', async () => {
    mockCache.match.mockResolvedValue(makeResponse(MOCK_BYTES));

    const onProgress = vi.fn();
    const result = await fetchPlyWithCache(TEST_URL, onProgress);

    expect(new Uint8Array(result)).toEqual(new Uint8Array(MOCK_BYTES));
    expect(fetch).not.toHaveBeenCalled();
    expect(mockCache.match).toHaveBeenCalledWith(STABLE_KEY);
  });

  it('fetches, stores in cache, and returns bytes on cache miss', async () => {
    mockCache.match.mockResolvedValue(undefined);
    mockCache.put.mockResolvedValue(undefined);
    vi.mocked(fetch).mockResolvedValue(makeStreamResponse(MOCK_BYTES));

    const onProgress = vi.fn();
    const result = await fetchPlyWithCache(TEST_URL, onProgress);

    expect(new Uint8Array(result)).toEqual(new Uint8Array(MOCK_BYTES));
    expect(fetch).toHaveBeenCalledWith(TEST_URL, expect.objectContaining({ signal: undefined }));
    expect(mockCache.put).toHaveBeenCalledWith(STABLE_KEY, expect.any(Response));
  });

  it('reports download progress during fetch', async () => {
    mockCache.match.mockResolvedValue(undefined);
    mockCache.put.mockResolvedValue(undefined);
    vi.mocked(fetch).mockResolvedValue(makeStreamResponse(MOCK_BYTES));

    const onProgress = vi.fn();
    await fetchPlyWithCache(TEST_URL, onProgress);

    expect(onProgress).toHaveBeenCalledWith(MOCK_BYTES.byteLength, MOCK_BYTES.byteLength);
  });

  it('falls back to plain fetch when Cache API is unavailable', async () => {
    vi.stubGlobal('caches', undefined);
    vi.mocked(fetch).mockResolvedValue(makeStreamResponse(MOCK_BYTES));

    const result = await fetchPlyWithCache(TEST_URL, vi.fn());

    expect(new Uint8Array(result)).toEqual(new Uint8Array(MOCK_BYTES));
  });

  it('falls back to plain fetch when cache.open throws', async () => {
    vi.stubGlobal('caches', { open: vi.fn().mockRejectedValue(new Error('quota')) });
    vi.mocked(fetch).mockResolvedValue(makeStreamResponse(MOCK_BYTES));

    const result = await fetchPlyWithCache(TEST_URL, vi.fn());

    expect(new Uint8Array(result)).toEqual(new Uint8Array(MOCK_BYTES));
  });

  it('rejects with AbortError when signal is already aborted', async () => {
    mockCache.match.mockResolvedValue(undefined);
    vi.mocked(fetch).mockRejectedValue(Object.assign(new Error('Aborted'), { name: 'AbortError' }));

    const controller = new AbortController();
    controller.abort();

    await expect(fetchPlyWithCache(TEST_URL, vi.fn(), controller.signal)).rejects.toThrow();
  });
});
