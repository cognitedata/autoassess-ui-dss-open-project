import { useCallback, useMemo, useState } from 'react';

import { cameraPitchAt, samplePlanner, viewpointArrivals } from '../../planner/plannerPlayback';
import type { PlannerMode } from '../../planner/types';
import type { MissionSample } from '../../sim/playback';
import type { MissionResult } from '../../sim/simulator';
import type { PlannerLayer, PlannerLayers, PlannerOverlay } from './drawScene';
import { projectPlannerMap } from './mapProjection';
import { SIDE_VIEW, TOP_VIEW } from './projection';

export const PLANNER_LAYER_LABELS: Record<PlannerLayer, string> = {
  map: 'Map',
  graph: 'Graph',
  bestPath: 'Best path',
  camera: 'Camera',
  viewpoints: 'Viewpoints',
};

export const PLANNER_MODE_LABELS: Record<PlannerMode, string> = {
  idle: 'Idle',
  initialization: 'Initialising',
  exploration: 'Exploring',
  inspection: 'Inspecting surfaces',
  'target-reach': 'Target reach',
  waypoint: 'Go to waypoint',
  homing: 'Homing',
};

export interface PlannerStatusView {
  mode: PlannerMode;
  modeLabel: string;
  iteration: number;
  exploredPct: number;
  coveragePct: number;
  timeRemainingS: number;
  /** 1-based compartment of the BWT sequence at the playback time (1 when not sequencing). */
  compartment: number;
  /** Compartments in the BWT sequence (1 when not sequencing: the strip hides the counter). */
  compartments: number;
  /** Plan tasks the inspection camera had covered by the playback time. */
  coveredTasks: number;
  /** Plan tasks with a pose (the ones the camera can cover). */
  tasksTotal: number;
}

export interface PlannerOverlayViewModel {
  /** What drawScene draws on top of the mission, per view; null when no SimGbPlanner flew. */
  overlay: { top: PlannerOverlay; side: PlannerOverlay } | null;
  status: PlannerStatusView | null;
  layers: PlannerLayers;
  toggleLayer(layer: PlannerLayer): void;
}

const ALL_LAYERS_ON: PlannerLayers = { map: true, graph: true, bestPath: true, camera: true, viewpoints: true };

/** The simulated gbplanner's map, graph, viewpoints and status at the playback sample. */
export function usePlannerOverlayViewModel(
  mission: MissionResult | null,
  sample: MissionSample | null,
): PlannerOverlayViewModel {
  const [layers, setLayers] = useState<PlannerLayers>(ALL_LAYERS_ON);
  const toggleLayer = useCallback((layer: PlannerLayer) => setLayers((prev) => ({ ...prev, [layer]: !prev[layer] })), []);

  const planner = mission?.planner ?? null;
  // The projection walks every voxel: only redo it when the map itself changes.
  const maps = useMemo(
    () => (planner ? { top: projectPlannerMap(planner.map, TOP_VIEW), side: projectPlannerMap(planner.map, SIDE_VIEW) } : null),
    [planner],
  );
  const segments = mission?.segments;
  const arrivals = useMemo(() => (planner && segments ? viewpointArrivals(planner, segments) : []), [planner, segments]);
  const t = sample?.t ?? 0;
  const plannerSample = useMemo(() => (planner ? samplePlanner(planner, t, arrivals) : null), [planner, t, arrivals]);
  const landed = (sample?.done ?? false) && mission?.status === 'landed';

  const position = sample?.position;
  const overlay = useMemo(() => {
    if (!planner || !maps || !plannerSample || !position) return null;
    const cameraPitch = cameraPitchAt(planner, position, t);
    const common = { planner, sample: plannerSample, layers, cameraPitch };
    return { top: { ...common, map: maps.top }, side: { ...common, map: maps.side } };
  }, [planner, maps, plannerSample, position, layers, t]);

  const status = useMemo((): PlannerStatusView | null => {
    if (!mission || !plannerSample) return null;
    const withPose = mission.tasks.filter((task) => task.target !== null);
    const mode = landed ? 'idle' : plannerSample.mode;
    return {
      mode,
      modeLabel: PLANNER_MODE_LABELS[mode],
      iteration: plannerSample.iteration?.iteration ?? 0,
      exploredPct: plannerSample.exploredPct,
      coveragePct: plannerSample.coveragePct,
      timeRemainingS: plannerSample.timeRemainingS,
      compartment: plannerSample.compartment,
      compartments: plannerSample.compartments,
      coveredTasks: withPose.filter((task) => plannerSample.coveredTaskIds.has(task.id)).length,
      tasksTotal: withPose.length,
    };
  }, [mission, plannerSample, landed]);

  return { overlay, status, layers, toggleLayer };
}
