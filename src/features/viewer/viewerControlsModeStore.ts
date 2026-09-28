import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ControlsMode = 'free' | 'ground-plane';

interface ViewerControlsModeState {
  mode: ControlsMode;
  setMode(mode: ControlsMode): void;
}

export const useViewerControlsModeStore = create<ViewerControlsModeState>()(
  persist(
    (set) => ({
      mode: 'free',
      setMode: (mode) => set({ mode }),
    }),
    { name: 'viewer-controls-mode' },
  ),
);
