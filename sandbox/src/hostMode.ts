import { createCdfSnapshotSource } from './data/CdfSnapshotSource';
import type { CdfReader } from './data/CdfSnapshotSource';
import { createDemoSnapshotSource } from './data/DemoSnapshotSource';
import type { SandboxViewModelDeps } from './features/sandbox/useSandboxViewModel';
import { defaultSandboxViewModelDeps } from './features/sandbox/useSandboxViewModel';

export type HostMode = 'fusion' | 'standalone';

/**
 * Inside Fusion the app is framed; opened directly (e.g. http://localhost:3010) it is not.
 * `?mode=demo` forces standalone demo mode even when framed.
 */
export function detectHostMode(win: { self: unknown; top: unknown; location: { search: string } }): HostMode {
  if (new URLSearchParams(win.location.search).get('mode') === 'demo') return 'standalone';
  return win.self !== win.top ? 'fusion' : 'standalone';
}

/** Live mode: CDF first (read-only), bundled demo data as the alternative. */
export function createLiveDeps(client: CdfReader): SandboxViewModelDeps {
  return {
    ...defaultSandboxViewModelDeps,
    sources: [createCdfSnapshotSource(client), createDemoSnapshotSource()],
  };
}
