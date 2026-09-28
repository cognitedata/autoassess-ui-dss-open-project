import { useEffect, useMemo, useRef } from 'react';

import type { InspectionPlan, StructuralElement } from '../../domain/types';
import type { MissionSample } from '../../sim/playback';
import { distanceAt } from '../../sim/playback';
import type { MissionResult } from '../../sim/simulator';
import type { PlannerLayer, PlannerLayers } from './drawScene';
import { SCENE_COLORS } from './drawScene';
import { SIDE_VIEW, TOP_VIEW } from './projection';
import { SimulatorCanvas } from './SimulatorCanvas';
import { TaskListPanel } from './TaskListPanel';
import type { PlaybackSpeed } from './useMissionPlaybackViewModel';
import { PLAYBACK_SPEEDS, useMissionPlaybackViewModel } from './useMissionPlaybackViewModel';
import type { PlannerStatusView } from './usePlannerOverlayViewModel';
import { PLANNER_LAYER_LABELS, usePlannerOverlayViewModel } from './usePlannerOverlayViewModel';

export interface SimulatorPanelProps {
  mission: MissionResult | null;
  missionId: number;
  /** Structural elements of the mission's area (drawn for context). */
  elements: readonly StructuralElement[];
  /** Plans from the sandbox data (for the flown plan's status). */
  plans: readonly InspectionPlan[];
}

const PHASE_LABELS: Record<MissionSample['phase'], string> = {
  takeoff: 'Taking off',
  transit: 'Flying',
  inspect: 'Inspecting',
  return: 'Returning home',
  land: 'Landing',
  done: 'Landed',
};

/** Phase label once the replay has caught up with a flight that hasn't landed (yet). */
const UNFINISHED_LABELS: Record<Exclude<MissionResult['status'], 'landed'>, string> = {
  planned: 'On the ground',
  'in-flight': 'In flight',
};

export function SimulatorPanel({ mission, missionId, elements, plans }: SimulatorPanelProps) {
  const vm = useMissionPlaybackViewModel(mission, missionId);
  const planner = usePlannerOverlayViewModel(mission, vm.sample);
  const areaElements = useMemo(
    () => (mission ? elements.filter((e) => e.areaExternalId === mission.areaExternalId) : []),
    [elements, mission],
  );
  const plan = useMemo(
    () => (mission ? (plans.find((p) => p.externalId === mission.planExternalId) ?? null) : null),
    [plans, mission],
  );
  // A task the planner's camera covered is not reported as skipped, even if never inspect()ed.
  const skippedTasks = useMemo(
    () => (mission?.tasks ?? []).filter((t) => t.status === 'skipped' && !(t.id in (mission?.planner?.coveredTasks ?? {}))),
    [mission],
  );

  if (!mission || !vm.sample) {
    return (
      <section className="panel simulator-panel" aria-label="Drone simulator">
        <div className="panel-header">
          <h2>Drone simulator</h2>
        </div>
        <div className="empty-state">
          <p className="empty-title">No mission yet</p>
          <p>
            Run <strong>3. Fly the mission</strong> or <strong>4. Hand-fly with poses</strong>, or in your own
            script: <code>from dss_sandbox import SimDrone</code>, <code>sim_drone = SimDrone()</code>,{' '}
            <code>sim_drone.fly_plan(plan)</code>. Every step of the simulated drone is animated here.
          </p>
          <p>
            To let the simulated gbplanner explore and inspect the tank, run{' '}
            <strong>5. gbplanner: explore + inspect</strong> or <strong>6. gbplanner: target reach per task</strong>:
            its map, graph and inspection viewpoints are drawn over the flight.
          </p>
        </div>
      </section>
    );
  }

  const { sample } = vm;
  const visitedNow = sample.visitedTaskIds.size;
  const { summary } = mission;
  const phaseLabel =
    sample.done && mission.status !== 'landed' ? UNFINISHED_LABELS[mission.status] : PHASE_LABELS[sample.phase];
  const landed = sample.done && mission.status === 'landed';
  return (
    <section className="panel simulator-panel" aria-label="Drone simulator">
      <div className="panel-header">
        <h2>
          Drone simulator <span className="muted">· {mission.planName ?? mission.planExternalId}</span>
        </h2>
        <span className={`pill ${landed ? 'pill-ok' : 'pill-busy'}`} data-testid="flight-phase">
          {phaseLabel}
        </span>
      </div>
      <p className="muted small">
        {mission.areaName || mission.areaExternalId} · speed {mission.options.speedMps} m/s · battery{' '}
        {mission.options.maxFlightTimeS} s
      </p>

      {planner.status && <PlannerStatusStrip config={mission.planner?.config ?? ''} status={planner.status} />}

      <SimulatorCanvas
        title="Top view (x–y)"
        axes={TOP_VIEW}
        mission={mission}
        sample={sample}
        elements={areaElements}
        height={210}
        overlay={planner.overlay?.top}
      />
      <SimulatorCanvas
        title="Side view (x–z)"
        axes={SIDE_VIEW}
        mission={mission}
        sample={sample}
        elements={areaElements}
        height={150}
        overlay={planner.overlay?.side}
      />
      {planner.status && <LayerToggles layers={planner.layers} onToggle={planner.toggleLayer} />}
      <Legend withPlanner={planner.status !== null} />

      <div className="playback-controls">
        <button type="button" className="btn btn-small" onClick={vm.togglePlay}>
          {vm.playing ? 'Pause' : sample.done ? 'Replay' : 'Play'}
        </button>
        <button type="button" className="btn btn-ghost btn-small" onClick={vm.restart}>
          Restart
        </button>
        <label className="speed-select">
          Speed
          <select value={vm.speed} onChange={(e) => vm.setSpeed(Number(e.target.value) as PlaybackSpeed)}>
            {PLAYBACK_SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
        <input
          type="range"
          className="timeline"
          aria-label="Mission time"
          min={0}
          max={vm.duration}
          step={0.1}
          value={vm.t}
          onChange={(e) => vm.seek(Number(e.target.value))}
        />
        <span className="mono small">
          {vm.t.toFixed(1)} / {vm.duration.toFixed(0)} s
        </span>
      </div>

      <TaskListPanel mission={mission} sample={sample} plan={plan} />

      <div className="mission-details">
        <div className="mission-summary" data-testid="mission-summary">
          <h3>{landed ? 'Mission summary' : 'Progress'}</h3>
          <dl>
            <dt>Tasks inspected</dt>
            <dd>
              {visitedNow} / {summary.tasksTotal}
            </dd>
            {planner.status && (
              <>
                <dt>Covered by camera</dt>
                <dd>
                  {planner.status.coveredTasks} / {planner.status.tasksTotal}
                </dd>
              </>
            )}
            <dt>Distance</dt>
            <dd>{distanceAt(mission, sample.t).toFixed(1)} m</dd>
            <dt>Simulated time</dt>
            <dd>{sample.t.toFixed(0)} s</dd>
            {landed && (
              <>
                <dt>Skipped</dt>
                <dd>{skippedTasks.length}</dd>
              </>
            )}
          </dl>
          {landed && skippedTasks.length > 0 && (
            <ul className="skipped-list">
              {skippedTasks.map((t) => (
                <li key={t.id}>
                  <span className="mono">{t.id}</span>: {t.skipReason}
                </li>
              ))}
            </ul>
          )}
        </div>
        <MissionLog events={sample.events} />
      </div>
    </section>
  );
}

function MissionLog({ events }: { events: MissionSample['events'] }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);
  return (
    <div className="mission-log">
      <h3>Mission log</h3>
      <ol ref={ref} aria-label="Mission log">
        {events.map((e, i) => (
          <li key={i} className={`event event-${e.kind}`}>
            <span className="mono event-time">{e.t.toFixed(1)}s</span> {e.message}
          </li>
        ))}
      </ol>
    </div>
  );
}

