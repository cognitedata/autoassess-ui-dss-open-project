import { lazy, Suspense } from 'react';

import { SandboxPage } from './features/sandbox/SandboxPage';
import type { HostMode } from './hostMode';

// Live mode pulls in @cognite/sdk; standalone demo mode never downloads it.
const LiveApp = lazy(() => import('./LiveApp'));

export function App({ hostMode }: { hostMode: HostMode }) {
  if (hostMode === 'standalone') return <SandboxPage />; // default context = demo data
  return (
    <Suspense
      fallback={
        <main className="center-screen" role="status">
          Connecting to Fusion…
        </main>
      }
    >
      <LiveApp />
    </Suspense>
  );
}
