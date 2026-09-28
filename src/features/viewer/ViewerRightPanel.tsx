import { cn } from '../../lib/utils';

import { EditCampaignDialog } from './campaigns/EditCampaignDialog';
import type { EditCampaignViewModel } from './campaigns/useEditCampaignViewModel';
import type { DefectDetection } from './DefectDetectionService';
import { DefectsPanel } from './DefectsPanel';
import { InspectionPlansPanel } from './InspectionPlansPanel';
import type { InspectionTask } from './InspectionTaskService';
import { LayerPanel } from './LayerPanel';
import type { DefectsPanelViewModel } from './useDefectsPanelViewModel';
import type { InspectionPlansViewModel } from './useInspectionPlansViewModel';
import type { LayerPanelViewModel } from './useLayerPanelViewModel';

export type RightPanelTab = 'layers' | 'plans' | 'defects';

interface ViewerRightPanelProps {
  layerPanelViewModel: LayerPanelViewModel;
  /** Edit-campaign / new-campaign dialog; omitted = campaigns are read-only here. */
  editCampaignViewModel?: EditCampaignViewModel;
  inspectionPlansViewModel: InspectionPlansViewModel;
  defectsPanelViewModel: DefectsPanelViewModel;
  activeTab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
  onDefectSelected?: (defect: DefectDetection) => void;
  onViewReport?: (campaignId: string) => void;
  onTaskSelected?: (task: InspectionTask) => void;
  onTaskHovered?: (task: InspectionTask | null) => void;
  areaSpace: string;
  areaExternalId: string;
}

export function ViewerRightPanel({
  layerPanelViewModel,
  editCampaignViewModel,
  inspectionPlansViewModel,
  defectsPanelViewModel,
  activeTab,
  onTabChange,
  onDefectSelected,
  onViewReport,
  onTaskSelected,
  onTaskHovered,
  areaSpace,
  areaExternalId,
}: ViewerRightPanelProps) {

  return (
    <aside
      aria-label="Right panel"
      className="flex h-full w-[280px] shrink-0 flex-col border-l border-border bg-background/90 backdrop-blur-sm"
    >
      <div
        role="tablist"
        aria-label="Right panel tabs"
        className="flex shrink-0 border-b border-border"
      >
        <TabButton id="tab-layers" controls="panel-layers" isActive={activeTab === 'layers'} onClick={() => onTabChange('layers')}>
          Layers
        </TabButton>
        <TabButton id="tab-plans" controls="panel-plans" isActive={activeTab === 'plans'} onClick={() => onTabChange('plans')}>
          Plans
        </TabButton>
        <TabButton id="tab-defects" controls="panel-defects" isActive={activeTab === 'defects'} onClick={() => onTabChange('defects')}>
          Defects
        </TabButton>
      </div>

      <div
        role="tabpanel"
        id="panel-layers"
        aria-labelledby="tab-layers"
        hidden={activeTab !== 'layers'}
        className="flex-1 overflow-y-auto"
      >
        <LayerPanel
          viewModel={layerPanelViewModel}
          onViewReport={onViewReport}
          onEditCampaign={editCampaignViewModel?.openEdit}
          onNewCampaign={editCampaignViewModel?.openCreate}
        />
        {editCampaignViewModel && <EditCampaignDialog viewModel={editCampaignViewModel} />}
      </div>

      <div
        role="tabpanel"
        id="panel-plans"
        aria-labelledby="tab-plans"
        hidden={activeTab !== 'plans'}
        className="flex-1 overflow-y-auto"
      >
        <InspectionPlansPanel
          viewModel={inspectionPlansViewModel}
          areaSpace={areaSpace}
          areaExternalId={areaExternalId}
          onTaskSelected={onTaskSelected}
          onTaskHovered={onTaskHovered}
        />
      </div>

      <div
        role="tabpanel"
        id="panel-defects"
        aria-labelledby="tab-defects"
        hidden={activeTab !== 'defects'}
        className="flex-1 overflow-hidden"
      >
        <DefectsPanel viewModel={defectsPanelViewModel} onDefectSelected={onDefectSelected} />
      </div>
    </aside>
  );
}

// ---- Shared tab button ----

interface TabButtonProps {
  id: string;
  controls: string;
  isActive: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function TabButton({ id, controls, isActive, onClick, children }: TabButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-controls={controls}
      aria-selected={isActive}
      onClick={onClick}
      className={cn(
        'flex-1 px-3 py-2 text-sm font-medium transition-colors',
        isActive
          ? 'border-b-2 border-primary text-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
