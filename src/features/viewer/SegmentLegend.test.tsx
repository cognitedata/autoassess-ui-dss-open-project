import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CampaignCadModel } from './reveal/CampaignCadModelService';
import { SegmentLegend } from './SegmentLegend';
import { SegmentLegendViewModelContext } from './useSegmentLegendViewModel';
import type { SegmentLegendViewModelContextType } from './useSegmentLegendViewModel';

describe(SegmentLegend.name, () => {
  let mockContext: SegmentLegendViewModelContextType;

  beforeEach(() => {
    mockContext = {
      useMeshColorMode: vi.fn(() => 'defects' as const),
      useCampaignLayerVisibility: vi.fn(() => ({ 'result-1': { MESH: true } })),
    };
  });

  it('shows each class name with a swatch of its segment colour', () => {
    renderLegend([
      cadModel({
        palette: { manhole_c0: [255, 0, 0], structure_c0: [0, 255, 0] },
        legend: { ff0000: 'manhole', '00ff00': 'structure' },
      }),
    ]);

    expect(screen.getByTestId('segment-legend')).toBeInTheDocument();
    expect(screen.getByText('manhole')).toBeInTheDocument();
    expect(screen.getByText('structure')).toBeInTheDocument();
    const swatches = screen.getAllByTestId('segment-legend-swatch');
    expect(swatches[0]).toHaveStyle({ backgroundColor: '#ff0000' });
    expect(swatches[1]).toHaveStyle({ backgroundColor: '#00ff00' });
  });

  it('falls back to the hex code for segments without a class name', () => {
    renderLegend([
      cadModel({
        palette: { manhole_c0: [255, 0, 0], seg_0080ff_c0: [0, 128, 255] },
        legend: { ff0000: 'manhole' },
      }),
    ]);

    expect(screen.getByText('#0080ff')).toBeInTheDocument();
  });

  it('renders nothing when the mesh is not in Segments colour mode', () => {
    vi.mocked(mockContext.useMeshColorMode).mockReturnValue('colorization');

    renderLegend([cadModel({ palette: { manhole: [255, 0, 0] }, legend: { ff0000: 'manhole' } })]);

    expect(screen.queryByTestId('segment-legend')).not.toBeInTheDocument();
  });

  it('renders nothing when no model carries a palette with class names', () => {
    renderLegend([cadModel({ palette: { seg_ff0000: [255, 0, 0] }, legend: {} })]);

    expect(screen.queryByTestId('segment-legend')).not.toBeInTheDocument();
  });

  it('renders nothing when the only palette-bearing campaign\'s mesh layer is hidden', () => {
    vi.mocked(mockContext.useCampaignLayerVisibility).mockReturnValue({ 'result-1': { MESH: false } });

    renderLegend([cadModel({ palette: { manhole: [255, 0, 0] }, legend: { ff0000: 'manhole' } })]);

    expect(screen.queryByTestId('segment-legend')).not.toBeInTheDocument();
  });

  it('summarises colours beyond the cap as "+N more"', () => {
    const palette: CampaignCadModel['palette'] = { manhole: [255, 0, 0] };
    for (let i = 0; i < 15; i += 1) {
      palette[`seg_c${i}`] = [i, i, 100];
    }

    renderLegend([cadModel({ palette, legend: { ff0000: 'manhole' } })]);

    expect(screen.getByText('+6 more')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function renderLegend(models: CampaignCadModel[]) {
    return render(
      <SegmentLegendViewModelContext.Provider value={mockContext}>
        <SegmentLegend cadModels={models} />
      </SegmentLegendViewModelContext.Provider>,
    );
  }
});

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
