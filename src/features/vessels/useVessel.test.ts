import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useVessel } from './useVessel';
import { useVessels } from './useVessels';
import { createMockVessel } from '../../__mocks__/vessels';

// vi.mock required: useVessels makes CDF network calls and has no context injection point
vi.mock('./useVessels');

describe(useVessel.name, () => {
  const vesselA = createMockVessel({ externalId: 'vessel-abc', name: 'MV Atlantic' });
  const vesselB = createMockVessel({ externalId: 'vessel-xyz', name: 'MV Pacific' });

  beforeEach(() => {
    vi.mocked(useVessels).mockReturnValue({
      data: [vesselA, vesselB],
      isLoading: false,
      error: null,
    } as ReturnType<typeof useVessels>);
  });

  it('returns the matching vessel by externalId', () => {
    const { result } = renderHook(() => useVessel('vessel-abc'));
    expect(result.current.data).toEqual(vesselA);
  });

  it('returns undefined when vessel is not found', () => {
    const { result } = renderHook(() => useVessel('vessel-nonexistent'));
    expect(result.current.data).toBeUndefined();
  });

  it('forwards isLoading from useVessels', () => {
    vi.mocked(useVessels).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as ReturnType<typeof useVessels>);

    const { result } = renderHook(() => useVessel('vessel-abc'));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('forwards error from useVessels', () => {
    const err = new Error('Network error');
    vi.mocked(useVessels).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: err,
    } as ReturnType<typeof useVessels>);

    const { result } = renderHook(() => useVessel('vessel-abc'));

    expect(result.current.error).toBe(err);
  });
});
