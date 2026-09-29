import { renderHook } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CampaignCadModel } from './reveal/CampaignCadModelService';
import {
  MAX_LEGEND_ENTRIES,
  SegmentLegendViewModelContext,
  useSegmentLegendViewModel,
} from './useSegmentLegendViewModel';
import type { SegmentLegendViewModelContextType } from './useSegmentLegendViewModel';

describe(useSegmentLegendViewModel.name, () => {
  let mockContext: SegmentLegendViewModelContextType;
  let wrapper: ComponentType<{ children: ReactNode }>;

  beforeEach(() => {
    mockContext = { useMeshColorMode: vi.fn(() => 'defects' as const) };
    wrapper = ({ children }) => (
      <SegmentLegendViewModelContext.Provider value={mockContext}>{children}</SegmentLegendViewModelContext.Provider>
    );
  });

  it('lists each named class once with its colour, merging texture chunks', () => {
    const models = [
      cadModel({
        palette: { manhole_c0: [255, 0, 0], manhole_c1: [255, 0, 0], structure_c0: [0, 255, 0] },
        legend: { ff0000: 'manhole', '00ff00': 'structure' },
      }),
    ];

    const { result } = renderHook(() => useSegmentLegendViewModel(models), { wrapper });

    expect(result.current.visible).toBe(true);
    expect(result.current.entries).toEqual([
      { colourHex: 'ff0000', label: 'manhole', named: true },
      { colourHex: '00ff00', label: 'structure', named: true },
    ]);
    expect(result.current.overflowCount).toBe(0);
  });

  it('appends unnamed segment colours as hex fallback entries after the named ones', () => {
    const models = [
      cadModel({
        palette: { seg_0080ff_c0: [0, 128, 255], manhole_c0: [255, 0, 0] },
        legend: { ff0000: 'manhole' },
      }),
    ];

    const { result } = renderHook(() => useSegmentLegendViewModel(models), { wrapper });

    expect(result.current.entries).toEqual([
      { colourHex: 'ff0000', label: 'manhole', named: true },
      { colourHex: '0080ff', label: '#0080ff', named: false },
    ]);
  });

  it('merges the palettes and legends of several models without duplicates', () => {
    const models = [
      cadModel({ palette: { manhole: [255, 0, 0] }, legend: { ff0000: 'manhole' } }),
      cadModel({ palette: { manhole: [255, 0, 0], structure: [0, 255, 0] }, legend: { ff0000: 'manhole', '00ff00': 'structure' } }),
    ];

    const { result } = renderHook(() => useSegmentLegendViewModel(models), { wrapper });

    expect(result.current.entries.map((e) => e.label)).toEqual(['manhole', 'structure']);
  });

  it('is hidden when the mesh colour mode is not defects', () => {
    vi.mocked(mockContext.useMeshColorMode).mockReturnValue('colorization');
    const models = [cadModel({ palette: { manhole: [255, 0, 0] }, legend: { ff0000: 'manhole' } })];

    const { result } = renderHook(() => useSegmentLegendViewModel(models), { wrapper });

    expect(result.current.visible).toBe(false);
    expect(result.current.entries).toEqual([]);
  });

  it('is hidden when there are no models or no palette entries', () => {
    const { result: noModels } = renderHook(() => useSegmentLegendViewModel([]), { wrapper });
    const { result: emptyPalette } = renderHook(
      () => useSegmentLegendViewModel([cadModel({ palette: {}, legend: {} })]),
      { wrapper },
    );

    expect(noModels.current.visible).toBe(false);
    expect(emptyPalette.current.visible).toBe(false);
  });

  it('is hidden when no segment has a class name (a legend would add nothing)', () => {
    const models = [cadModel({ palette: { seg_ff0000: [255, 0, 0] }, legend: {} })];

    const { result } = renderHook(() => useSegmentLegendViewModel(models), { wrapper });

    expect(result.current.visible).toBe(false);
  });

  it('caps the entries and reports how many colours were left out', () => {
    const palette: CampaignCadModel['palette'] = { manhole: [255, 0, 0] };
    for (let i = 0; i < MAX_LEGEND_ENTRIES + 5; i += 1) {
      palette[`seg_c${i}`] = [i, i, 100];
    }
    const models = [cadModel({ palette, legend: { ff0000: 'manhole' } })];

    const { result } = renderHook(() => useSegmentLegendViewModel(models), { wrapper });

    expect(result.current.entries).toHaveLength(MAX_LEGEND_ENTRIES);
    expect(result.current.entries[0]).toEqual({ colourHex: 'ff0000', label: 'manhole', named: true });
    expect(result.current.overflowCount).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cadModel(overrides: Partial<CampaignCadModel>): CampaignCadModel {
  return {
    key: 'result-1/f1-cad-model',
    campaignExternalId: 'result-1',
    sourceFileId: 11,
    modelId: 500,
    revisionId: 600,
    status: 'Done',
    collisionProxyFileId: 700,
    hasTexture: true,
    palette: {},
    legend: {},
    ...overrides,
  };
}
