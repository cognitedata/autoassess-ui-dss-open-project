import { beforeEach, describe, expect, it } from 'vitest';
import { useViewerSettingsStore, VIEWER_SETTINGS_DEFAULTS } from './viewerSettingsStore';

describe(useViewerSettingsStore.name, () => {
  beforeEach(() => {
    localStorage.clear();
    useViewerSettingsStore.setState({ ...VIEWER_SETTINGS_DEFAULTS });
  });

  it('defaults match the hardcoded values used before settings were introduced', () => {
    const s = useViewerSettingsStore.getState();
    expect(s.moveSpeed).toBe(10);
    expect(s.keyRotateSpeed).toBe(1.5);
    expect(s.mouseRotateSpeed).toBe(0.003);
    expect(s.mousePanSpeed).toBe(0.005);
    expect(s.mouseScrollSpeed).toBe(0.01);
  });

  it('setMoveSpeed updates moveSpeed', () => {
    useViewerSettingsStore.getState().setMoveSpeed(20);
    expect(useViewerSettingsStore.getState().moveSpeed).toBe(20);
  });

  it('setKeyRotateSpeed updates keyRotateSpeed', () => {
    useViewerSettingsStore.getState().setKeyRotateSpeed(2.5);
    expect(useViewerSettingsStore.getState().keyRotateSpeed).toBe(2.5);
  });

  it('setMouseRotateSpeed updates mouseRotateSpeed', () => {
    useViewerSettingsStore.getState().setMouseRotateSpeed(0.005);
    expect(useViewerSettingsStore.getState().mouseRotateSpeed).toBe(0.005);
  });

  it('setMousePanSpeed updates mousePanSpeed', () => {
    useViewerSettingsStore.getState().setMousePanSpeed(0.008);
    expect(useViewerSettingsStore.getState().mousePanSpeed).toBe(0.008);
  });

  it('setMouseScrollSpeed updates mouseScrollSpeed', () => {
    useViewerSettingsStore.getState().setMouseScrollSpeed(0.02);
    expect(useViewerSettingsStore.getState().mouseScrollSpeed).toBe(0.02);
  });

  it('individual setters do not affect other fields', () => {
    useViewerSettingsStore.getState().setMoveSpeed(30);
    const s = useViewerSettingsStore.getState();
    expect(s.keyRotateSpeed).toBe(VIEWER_SETTINGS_DEFAULTS.keyRotateSpeed);
    expect(s.mouseRotateSpeed).toBe(VIEWER_SETTINGS_DEFAULTS.mouseRotateSpeed);
  });
});
