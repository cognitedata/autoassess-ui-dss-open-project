import { beforeEach, describe, expect, it } from 'vitest';
import { useColorModeStore } from './colorModeStore';

describe(useColorModeStore.name, () => {
  beforeEach(() => {
    useColorModeStore.setState({ modes: {} });
  });

  it('should default to "colorization" for any layer type', () => {
    expect(useColorModeStore.getState().getColorMode('MESH')).toBe('colorization');
    expect(useColorModeStore.getState().getColorMode('POINT_CLOUD')).toBe('colorization');
  });

  it('should return the set mode after setColorMode is called', () => {
    useColorModeStore.getState().setColorMode('MESH', 'colorization');

    expect(useColorModeStore.getState().getColorMode('MESH')).toBe('colorization');
  });

  it('should not affect other layer types when one is changed', () => {
    useColorModeStore.getState().setColorMode('MESH', 'defects');

    expect(useColorModeStore.getState().getColorMode('POINT_CLOUD')).toBe('colorization');
  });

  it('should allow switching back from colorization to defects', () => {
    useColorModeStore.getState().setColorMode('MESH', 'colorization');
    useColorModeStore.getState().setColorMode('MESH', 'defects');

    expect(useColorModeStore.getState().getColorMode('MESH')).toBe('defects');
  });
});
