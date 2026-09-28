import { create } from 'zustand';
import type { LayerType } from './LayerType';

export type ColorMode = 'colorization' | 'defects';

interface ColorModeState {
  modes: Partial<Record<LayerType, ColorMode>>;
  setColorMode(layerType: LayerType, mode: ColorMode): void;
  getColorMode(layerType: LayerType): ColorMode;
}

export const useColorModeStore = create<ColorModeState>((set, get) => ({
  modes: {},

  setColorMode(layerType: LayerType, mode: ColorMode): void {
    set((state) => ({ modes: { ...state.modes, [layerType]: mode } }));
  },

  getColorMode(layerType: LayerType): ColorMode {
    return get().modes[layerType] ?? 'colorization';
  },
}));
