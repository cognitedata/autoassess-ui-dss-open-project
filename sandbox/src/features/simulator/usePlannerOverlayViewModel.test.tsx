import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { flyAllTasks } from '../../__mocks__/missions';
import { emptyMap, plannerResult, setVoxel } from '../../__mocks__/planner';
import type { PlanJson } from '../../domain/planJson';
import { sampleMission } from '../../sim/playback';
import type { MissionResult } from '../../sim/simulator';
import { usePlannerOverlayViewModel } from './usePlannerOverlayViewModel';

describe(usePlannerOverlayViewModel.name, () => {
  it('should have no overlay and no status without a mission', () => {
    const { result } = renderHook(() => usePlannerOverlayViewModel(null, null));

    expect(result.current.overlay).toBeNull();
    expect(result.current.status).toBeNull();
  });

  it('should have no overlay and no status for a flight without a planner', () => {
    const mission = plainMission();

    const { result } = renderHook(() => usePlannerOverlayViewModel(mission, sampleMission(mission, 1)));

    expect(result.current.overlay).toBeNull();
    expect(result.current.status).toBeNull();
  });

  it('should derive the planner status at the playback time', () => {
    const mission = withPlanner();

    const { result } = renderHook(() => usePlannerOverlayViewModel(mission, sampleMission(mission, 2)));

    expect(result.current.status).toEqual({
      mode: 'exploration',
      modeLabel: 'Exploring',
      iteration: 1,
      exploredPct: 30,
      coveragePct: 10,
      timeRemainingS: 98,
      compartment: 1,
      compartments: 2,
      coveredTasks: 0,
      tasksTotal: 2,
    });
  });

  it('should say the planner is idle once the replay has landed', () => {
    const mission = withPlanner();

    const { result } = renderHook(() => usePlannerOverlayViewModel(mission, sampleMission(mission, 1e6)));

    expect(result.current.status).toMatchObject({ mode: 'idle', modeLabel: 'Idle' });
  });

  it('should count the plan tasks the camera covered by the playback time', () => {
    const mission = withPlanner({ 'p-in': 1.5 });

    const { result } = renderHook(() => usePlannerOverlayViewModel(mission, sampleMission(mission, 2)));

    expect(result.current.status?.coveredTasks).toBe(1);
  });

  it('should project the map for both views with every layer on', () => {
    const mission = withPlanner();

    const { result } = renderHook(() => usePlannerOverlayViewModel(mission, sampleMission(mission, 2)));

    expect(result.current.overlay?.top.map.axes).toEqual([0, 1]);
    expect(result.current.overlay?.side.map.axes).toEqual([0, 2]);
    expect(result.current.overlay?.top.layers).toEqual({ map: true, graph: true, bestPath: true, camera: true, viewpoints: true });
  });

  it('should keep the map projection while only the playback time changes', () => {
    const mission = withPlanner();
    const { result, rerender } = renderHook(({ t }) => usePlannerOverlayViewModel(mission, sampleMission(mission, t)), {
      initialProps: { t: 1 },
    });
    const first = result.current.overlay?.top.map;

    rerender({ t: 3 });

    expect(result.current.overlay?.top.map).toBe(first);
  });

  it('should toggle a layer', () => {
    const mission = withPlanner();
    const { result } = renderHook(() => usePlannerOverlayViewModel(mission, sampleMission(mission, 2)));

    act(() => result.current.toggleLayer('graph'));

    expect(result.current.layers.graph).toBe(false);
    expect(result.current.overlay?.side.layers.graph).toBe(false);
    expect(result.current.layers.map).toBe(true);
  });
});

const PLAN: PlanJson = {
  planExternalId: 'p',
  name: 'Tank',
  description: null,
  areaExternalId: 'a',
  areaName: 'A',
  mapExternalId: null,
  downloadedAt: '',
  tasks: [
    { id: 'p-in', kind: 'region', inspectionType: 'visual', position3d: [2, 0, 1], normalVector: [0, 1, 0] },
    { id: 'p-too', kind: 'region', inspectionType: 'visual', position3d: [3, 0, 1], normalVector: [0, 1, 0] },
  ],
};

function plainMission(): MissionResult {
  return flyAllTasks(PLAN, null, { home: [0, 0, 0] });
}

function withPlanner(coveredTasks: Record<string, number> = {}): MissionResult {
  const map = emptyMap([4, 3, 3]);
  setVoxel(map, [1, 1, 1], 2, 1);
  return { ...plainMission(), planner: plannerResult({ map, coveredTasks }) };
}