function PlannerStatusStrip({ config, status }: { config: string; status: PlannerStatusView }) {
  return (
    <div className="planner-status" data-testid="planner-status" aria-label="Planner status">
      <span className="planner-status-title">gbplanner · {config}</span>
      <span className="pill pill-live">{status.modeLabel}</span>
      <span>Iteration {status.iteration}</span>
      <span>Explored {status.exploredPct.toFixed(0)}%</span>
      <span>Coverage {status.coveragePct.toFixed(0)}%</span>
      <span>Time left {status.timeRemainingS.toFixed(0)} s</span>
      {status.compartments > 1 && (
        <span>
          Compartment {status.compartment}/{status.compartments}
        </span>
      )}
      <span>
        Covered {status.coveredTasks} / {status.tasksTotal}
      </span>
    </div>
  );
}

function LayerToggles({ layers, onToggle }: { layers: PlannerLayers; onToggle: (layer: PlannerLayer) => void }) {
  const ids = Object.keys(PLANNER_LAYER_LABELS) as PlannerLayer[];
  return (
    <div className="layer-toggles" role="group" aria-label="Planner layers">
      <span className="muted small">Planner layers</span>
      {ids.map((id) => (
        <label key={id}>
          <input type="checkbox" checked={layers[id]} onChange={() => onToggle(id)} />
          {PLANNER_LAYER_LABELS[id]}
        </label>
      ))}
    </div>
  );
}

function Legend({ withPlanner }: { withPlanner: boolean }) {
  const items: ReadonlyArray<readonly [string, string, 'dot' | 'square' | 'line' | 'ring']> = [
    ['Region task', SCENE_COLORS.pending, 'dot'],
    ['Element task', SCENE_COLORS.pending, 'square'],
    ['Inspected', SCENE_COLORS.visited, 'dot'],
    ['Skipped', SCENE_COLORS.skipped, 'dot'],
    ['Drone path', SCENE_COLORS.flownPath, 'line'],
    ['Structural element', SCENE_COLORS.element, 'square'],
    ...(withPlanner
      ? ([
          ['Covered by camera', SCENE_COLORS.covered, 'dot'],
          ['Explored free space', SCENE_COLORS.mapFree, 'square'],
          ['Mapped structure', SCENE_COLORS.mapOccupied, 'square'],
          ['Inspected surface', SCENE_COLORS.mapInspected, 'square'],
          ['RRG graph', SCENE_COLORS.graph, 'line'],
          ['Best path', SCENE_COLORS.bestPath, 'line'],
          ['Camera view', SCENE_COLORS.camera, 'square'],
          ['Inspection viewpoint', SCENE_COLORS.viewpoint, 'ring'],
        ] as const)
      : []),
  ];
  return (
    <ul className="legend" aria-label="Legend">
      {items.map(([label, color, shape]) => (
        <li key={label}>
          <span className={`swatch swatch-${shape}`} style={shape === 'ring' ? { borderColor: color } : { background: color }} />
          {label}
        </li>
      ))}
    </ul>
  );
}
