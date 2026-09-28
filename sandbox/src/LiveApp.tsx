import { CogniteSdkProvider, useCogniteSdk } from '@cognite/app-sdk/react';
import { useMemo } from 'react';

import { SandboxPage } from './features/sandbox/SandboxPage';
import { SandboxViewModelContext } from './features/sandbox/useSandboxViewModel';
import { createLiveDeps } from './hostMode';

/** Inside Fusion: authenticate through the host, read plans from CDF (read-only). */
export default function LiveApp() {
  return (
    <CogniteSdkProvider
      loadingFallback={<ConnectingScreen />}
      errorFallback={<SandboxPage notice="Could not connect to Fusion, so the sandbox is using demo data." />}
    >
      <LiveSandbox />
    </CogniteSdkProvider>
  );
}

function ConnectingScreen() {
  return (
    <main className="center-screen" role="status">
      Connecting to Fusion…
    </main>
  );
}

function LiveSandbox() {
  const sdk = useCogniteSdk();
  const deps = useMemo(() => createLiveDeps(sdk), [sdk]);
  return (
    <SandboxViewModelContext.Provider value={deps}>
      <SandboxPage />
    </SandboxViewModelContext.Provider>
  );
}
