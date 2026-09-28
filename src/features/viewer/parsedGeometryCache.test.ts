import { describe, it, expect } from 'vitest';
import { getCachedParsedPly, putCachedParsedPly, type CachedParsedPly } from './parsedGeometryCache';
import type { AttrData } from './plyWorker';

const TEST_KEY = 'https://storage.example.test/bucket/mesh.ply';

const MOCK_ATTRS: Record<string, AttrData> = {
  position: { buffer: new Float32Array([1, 2, 3]).buffer, itemSize: 3, normalized: false },
};

const MOCK_CACHED: CachedParsedPly = {
  attrs: MOCK_ATTRS,
  index: null,
  indexIsUint32: false,
  isMesh: true,
  hasFaceColors: false,
};

// Minimal in-memory IDB double — tests never touch the module-level singleton.
function makeFakeIdb(store: Map<string, CachedParsedPly> = new Map()) {
  const fakeDb = {
    transaction: (_storeName: string, _mode: string) => ({
      objectStore: () => ({
        get: (key: string) => makeIdbRequest(store.get(key) ?? undefined),
        put: (value: CachedParsedPly, key: string) => {
          store.set(key, value);
          return makeIdbRequest(undefined);
        },
      }),
    }),
  } as unknown as IDBDatabase;
  return () => Promise.resolve(fakeDb);
}

function makeIdbRequest<T>(result: T): IDBRequest<T> {
  const req = { result } as IDBRequest<T>;
  queueMicrotask(() => req.onsuccess?.call(req, new Event('success') as unknown as Event));
  return req;
}

function makeFailingIdbRequest(): IDBRequest<undefined> {
  const req = { error: new DOMException('QuotaExceededError', 'QuotaExceededError') } as IDBRequest<undefined>;
  queueMicrotask(() => req.onerror?.call(req, new Event('error') as unknown as Event));
  return req;
}

describe('getCachedParsedPly', () => {
  it('returns null on cache miss', async () => {
    const result = await getCachedParsedPly(TEST_KEY, { openIdb: makeFakeIdb() });
    expect(result).toBeNull();
  });

  it('returns stored value after put', async () => {
    const store = new Map<string, CachedParsedPly>();
    const openIdb = makeFakeIdb(store);
    await putCachedParsedPly(TEST_KEY, MOCK_CACHED, { openIdb });
    const result = await getCachedParsedPly(TEST_KEY, { openIdb });
    expect(result).not.toBeNull();
    expect(result!.isMesh).toBe(true);
    expect(result!.indexIsUint32).toBe(false);
    expect(result!.index).toBeNull();
    expect(result!.attrs.position.itemSize).toBe(3);
    expect(result!.attrs.position.normalized).toBe(false);
    expect(result!.attrs.position.buffer.byteLength).toBe(new Float32Array([1, 2, 3]).buffer.byteLength);
  });

  it('round-trips multiple attrs correctly', async () => {
    const store = new Map<string, CachedParsedPly>();
    const openIdb = makeFakeIdb(store);
    const multiAttr: CachedParsedPly = {
      attrs: {
        position: { buffer: new Float32Array([1, 2, 3]).buffer, itemSize: 3, normalized: false },
        normal:   { buffer: new Float32Array([0, 1, 0]).buffer, itemSize: 3, normalized: true },
        color:    { buffer: new Float32Array([1, 0, 0]).buffer, itemSize: 3, normalized: false },
      },
      index: null,
      indexIsUint32: false,
      isMesh: true,
      hasFaceColors: false,
    };
    await putCachedParsedPly(TEST_KEY, multiAttr, { openIdb });
    const result = await getCachedParsedPly(TEST_KEY, { openIdb });
    expect(result!.attrs.normal.normalized).toBe(true);
    expect(result!.attrs.color.itemSize).toBe(3);
  });

  it('round-trips Uint32 index correctly', async () => {
    const store = new Map<string, CachedParsedPly>();
    const openIdb = makeFakeIdb(store);
    const withIndex: CachedParsedPly = {
      attrs: MOCK_ATTRS,
      index: new Uint32Array([0, 1, 2]).buffer,
      indexIsUint32: true,
      isMesh: true,
      hasFaceColors: false,
    };
    await putCachedParsedPly(TEST_KEY, withIndex, { openIdb });
    const result = await getCachedParsedPly(TEST_KEY, { openIdb });
    expect(result!.indexIsUint32).toBe(true);
    expect(result!.index).not.toBeNull();
    expect(result!.index!.byteLength).toBe(new Uint32Array([0, 1, 2]).buffer.byteLength);
  });

  it('returns null when openIdb throws', async () => {
    const result = await getCachedParsedPly(TEST_KEY, {
      openIdb: () => Promise.reject(new Error('IDB unavailable')),
    });
    expect(result).toBeNull();
  });

  it('returns null when get request fires onerror', async () => {
    const fakeDb = {
      transaction: () => ({
        objectStore: () => ({ get: () => makeFailingIdbRequest() }),
      }),
    } as unknown as IDBDatabase;
    const result = await getCachedParsedPly(TEST_KEY, { openIdb: () => Promise.resolve(fakeDb) });
    expect(result).toBeNull();
  });
});

describe('putCachedParsedPly', () => {
  it('resolves silently when openIdb throws', async () => {
    await expect(
      putCachedParsedPly(TEST_KEY, MOCK_CACHED, {
        openIdb: () => Promise.reject(new Error('IDB unavailable')),
      }),
    ).resolves.toBeUndefined();
  });

  it('resolves silently when put request fires onerror (quota exceeded)', async () => {
    const fakeDb = {
      transaction: () => ({
        objectStore: () => ({ put: () => makeFailingIdbRequest() }),
      }),
    } as unknown as IDBDatabase;
    await expect(
      putCachedParsedPly(TEST_KEY, MOCK_CACHED, { openIdb: () => Promise.resolve(fakeDb) }),
    ).resolves.toBeUndefined();
  });
});
