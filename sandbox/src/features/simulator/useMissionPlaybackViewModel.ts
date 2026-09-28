import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import type { MissionSample } from '../../sim/playback';
import { sampleMission } from '../../sim/playback';
import type { MissionResult } from '../../sim/simulator';

export interface PlaybackDeps {
  requestFrame: (cb: (nowMs: number) => void) => number;
  cancelFrame: (id: number) => void;
}

const defaultDeps: PlaybackDeps = {
  requestFrame: (cb) => requestAnimationFrame(cb),
  cancelFrame: (id) => cancelAnimationFrame(id),
};

export const MissionPlaybackContext = createContext<PlaybackDeps>(defaultDeps);

/** Simulated seconds per real second. */
export const PLAYBACK_SPEEDS = [1, 5, 10, 25] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];
export const DEFAULT_SPEED: PlaybackSpeed = 10;

export interface MissionPlaybackViewModel {
  sample: MissionSample | null;
  t: number;
  duration: number;
  playing: boolean;
  speed: PlaybackSpeed;
  togglePlay(): void;
  restart(): void;
  setSpeed(speed: PlaybackSpeed): void;
  seek(t: number): void;
}

/**
 * Time-scaled, pausable replay of a mission. Restarts when missionId changes; a mission that grows
 * (later steps of the same flight) keeps playing from where it is.
 */
export function useMissionPlaybackViewModel(
  mission: MissionResult | null,
  missionId: number,
): MissionPlaybackViewModel {
  const { requestFrame, cancelFrame } = useContext(MissionPlaybackContext);
  const [t, setTState] = useState(0);
  // Mirror of t for the animation loop (state updaters may run lazily, refs don't).
  const tRef = useRef(0);
  const setT = useCallback((next: number) => {
    tRef.current = next;
    setTState(next);
  }, []);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(DEFAULT_SPEED);
  const duration = mission?.summary.durationS ?? 0;

  // Paused by the user (as opposed to having caught up with the end of the flight so far).
  const userPaused = useRef(false);
  const hasMission = mission !== null;

  // New flight -> rewind and play.
  useEffect(() => {
    userPaused.current = false;
    setT(0);
    setPlaying(hasMission);
  }, [missionId, hasMission, setT]);

  // A later step of the same flight: keep the place, and carry on if the replay had caught up.
  useEffect(() => {
    if (mission && !userPaused.current && tRef.current < mission.summary.durationS) setPlaying(true);
  }, [mission]);

  const lastFrame = useRef<number | null>(null);
  useEffect(() => {
    if (!playing || !mission) return;
    lastFrame.current = null;
    let id = 0;
    const tick = (nowMs: number) => {
      const dt = lastFrame.current === null ? 0 : (nowMs - lastFrame.current) / 1000;
      lastFrame.current = nowMs;
      const next = Math.min(tRef.current + dt * speed, duration);
      setT(next);
      if (next >= duration) setPlaying(false);
      else id = requestFrame(tick);
    };
    id = requestFrame(tick);
    return () => cancelFrame(id);
  }, [playing, mission, speed, duration, requestFrame, cancelFrame, setT]);

  const sample = useMemo(() => (mission ? sampleMission(mission, t) : null), [mission, t]);

  const togglePlay = useCallback(() => {
    if (!mission) return;
    if (!playing && t >= duration) setT(0);
    userPaused.current = playing;
    setPlaying(!playing);
  }, [mission, playing, t, duration, setT]);

  const restart = useCallback(() => {
    userPaused.current = false;
    setT(0);
    setPlaying(mission !== null);
  }, [mission, setT]);

  const seek = useCallback(
    (next: number) => setT(Math.min(Math.max(next, 0), duration)),
    [duration, setT],
  );

  return { sample, t, duration, playing, speed, togglePlay, restart, setSpeed, seek };
}
