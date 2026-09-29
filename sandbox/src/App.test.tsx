import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { App } from './App';

// vi.mock is unavoidable here: CogniteSdkProvider performs a Comlink handshake with the Fusion
// host that doesn't exist in tests. The fake renders its error fallback (= no host available).
vi.mock('@cognite/app-sdk/react', () => ({
  CogniteSdkProvider: ({ errorFallback }: { errorFallback: unknown }) => errorFallback,
  useCogniteSdk: vi.fn(),
}));

// The default runtime would spawn a real Web Worker; keep it inert.
vi.mock('./python/PythonRuntime', () => ({
  createWorkerPythonRuntime: () => ({
    start: () => new Promise<void>(() => {}),
    updateSnapshot: vi.fn(),
    run: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
  }),
}));

describe(App.name, () => {
  it('should render the sandbox with demo data when standalone', () => {
    render(<App hostMode="standalone" />);

    expect(screen.getByRole('heading', { name: 'AutoAssess Drone Sandbox' })).toBeInTheDocument();
    expect(screen.getByText('Demo data (bundled)')).toBeInTheDocument();
  });

  it('should fall back to demo data with a notice when Fusion cannot be reached', async () => {
    render(<App hostMode="fusion" />);

    expect(await screen.findByText(/Could not connect to Fusion/)).toBeInTheDocument();
  });
});
