import { beforeEach, describe, expect, it } from 'vitest';
import { useViewerControlsModeStore } from './viewerControlsModeStore';

describe(useViewerControlsModeStore.name, () => {
  beforeEach(() => {
    localStorage.clear();
    useViewerControlsModeStore.setState({ mode: 'free' });
  });

  it('defaults to free mode', () => {
    expect(useViewerControlsModeStore.getState().mode).toBe('free');
  });

  it('setMode switches to ground-plane', () => {
    useViewerControlsModeStore.getState().setMode('ground-plane');
    expect(useViewerControlsModeStore.getState().mode).toBe('ground-plane');
  });

  it('setMode switches back to free', () => {
    useViewerControlsModeStore.getState().setMode('ground-plane');
    useViewerControlsModeStore.getState().setMode('free');
    expect(useViewerControlsModeStore.getState().mode).toBe('free');
  });
});
