import { connectToHostApp } from '@cognite/app-sdk';
import type { HostAppAPI } from '@cognite/app-sdk';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Keeps the app's route (vessel, area, report, `?camera=` view, …) in the Fusion URL, so a
 * link copied from the browser opens the app on the same screen.
 *
 * The host hands back the last synced state as `initialState` when a shared link is opened;
 * every later route change is pushed with `syncInternalState`.
 */
export type HostStateSyncDeps = {
  connect: () => Promise<{ api: Pick<HostAppAPI, 'syncInternalState'>; initialState?: string }>;
};

const defaultDeps: HostStateSyncDeps = {
  // Cached singleton inside the SDK — the same connection CogniteSdkProvider uses.
  connect: () => connectToHostApp(),
};

export const HostStateSyncContext = createContext<HostStateSyncDeps>(defaultDeps);

const SYNC_DEBOUNCE_MS = 300;
const MAX_ROUTE_LENGTH = 2048;

/** Only accept same-app paths from the URL; never an absolute or protocol-relative URL. */
export function isSafeAppRoute(route: string): boolean {
  return route.startsWith('/') && !route.startsWith('//') && route.length <= MAX_ROUTE_LENGTH;
}

export function useHostStateSync(): void {
  const { connect } = useContext(HostStateSyncContext);
  const navigate = useNavigate();
  const location = useLocation();
  const route = location.pathname + location.search;
  // The host API is a Comlink proxy, which is callable: never pass it to setState (React would
  // call it as an updater). Keep it in a ref and use a plain flag to trigger the sync effect.
  const apiRef = useRef<Pick<HostAppAPI, 'syncInternalState'> | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    connect()
      .then(({ api: hostApi, initialState }) => {
        if (cancelled) return;
        if (initialState && isSafeAppRoute(initialState)) {
          navigate(initialState, { replace: true });
        }
        apiRef.current = hostApi;
        setConnected(true);
      })
      .catch((error: unknown) => {
        console.warn('Could not connect to the Fusion host; links will not include the app state.', error);
      });
    return () => {
      cancelled = true;
    };
    // Connect once per mount; navigate is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connect]);

  useEffect(() => {
    const api = apiRef.current;
    if (!connected || !api) return;
    const timer = setTimeout(() => {
      const warn = (error: unknown) => console.warn('Could not sync the app state to the Fusion URL.', error);
      try {
        api.syncInternalState(route).catch(warn);
      } catch (error) {
        warn(error);
      }
    }, SYNC_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [connected, route]);
}
