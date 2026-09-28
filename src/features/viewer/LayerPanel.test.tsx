import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { LayerPanel } from './LayerPanel';
import type { LayerPanelViewModel, LayerRowViewModel } from './useLayerPanelViewModel';

function makeViewModel(overrides: Partial<LayerPanelViewModel> = {}): LayerPanelViewModel {
  return {
    campaigns: [],
    allPcdFileIds: [],
    allPlyEntries: [],
    staticLayers: [],
    isLoading: false,
    error: null,
    isEmpty: false,
    onToggleLayer: vi.fn(),
    onToggleStaticLayer: vi.fn(),
    onToggleCampaignExpanded: vi.fn(),
    onTogglePcdLayer: vi.fn(),
    onColorModeChange: vi.fn(),
    ...overrides,
  };
}

function makeLayer(overrides: Partial<LayerRowViewModel> = {}): LayerRowViewModel {
  return {
    layerType: 'SEMANTIC_SEG',
    label: 'Structural elements',
    isVisible: true,
    colorMode: 'colorization',
    supportsColorMode: false,
    ...overrides,
  };
}

function makeCampaign(overrides: Record<string, unknown> = {}) {
  return {
    campaignId: 'c1',
    label: 'Campaign 2024-09-15',
    isExpanded: true,
    layers: [makeLayer()],
    pcdLayers: [] as { key: string; label: string; isVisible: boolean }[],
    ...overrides,
  };
}

