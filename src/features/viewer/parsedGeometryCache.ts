import type { AttrData } from './plyWorker';

export interface CachedParsedPly {
  attrs: Record<string, AttrData>;
  index: ArrayBuffer | null;
  indexIsUint32: boolean;
  isMesh: boolean;
  hasFaceColors: boolean;
}

const DB_NAME = 'autoassess-parsed-ply';
const STORE_NAME = 'geometries-v5';
const DB_VERSION = 5;

type Deps = { openIdb: () => Promise<IDBDatabase> };

// Singleton — reused across concurrent PLY loads. Tests inject their own openIdb and never touch this.
let dbPromise: Promise<IDBDatabase> | null = null;

function defaultOpenIdb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('IndexedDB not available'));
      return;
    }
    const req = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ['geometries-v1', 'geometries-v2', 'geometries-v3', 'geometries-v4']) {
        if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
      }
      db.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

const defaultDeps: Deps = { openIdb: defaultOpenIdb };

export async function getCachedParsedPly(
  key: string,
  overrides?: Partial<Deps>,
): Promise<CachedParsedPly | null> {
  const { openIdb } = { ...defaultDeps, ...overrides };
  try {
    const db = await openIdb();
    return await new Promise<CachedParsedPly | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve((req.result as CachedParsedPly) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function putCachedParsedPly(
  key: string,
  data: CachedParsedPly,
  overrides?: Partial<Deps>,
): Promise<void> {
  const { openIdb } = { ...defaultDeps, ...overrides };
  try {
    const db = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).put(data, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Quota exceeded, private browsing, or other IDB errors — silently fail
  }
}
