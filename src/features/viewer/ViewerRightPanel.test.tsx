import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import type { DefectsPanelViewModel } from './useDefectsPanelViewModel';
import type { InspectionPlansViewModel } from './useInspectionPlansViewModel';
import type { LayerPanelViewModel } from './useLayerPanelViewModel';
import { ViewerRightPanel } from './ViewerRightPanel';
import type { RightPanelTab } from './ViewerRightPanel';

function makeLayerPanelViewModel(overrides: Partial<LayerPanelViewModel> = {}): LayerPanelViewModel {
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

function makePlansViewModel(
  overrides: Partial<InspectionPlansViewModel> = {},
): InspectionPlansViewModel {
  return {
    plans: [],
    isLoadingPlans: false,
    activePlan: null,
    tasks: [],
    isLoadingTasks: false,
    availableMaps: [],
    defaultMapExternalId: null,
    canCreatePlan: true,
    createPlan: vi.fn(),
    isCreatingPlan: false,
    selectPlan: vi.fn(),
    deactivatePlan: vi.fn(),
    togglePlanStatus: vi.fn(),
    isTogglingStatus: false,
    updatePlan: vi.fn(),
    isUpdatingPlan: false,
    deletePlan: vi.fn(),
    isDeletingPlan: false,
    addTaskFromHit: vi.fn(),
    addTask: vi.fn(),
    isAddingTask: false,
    removeTask: vi.fn(),
    ...overrides,
  };
}

function makeDefectsViewModel(
  overrides: Partial<DefectsPanelViewModel> = {},
): DefectsPanelViewModel {
  return {
    defects: [],
    isLoading: false,
    error: null,
    sortKey: 'probability',
    setSortKey: vi.fn(),
    selectedDefectId: null,
    selectedDefect: null,
    updateStatus: vi.fn(),
    isUpdatingStatus: false,
    updateDefect: vi.fn(),
    isUpdatingDefect: false,
    createDefect: vi.fn(),
    isCreatingDefect: false,
    deleteDefect: vi.fn(),
    isDeletingDefect: false,
    ...overrides,
  };
}

function renderPanel(
  activeTab: RightPanelTab = 'layers',
  onTabChange = vi.fn(),
  layerVm = makeLayerPanelViewModel(),
  plansVm = makePlansViewModel(),
  defectsVm = makeDefectsViewModel(),
) {
  return render(
    <ViewerRightPanel
      layerPanelViewModel={layerVm}
      inspectionPlansViewModel={plansVm}
      defectsPanelViewModel={defectsVm}
      activeTab={activeTab}
      onTabChange={onTabChange}
      areaSpace="autoassess"
      areaExternalId="area-1"
    />,
  );
}

describe(ViewerRightPanel.name, () => {
  it('renders the right panel container', () => {
    renderPanel();
    expect(screen.getByRole('complementary', { name: 'Right panel' })).toBeDefined();
  });

  it('renders Layers, Plans and Defects tabs', () => {
    renderPanel();
    expect(screen.getByRole('tab', { name: 'Layers' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Plans' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Defects' })).toBeDefined();
  });

  it('Layers tab is selected when activeTab is layers', () => {
    renderPanel('layers');
    expect(screen.getByRole('tab', { name: 'Layers' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Plans' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tab', { name: 'Defects' }).getAttribute('aria-selected')).toBe('false');
  });

  it('Plans tab is selected when activeTab is plans', () => {
    renderPanel('plans');
    expect(screen.getByRole('tab', { name: 'Plans' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Layers' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tab', { name: 'Defects' }).getAttribute('aria-selected')).toBe('false');
  });

  it('Defects tab is selected when activeTab is defects', () => {
    renderPanel('defects');
    expect(screen.getByRole('tab', { name: 'Defects' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Layers' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tab', { name: 'Plans' }).getAttribute('aria-selected')).toBe('false');
  });

  it('Layers panel is visible when activeTab is layers', () => {
    renderPanel('layers');
    const layersPanel = screen.getByRole('tabpanel', { name: 'Layers' });
    expect(layersPanel.hidden).toBe(false);
    expect(document.getElementById('panel-plans')?.hidden).toBe(true);
    expect(document.getElementById('panel-defects')?.hidden).toBe(true);
  });

  it('Plans panel is visible when activeTab is plans', () => {
    renderPanel('plans');
    const plansPanel = screen.getByRole('tabpanel', { name: 'Plans' });
    expect(plansPanel.hidden).toBe(false);
    expect(document.getElementById('panel-layers')?.hidden).toBe(true);
    expect(document.getElementById('panel-defects')?.hidden).toBe(true);
  });

  it('Defects panel is visible when activeTab is defects', () => {
    renderPanel('defects');
    const defectsPanel = screen.getByRole('tabpanel', { name: 'Defects' });
    expect(defectsPanel.hidden).toBe(false);
    expect(document.getElementById('panel-layers')?.hidden).toBe(true);
    expect(document.getElementById('panel-plans')?.hidden).toBe(true);
  });

  it('calls onTabChange("plans") when Plans tab is clicked', async () => {
    const onTabChange = vi.fn();
    renderPanel('layers', onTabChange);
    await userEvent.click(screen.getByRole('tab', { name: 'Plans' }));
    expect(onTabChange).toHaveBeenCalledWith('plans');
  });

  it('calls onTabChange("layers") when Layers tab is clicked', async () => {
    const onTabChange = vi.fn();
    renderPanel('plans', onTabChange);
    await userEvent.click(screen.getByRole('tab', { name: 'Layers' }));
    expect(onTabChange).toHaveBeenCalledWith('layers');
  });

  it('calls onTabChange("defects") when Defects tab is clicked', async () => {
    const onTabChange = vi.fn();
    renderPanel('layers', onTabChange);
    await userEvent.click(screen.getByRole('tab', { name: 'Defects' }));
    expect(onTabChange).toHaveBeenCalledWith('defects');
  });

  it('Layers panel shows campaign content from layerPanelViewModel', () => {
    renderPanel('layers', vi.fn(), makeLayerPanelViewModel({ isEmpty: true }));
    expect(screen.getByText('No inspection campaigns found.')).toBeDefined();
  });

  it('Plans panel shows empty state from inspectionPlansViewModel', () => {
    renderPanel('plans');
    expect(screen.getByText('No inspection plans yet.')).toBeDefined();
  });

  it('Defects panel shows empty state from defectsPanelViewModel', () => {
    renderPanel('defects');
    expect(screen.getByText('No defects recorded for this area.')).toBeDefined();
  });

  it('passes onViewReport to LayerPanel', () => {
    const onViewReport = vi.fn();
    const campaign = {
      campaignId: 'c1',
      label: 'Campaign 2024-09-15',
      isExpanded: false,
      layers: [],
      pcdLayers: [],
    };
    render(
      <ViewerRightPanel
        layerPanelViewModel={makeLayerPanelViewModel({ campaigns: [campaign] })}
        inspectionPlansViewModel={makePlansViewModel()}
        defectsPanelViewModel={makeDefectsViewModel()}
        activeTab="layers"
        onTabChange={vi.fn()}
        onViewReport={onViewReport}
        areaSpace="autoassess"
        areaExternalId="area-1"
      />,
    );
    expect(screen.getByRole('button', { name: /view report/i })).toBeInTheDocument();
  });
});