describe(LayerPanel.name, () => {
  it('renders a Loader when isLoading is true', () => {
    render(<LayerPanel viewModel={makeViewModel({ isLoading: true })} />);
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('does not render campaigns while loading', () => {
    render(
      <LayerPanel
        viewModel={makeViewModel({
          isLoading: true,
          campaigns: [makeCampaign()],
        })}
      />,
    );
    expect(screen.queryByText('Campaign 2024-09-15')).toBeNull();
  });

  it('renders an error Alert when error is set', () => {
    render(
      <LayerPanel viewModel={makeViewModel({ error: new Error('CDF error') })} />,
    );
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText(/Failed to load campaigns/)).toBeDefined();
  });

  it('renders empty state message when isEmpty is true', () => {
    render(<LayerPanel viewModel={makeViewModel({ isEmpty: true })} />);
    expect(screen.getByText('No inspection campaigns found.')).toBeDefined();
  });

  it('renders a campaign node for each campaign', () => {
    render(
      <LayerPanel
        viewModel={makeViewModel({
          campaigns: [
            makeCampaign({ campaignId: 'c1', label: 'Campaign 2024-09-15' }),
            makeCampaign({ campaignId: 'c2', label: 'Campaign 2024-03-01', isExpanded: false, layers: [] }),
          ],
        })}
      />,
    );
    expect(screen.getByText('Campaign 2024-09-15')).toBeDefined();
    expect(screen.getByText('Campaign 2024-03-01')).toBeDefined();
  });

  it('renders layer rows when campaign is expanded', () => {
    render(
      <LayerPanel
        viewModel={makeViewModel({ campaigns: [makeCampaign({ isExpanded: true })] })}
      />,
    );
    expect(screen.getByText('Structural elements')).toBeDefined();
  });

  it('does not render layer rows when campaign is collapsed', () => {
    render(
      <LayerPanel
        viewModel={makeViewModel({ campaigns: [makeCampaign({ isExpanded: false })] })}
      />,
    );
    expect(screen.queryByText('Structural elements')).toBeNull();
  });

  it('campaign header has aria-expanded=true when expanded', () => {
    render(
      <LayerPanel
        viewModel={makeViewModel({ campaigns: [makeCampaign({ isExpanded: true })] })}
      />,
    );
    const btn = screen.getByRole('button', { name: /Campaign 2024-09-15/ });
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  it('campaign header has aria-expanded=false when collapsed', () => {
    render(
      <LayerPanel
        viewModel={makeViewModel({ campaigns: [makeCampaign({ isExpanded: false })] })}
      />,
    );
    const btn = screen.getByRole('button', { name: /Campaign 2024-09-15/ });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('clicking campaign header calls onToggleCampaignExpanded with campaignId', async () => {
    const onToggleCampaignExpanded = vi.fn();
    render(
      <LayerPanel
        viewModel={makeViewModel({
          campaigns: [makeCampaign({ campaignId: 'c1' })],
          onToggleCampaignExpanded,
        })}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Campaign 2024-09-15/ }));
    expect(onToggleCampaignExpanded).toHaveBeenCalledWith('c1');
  });

  it('visible layer row has aria-checked=true', () => {
    render(
      <LayerPanel
        viewModel={makeViewModel({
          campaigns: [makeCampaign({ layers: [makeLayer({ isVisible: true })] })],
        })}
      />,
    );
    const checkbox = screen.getByRole('checkbox', { name: 'Structural elements' });
    expect(checkbox.getAttribute('aria-checked')).toBe('true');
  });

  it('invisible layer row has aria-checked=false', () => {
    render(
      <LayerPanel
        viewModel={makeViewModel({
          campaigns: [makeCampaign({ layers: [makeLayer({ isVisible: false })] })],
        })}
      />,
    );
    const checkbox = screen.getByRole('checkbox', { name: 'Structural elements' });
    expect(checkbox.getAttribute('aria-checked')).toBe('false');
  });

  it('clicking a layer row calls onToggleLayer with negated visibility', async () => {
    const onToggleLayer = vi.fn();
    render(
      <LayerPanel
        viewModel={makeViewModel({
          campaigns: [makeCampaign({ campaignId: 'c1', layers: [makeLayer({ isVisible: true })] })],
          onToggleLayer,
        })}
      />,
    );

    await userEvent.click(screen.getByRole('checkbox', { name: 'Structural elements' }));
    expect(onToggleLayer).toHaveBeenCalledWith('c1', 'SEMANTIC_SEG', false);
  });

  it('does not render color mode button for SEMANTIC_SEG layer', () => {
    render(
      <LayerPanel
        viewModel={makeViewModel({
          campaigns: [makeCampaign({ layers: [makeLayer({ supportsColorMode: false })] })],
        })}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Color mode options' })).toBeNull();
  });

  it('renders color mode button for MESH layer', () => {
    render(
      <LayerPanel
        viewModel={makeViewModel({
          campaigns: [makeCampaign({
            layers: [makeLayer({ layerType: 'MESH', label: 'Mesh', supportsColorMode: true })],
          })],
        })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Color mode options' })).toBeDefined();
  });

  it('clicking color mode button opens dropdown with Color and Semantics options', async () => {
    render(
      <LayerPanel
        viewModel={makeViewModel({
          campaigns: [makeCampaign({
            layers: [makeLayer({ layerType: 'MESH', label: 'Mesh', supportsColorMode: true })],
          })],
        })}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Color mode options' }));

    expect(screen.getByRole('menuitemradio', { name: /Color/ })).toBeDefined();
    expect(screen.getByRole('menuitemradio', { name: /Defects/ })).toBeDefined();
  });

  it('selecting a color mode option calls onColorModeChange and closes the menu', async () => {
    const onColorModeChange = vi.fn();
    render(
      <LayerPanel
        viewModel={makeViewModel({
          campaigns: [makeCampaign({
            layers: [makeLayer({ layerType: 'MESH', label: 'Mesh', supportsColorMode: true, colorMode: 'defects' })],
          })],
          onColorModeChange,
        })}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Color mode options' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: /Colorization/ }));

    expect(onColorModeChange).toHaveBeenCalledWith('MESH', 'colorization');
    expect(screen.queryByRole('menuitemradio', { name: /Defects/ })).toBeNull();
  });

  it('does not render PCD rows when campaign pcdLayers is empty', () => {
    render(
      <LayerPanel
        viewModel={makeViewModel({
          campaigns: [makeCampaign({ isExpanded: true, pcdLayers: [] })],
        })}
      />,
    );
    expect(screen.queryByRole('checkbox', { name: /Pointcloud|Labeled cloud/i })).toBeNull();
  });

  it('renders one PCD row per entry in campaign pcdLayers when expanded', () => {
    render(
      <LayerPanel
        viewModel={makeViewModel({
          campaigns: [makeCampaign({
            isExpanded: true,
            pcdLayers: [
              { key: '101', label: 'Pointcloud', isVisible: true },
              { key: '102', label: 'Labeled cloud', isVisible: false },
            ],
          })],
        })}
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'Pointcloud' })).toBeDefined();
    expect(screen.getByRole('checkbox', { name: 'Labeled cloud' })).toBeDefined();
  });

  it('PCD rows are hidden when campaign is collapsed', () => {
    render(
      <LayerPanel
        viewModel={makeViewModel({
          campaigns: [makeCampaign({
            isExpanded: false,
            pcdLayers: [{ key: '101', label: 'Pointcloud', isVisible: true }],
          })],
        })}
      />,
    );
    expect(screen.queryByRole('checkbox', { name: 'Pointcloud' })).toBeNull();
  });

  it('visible PCD row has aria-checked=true', () => {
    render(
      <LayerPanel
        viewModel={makeViewModel({
          campaigns: [makeCampaign({
            isExpanded: true,
            pcdLayers: [{ key: '101', label: 'Pointcloud', isVisible: true }],
          })],
        })}
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'Pointcloud' }).getAttribute('aria-checked')).toBe('true');
  });

  it('invisible PCD row has aria-checked=false', () => {
    render(
      <LayerPanel
        viewModel={makeViewModel({
          campaigns: [makeCampaign({
            isExpanded: true,
            pcdLayers: [{ key: '101', label: 'Pointcloud', isVisible: false }],
          })],
        })}
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'Pointcloud' }).getAttribute('aria-checked')).toBe('false');
  });

  it('clicking PCD row calls onTogglePcdLayer with key and negated visibility', async () => {
    const onTogglePcdLayer = vi.fn();
    render(
      <LayerPanel
        viewModel={makeViewModel({
          campaigns: [makeCampaign({
            isExpanded: true,
            pcdLayers: [{ key: '101', label: 'Pointcloud', isVisible: true }],
          })],
          onTogglePcdLayer,
        })}
      />,
    );
    await userEvent.click(screen.getByRole('checkbox', { name: 'Pointcloud' }));
    expect(onTogglePcdLayer).toHaveBeenCalledWith('101', false);
  });

  it('renders View report button when onViewReport is provided', () => {
    render(
      <LayerPanel
        viewModel={makeViewModel({ campaigns: [makeCampaign()] })}
        onViewReport={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /view report/i })).toBeInTheDocument();
  });

  it('does not render View report button when onViewReport is absent', () => {
    render(
      <LayerPanel viewModel={makeViewModel({ campaigns: [makeCampaign()] })} />,
    );
    expect(screen.queryByRole('button', { name: /view report/i })).toBeNull();
  });

  it('clicking View report button calls onViewReport with the campaignId', async () => {
    const onViewReport = vi.fn();
    render(
      <LayerPanel
        viewModel={makeViewModel({ campaigns: [makeCampaign({ campaignId: 'c1' })] })}
        onViewReport={onViewReport}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /view report/i }));
    expect(onViewReport).toHaveBeenCalledWith('c1');
  });

  it('clicking View report button does not toggle campaign expansion', async () => {
    const onToggleCampaignExpanded = vi.fn();
    render(
      <LayerPanel
        viewModel={makeViewModel({
          campaigns: [makeCampaign({ campaignId: 'c1' })],
          onToggleCampaignExpanded,
        })}
        onViewReport={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /view report/i }));
    expect(onToggleCampaignExpanded).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Static layers (area-level, rendered above campaigns)
  // ---------------------------------------------------------------------------

  it('does not render static layers section when staticLayers is empty', () => {
    render(<LayerPanel viewModel={makeViewModel({ staticLayers: [] })} />);
    expect(screen.queryByText('Area')).toBeNull();
  });

  it('renders static layers section with heading when staticLayers has items', () => {
    render(
      <LayerPanel
        viewModel={makeViewModel({
          staticLayers: [makeLayer({ layerType: 'SEMANTIC_SEG', label: 'Structural elements' })],
        })}
      />,
    );
    expect(screen.getByText('Area')).toBeDefined();
    expect(screen.getByRole('checkbox', { name: 'Structural elements' })).toBeDefined();
  });

  it('clicking a static layer row calls onToggleStaticLayer with negated visibility', async () => {
    const onToggleStaticLayer = vi.fn();
    render(
      <LayerPanel
        viewModel={makeViewModel({
          staticLayers: [makeLayer({ layerType: 'SEMANTIC_SEG', label: 'Structural elements', isVisible: true })],
          onToggleStaticLayer,
        })}
      />,
    );
    await userEvent.click(screen.getByRole('checkbox', { name: 'Structural elements' }));
    expect(onToggleStaticLayer).toHaveBeenCalledWith('SEMANTIC_SEG', false);
  });
});
