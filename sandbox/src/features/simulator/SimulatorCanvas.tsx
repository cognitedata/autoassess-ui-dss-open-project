import { useEffect, useRef, useState } from 'react';

import type { StructuralElement } from '../../domain/types';
import type { MissionSample } from '../../sim/playback';
import type { MissionResult } from '../../sim/simulator';
import { drawScene } from './drawScene';
import type { ViewAxes } from './projection';

export interface SimulatorCanvasProps {
  title: string;
  axes: ViewAxes;
  mission: MissionResult;
  sample: MissionSample;
  elements: readonly StructuralElement[];
  height: number;
}

export function SimulatorCanvas({ title, axes, mission, sample, elements, height }: SimulatorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(640);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(200, Math.floor(entry.contentRect.width)));
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return; // no 2D context in unit tests
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScene(ctx, width, height, axes, mission, sample, elements);
  }, [width, height, axes, mission, sample, elements]);

  return (
    <figure className="sim-view">
      <figcaption>{title}</figcaption>
      <canvas ref={canvasRef} style={{ height }} role="img" aria-label={`${title} of the drone mission`} />
    </figure>
  );
}
