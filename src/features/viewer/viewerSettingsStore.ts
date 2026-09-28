import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const VIEWER_SETTINGS_DEFAULTS = {
  moveSpeed: 10,          // m/s  — keyboard WASD / RF
  keyRotateSpeed: 1.5,    // rad/s — keyboard Q/E/T/G/Z/X
  mouseRotateSpeed: 0.003, // rad/px — left-drag rotation
  mousePanSpeed: 0.005,   // units/px — right/middle-drag pan
  mouseScrollSpeed: 0.01,  // units/unit — scroll dolly
} as const;

interface ViewerSettingsState {
  moveSpeed: number;
  keyRotateSpeed: number;
  mouseRotateSpeed: number;
  mousePanSpeed: number;
  mouseScrollSpeed: number;
  setMoveSpeed(v: number): void;
  setKeyRotateSpeed(v: number): void;
  setMouseRotateSpeed(v: number): void;
  setMousePanSpeed(v: number): void;
  setMouseScrollSpeed(v: number): void;
}

export const useViewerSettingsStore = create<ViewerSettingsState>()(
  persist(
    (set) => ({
      ...VIEWER_SETTINGS_DEFAULTS,
      setMoveSpeed: (v) => set({ moveSpeed: v }),
      setKeyRotateSpeed: (v) => set({ keyRotateSpeed: v }),
      setMouseRotateSpeed: (v) => set({ mouseRotateSpeed: v }),
      setMousePanSpeed: (v) => set({ mousePanSpeed: v }),
      setMouseScrollSpeed: (v) => set({ mouseScrollSpeed: v }),
    }),
    { name: 'viewer-settings' },
  ),
);
