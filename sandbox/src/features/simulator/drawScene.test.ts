import { describe, expect, it } from 'vitest';

import { flyAllTasks } from '../../__mocks__/missions';
import { emptyMap, plannerResult, setVoxel } from '../../__mocks__/planner';
import type { PlanJson } from '../../domain/planJson';
import { samplePlanner } from '../../planner/plannerPlayback';
import type { PlannerResult } from '../../planner/types';
import { sampleMission } from '../../sim/playback';
import type { MissionResult } from '../../sim/simulator';
import type { PlannerLayers } from './drawScene';
import { drawScene, SCENE_COLORS } from './drawScene';
import { projectPlannerMap } from './mapProjection';
import { TOP_VIEW } from './projection';

describe(drawScene.name, () => {
  it('should draw the dashed planned path and no planner layers for a plain flight', () => {
    const ctx = new RecordingContext();

    drawScene(ctx.asContext(), 300, 200, TOP_VIEW, plainMission(), sampleMission(plainMission(), 2), []);

    expect(ctx.strokedWith(SCENE_COLORS.plannedPath)).toBe(true);
    expect(ctx.filledWith(SCENE_COLORS.mapOccupied)).toBe(false);
    expect(ctx.strokedWith(SCENE_COLORS.graph)).toBe(false);
  });

  it('should draw the explored map, graph, best path, camera wedge and numbered viewpoints', () => {
    const ctx = new RecordingContext();

    draw(ctx, 6);

    expect(ctx.filledWith(SCENE_COLORS.mapFree)).toBe(true);
    expect(ctx.filledWith(SCENE_COLORS.mapOccupied)).toBe(true);
    expect(ctx.filledWith(SCENE_COLORS.mapInspected)).toBe(true);
    expect(ctx.strokedWith(SCENE_COLORS.bestPath)).toBe(true);
    expect(ctx.filledWith(SCENE_COLORS.camera)).toBe(true);
    expect(ctx.texts).toEqual(expect.arrayContaining(['1', '2']));
  });

  it('should not reveal the rest of the planner flight as a dashed planned path', () => {
    const ctx = new RecordingContext();

    draw(ctx, 6);

    expect(ctx.strokedWith(SCENE_COLORS.plannedPath)).toBe(false);
  });

  it('should only draw what the planner knew at the playback time', () => {
    const ctx = new RecordingContext();

    draw(ctx, 0.5);

    expect(ctx.filledWith(SCENE_COLORS.mapOccupied)).toBe(false);
    expect(ctx.filledWith(SCENE_COLORS.mapInspected)).toBe(false);
    expect(ctx.strokedWith(SCENE_COLORS.graph)).toBe(false);
    expect(ctx.texts).not.toContain('1');
  });

  it('should fade the viewpoints the drone has already reached', () => {
    const ctx = new RecordingContext();

    draw(ctx, 6, undefined, [5.5, -1]);

    expect(ctx.alphas).toContain(0.3);
  });

  it('should draw the graph of the current iteration', () => {
    const ctx = new RecordingContext();

    draw(ctx, 2);

    expect(ctx.strokedWith(SCENE_COLORS.graph)).toBe(true);
  });

  it('should leave out the layers that are switched off', () => {
    const ctx = new RecordingContext();

    draw(ctx, 6, { map: false, graph: false, bestPath: false, camera: false, viewpoints: false });

    expect(ctx.filledWith(SCENE_COLORS.mapOccupied)).toBe(false);
    expect(ctx.strokedWith(SCENE_COLORS.bestPath)).toBe(false);
    expect(ctx.filledWith(SCENE_COLORS.camera)).toBe(false);
    expect(ctx.texts).not.toContain('1');
  });

  it('should colour a task the camera covered', () => {
    const ctx = new RecordingContext();

    draw(ctx, 6);

    expect(ctx.filledWith(SCENE_COLORS.covered)).toBe(true);
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
  tasks: [{ id: 'p-far', kind: 'region', inspectionType: 'visual', position3d: [3.5, 2.5, 1.5], normalVector: [0, -1, 0] }],
};

function plainMission(): MissionResult {
  return flyAllTasks(PLAN, null, { home: [0.5, 0.5, 0.5], speedMps: 1 });
}

function planner(): PlannerResult {
  const map = emptyMap([4, 3, 3]);
  setVoxel(map, [0, 0, 1], 1, 0);
  setVoxel(map, [1, 1, 1], 2, 1);
  setVoxel(map, [2, 2, 1], 2, 1, 5);
  return plannerResult({ map, coveredTasks: { 'p-far': 4 } });
}

function draw(
  ctx: RecordingContext,
  t: number,
  layers: PlannerLayers = { map: true, graph: true, bestPath: true, camera: true, viewpoints: true },
  arrivals?: number[],
) {
  const p = planner();
  const mission = { ...plainMission(), planner: p };
  const overlay = { planner: p, sample: samplePlanner(p, t, arrivals), map: projectPlannerMap(p.map, TOP_VIEW), layers, cameraPitch: 0 };
  drawScene(ctx.asContext(), 300, 200, TOP_VIEW, mission, sampleMission(mission, t), [], overlay);
}

/** Records the colour of every fill and stroke (the parts of the 2D context drawScene uses). */
class RecordingContext {
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  font = '';
  textAlign = 'start';
  textBaseline = 'alphabetic';
  globalAlpha = 1;
  readonly fills: string[] = [];
  readonly strokes: string[] = [];
  readonly texts: string[] = [];
  readonly alphas: number[] = [];

  filledWith(color: string): boolean {
    return this.fills.includes(color);
  }
  strokedWith(color: string): boolean {
    return this.strokes.includes(color);
  }

  clearRect(): void {}
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  rect(): void {}
  arc(): void {}
  setLineDash(): void {}
  fillRect(): void {
    this.fills.push(this.fillStyle);
  }
  strokeRect(): void {
    this.strokes.push(this.strokeStyle);
  }
  fill(): void {
    this.fills.push(this.fillStyle);
  }
  stroke(): void {
    this.strokes.push(this.strokeStyle);
  }
  fillText(text: string): void {
    this.texts.push(text);
    this.alphas.push(this.globalAlpha);
  }
  asContext(): CanvasRenderingContext2D {
    return this as Partial<CanvasRenderingContext2D> as CanvasRenderingContext2D;
  }
}
