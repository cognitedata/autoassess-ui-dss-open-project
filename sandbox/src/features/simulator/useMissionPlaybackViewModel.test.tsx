import { act, renderHook } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import type { PlanJson } from '../../domain/planJson';
import type { MissionResult } from '../../sim/simulator';
import { flyAllTasks } from '../../__mocks__/missions';
import { FlightRecorder } from '../../sim/simulator';
import type { PlaybackDeps } from './useMissionPlaybackViewModel';
import { MissionPlaybackContext, useMissionPlaybackViewModel } from './useMissionPlaybackViewModel';

describe(useMissionPlaybackViewModel.name, () => {
  let frames: FakeFrames;
  let wrapper: ComponentType<{ children: ReactNode }>;
  let mission: MissionResult;

  beforeEach(() => {
    frames = new FakeFrames();
    wrapper = ({ children }) => (
      <MissionPlaybackContext.Provider value={frames.deps}>{children}</MissionPlaybackContext.Provider>
    );
    // 1 m up, 2 m over, 3 s inspect, 2 m back, 1 m down at 1 m/s -> 9 s
    mission = flyAllTasks(PLAN, null, { speedMps: 1, standoffM: 1, home: [0, 0, 0] });
  });

  it('should be idle without a mission', () => {
    const { result } = renderHook(() => useMissionPlaybackViewModel(null, 0), { wrapper });

    expect(result.current.sample).toBeNull();
    expect(result.current.playing).toBe(false);
  });

  it('should auto-play a new mission from t=0', () => {
    const { result } = renderHook(() => useMissionPlaybackViewModel(mission, 1), { wrapper });

    expect(result.current.playing).toBe(true);
    expect(result.current.t).toBe(0);
    expect(result.current.duration).toBe(9);
  });

  it('should advance simulated time by real time x speed', () => {
    const { result } = renderHook(() => useMissionPlaybackViewModel(mission, 1), { wrapper });
    act(() => result.current.setSpeed(5));

    frames.advance(0);
    frames.advance(200);

    expect(result.current.t).toBeCloseTo(1);
  });

  it('should stop at the end with the drone landed', () => {
    const { result } = renderHook(() => useMissionPlaybackViewModel(mission, 1), { wrapper });

    frames.advance(0);
    frames.advance(10_000);

    expect(result.current.playing).toBe(false);
    expect(result.current.t).toBe(9);
    expect(result.current.sample?.done).toBe(true);
  });

  it('should pause and resume', () => {
    const { result } = renderHook(() => useMissionPlaybackViewModel(mission, 1), { wrapper });
    frames.advance(0);
    frames.advance(100);
    act(() => result.current.togglePlay());
    const pausedAt = result.current.t;

    frames.advance(1000);

    expect(result.current.playing).toBe(false);
    expect(result.current.t).toBe(pausedAt);
  });

  it('should replay from the start when play is pressed after the end', () => {
    const { result } = renderHook(() => useMissionPlaybackViewModel(mission, 1), { wrapper });
    frames.advance(0);
    frames.advance(10_000);

    act(() => result.current.togglePlay());

    expect(result.current.t).toBe(0);
    expect(result.current.playing).toBe(true);
  });

  it('should restart when a new mission is dispatched', () => {
    const { result, rerender } = renderHook(({ id }) => useMissionPlaybackViewModel(mission, id), {
      wrapper,
      initialProps: { id: 1 },
    });
    frames.advance(0);
    frames.advance(300);

    rerender({ id: 2 });

    expect(result.current.t).toBe(0);
    expect(result.current.playing).toBe(true);
  });

  it('should keep its place when later steps of the same flight arrive', () => {
    const { partial, full } = growingFlight();
    const { result, rerender } = renderHook(({ m }) => useMissionPlaybackViewModel(m, 1), {
      wrapper,
      initialProps: { m: partial },
    });
    frames.advance(0);
    frames.advance(50);
    const t = result.current.t;

    rerender({ m: full });

    expect(result.current.t).toBe(t);
    expect(result.current.playing).toBe(true);
    expect(result.current.duration).toBe(full.summary.durationS);
  });

  it('should continue when a step extends a flight whose replay had caught up', () => {
    const { partial, full } = growingFlight();
    const { result, rerender } = renderHook(({ m }) => useMissionPlaybackViewModel(m, 1), {
      wrapper,
      initialProps: { m: partial },
    });
    frames.advance(0);
    frames.advance(10_000);
    expect(result.current.playing).toBe(false);

    rerender({ m: full });

    expect(result.current.playing).toBe(true);
    expect(result.current.t).toBe(partial.summary.durationS);
  });

  it('should stay paused when the user paused before the flight grew', () => {
    const { partial, full } = growingFlight();
    const { result, rerender } = renderHook(({ m }) => useMissionPlaybackViewModel(m, 1), {
      wrapper,
      initialProps: { m: partial },
    });
    act(() => result.current.togglePlay());

    rerender({ m: full });

    expect(result.current.playing).toBe(false);
  });

  it('should clamp seek to the mission', () => {
    const { result } = renderHook(() => useMissionPlaybackViewModel(mission, 1), { wrapper });

    act(() => result.current.seek(100));

    expect(result.current.t).toBe(9);
  });
});

/** The same flight after take-off, and after the whole mission. */
function growingFlight(): { partial: MissionResult; full: MissionResult } {
  const rec = new FlightRecorder({ speedMps: 1, home: [0, 0, 0] });
  rec.loadPlan(PLAN, null);
  rec.takeoff();
  const partial = rec.snapshot();
  rec.goto({ x: 2, y: 0, z: 1, roll: 0, pitch: 0, yaw: 0 });
  rec.inspect('r1');
  rec.returnHome();
  rec.land();
  return { partial, full: rec.snapshot() };
}

class FakeFrames {
  private queue = new Map<number, (now: number) => void>();
  private nextId = 1;
  private now = 0;

  deps: PlaybackDeps = {
    requestFrame: (cb) => {
      const id = this.nextId++;
      this.queue.set(id, cb);
      return id;
    },
    cancelFrame: (id) => {
      this.queue.delete(id);
    },
  };

  /** Advance the clock by ms and fire the pending frame. */
  advance(ms: number): void {
    this.now += ms;
    const pending = [...this.queue.values()];
    this.queue.clear();
    act(() => pending.forEach((cb) => cb(this.now)));
  }
}

const PLAN: PlanJson = {
  planExternalId: 'p',
  name: null,
  description: null,
  areaExternalId: 'a',
  areaName: 'A',
  mapExternalId: null,
  downloadedAt: '',
  tasks: [{ id: 'r1', kind: 'region', inspectionType: 'visual', position3d: [2, -1, 1], normalVector: [0, 1, 0] }],
};
