import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HostStateSyncContext, isSafeAppRoute, useHostStateSync } from './useHostStateSync';
import type { HostStateSyncDeps } from './useHostStateSync';

describe(useHostStateSync.name, () => {
  let syncInternalState: ReturnType<typeof vi.fn<(state: string) => Promise<boolean>>>;
  let deps: HostStateSyncDeps;

  beforeEach(() => {
    vi.useFakeTimers();
    syncInternalState = vi.fn<(state: string) => Promise<boolean>>(() => Promise.resolve(true));
    deps = { connect: vi.fn(() => Promise.resolve({ api: { syncInternalState }, initialState: undefined })) };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should open the route from a shared link once connected', async () => {
    vi.mocked(deps.connect).mockResolvedValue({
      api: { syncInternalState },
      initialState: '/vessels/v-1/areas/a-1?camera=1,2,3,4,5,6',
    });

    renderAt('/', deps);
    await flush();

    expect(screen.getByTestId('location')).toHaveTextContent('/vessels/v-1/areas/a-1?camera=1,2,3,4,5,6');
  });

  it('should push the current route to the host after navigation settles', async () => {
    renderAt('/', deps);
    await flush();

    act(() => screen.getByRole('button', { name: 'go' }).click());
    await flush();

    expect(syncInternalState).toHaveBeenLastCalledWith('/vessels/v-9/areas/a-9?camera=0,0,1,0,0,0');
  });

  it('should debounce rapid route changes into one sync', async () => {
    renderAt('/', deps);
    await flush();
    syncInternalState.mockClear();

    act(() => screen.getByRole('button', { name: 'go' }).click());
    act(() => screen.getByRole('button', { name: 'go-again' }).click());
    await flush();

    expect(syncInternalState).toHaveBeenCalledTimes(1);
    expect(syncInternalState).toHaveBeenCalledWith('/vessels/v-9/areas/a-9?camera=9,9,9,0,0,0');
  });

  it('should not overwrite the shared state with the start route before applying it', async () => {
    vi.mocked(deps.connect).mockResolvedValue({ api: { syncInternalState }, initialState: '/vessels/v-1' });

    renderAt('/', deps);
    await flush();

    expect(syncInternalState).not.toHaveBeenCalledWith('/');
  });

  it('should ignore an initial state that is not an in-app route', async () => {
    vi.mocked(deps.connect).mockResolvedValue({ api: { syncInternalState }, initialState: 'https://evil.test/x' });

    renderAt('/', deps);
    await flush();

    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
  });

  it('should work with a callable host API proxy (Comlink), not only plain objects', async () => {
    // Comlink proxies are functions; React's setState treats a function argument as an updater.
    const callableApi = Object.assign(() => Promise.resolve('called as updater'), { syncInternalState });
    vi.mocked(deps.connect).mockResolvedValue({ api: callableApi, initialState: undefined });

    renderAt('/', deps);
    await flush();
    act(() => screen.getByRole('button', { name: 'go' }).click());
    await flush();

    expect(syncInternalState).toHaveBeenLastCalledWith('/vessels/v-9/areas/a-9?camera=0,0,1,0,0,0');
  });

  it('should keep working when the host cannot be reached', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(deps.connect).mockRejectedValue(new Error('no host'));

    renderAt('/', deps);
    await flush();

    expect(screen.getByTestId('location')).toHaveTextContent('/');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe(isSafeAppRoute.name, () => {
  it.each([
    ['/', true],
    ['/vessels/v-1/areas/a-1?camera=1,2,3,4,5,6', true],
    ['//evil.test/x', false],
    ['https://evil.test', false],
    ['javascript:alert(1)', false],
    ['', false],
    [`/${'a'.repeat(3000)}`, false],
  ])('%s → %s', (route, expected) => {
    expect(isSafeAppRoute(route)).toBe(expected);
  });
});

// ---- helpers ----

function Probe() {
  useHostStateSync();
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <span data-testid="location">{location.pathname + location.search}</span>
      <button type="button" onClick={() => navigate('/vessels/v-9/areas/a-9?camera=0,0,1,0,0,0')}>
        go
      </button>
      <button type="button" onClick={() => navigate('/vessels/v-9/areas/a-9?camera=9,9,9,0,0,0')}>
        go-again
      </button>
    </>
  );
}

function renderAt(path: string, deps: HostStateSyncDeps) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <HostStateSyncContext.Provider value={deps}>
      <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
    </HostStateSyncContext.Provider>
  );
  return render(<Probe />, { wrapper });
}

async function flush() {
  await act(async () => {
    await vi.runAllTimersAsync();
  });
}
