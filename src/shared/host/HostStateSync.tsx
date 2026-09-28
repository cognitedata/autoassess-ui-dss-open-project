import { useHostStateSync } from './useHostStateSync';

/** Mount once inside the router: keeps the Fusion URL in sync with the app route. */
export function HostStateSync() {
  useHostStateSync();
  return null;
}
