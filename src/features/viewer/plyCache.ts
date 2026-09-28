const CACHE_NAME = 'autoassess-ply-v1';

/** Stable cache key derived from URL origin + pathname, stripping rotating presigned query strings. */
export function derivePlyKey(url: string): string {
  const { origin, pathname } = new URL(url);
  return origin + pathname;
}

/**
 * Fetches a PLY file, serving from the browser Cache API when available.
 *
 * Cache key: URL origin + pathname (strips the rotating presigned query string so
 * the same physical file hits the cache across sessions).
 *
 * Falls back to a plain fetch when the Cache API is unavailable (HTTP, private
 * browsing with storage blocked, etc.).
 */
export async function fetchPlyWithCache(
  url: string,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const cacheKey = derivePlyKey(url);

  if ('caches' in window) {
    try {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(cacheKey);
      if (cached) {
        return cached.arrayBuffer();
      }

      const buffer = await streamFetch(url, onProgress, signal);
      // Store a synthetic Response so we can retrieve the bytes later
      await cache.put(cacheKey, new Response(buffer, {
        headers: { 'Content-Type': 'application/octet-stream' },
      }));
      return buffer;
    } catch {
      // Cache API failed (quota exceeded, storage error) — fall through to plain fetch
    }
  }

  return streamFetch(url, onProgress, signal);
}

async function streamFetch(
  url: string,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching PLY`);

  const total = parseInt(response.headers.get('Content-Length') ?? '0', 10);
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }

  const result = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result.buffer;
}
