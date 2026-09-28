import { Alert, AlertDescription, Loader } from '@cognite/aura/components';
import { IconChevronDown, IconChevronRight, IconCircle, IconCircleFilled, IconDotsVertical, IconFileAnalytics } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import type { ColorMode } from './colorModeStore';
import type { CampaignRowViewModel, LayerPanelViewModel, LayerRowViewModel, PcdLayerViewModel } from './useLayerPanelViewModel';
import type { LayerType } from './LayerType';

interface LayerPanelProps {
  viewModel: LayerPanelViewModel;
  onViewReport?: (campaignId: string) => void;
}

export function LayerPanel({ viewModel, onViewReport }: LayerPanelProps) {
  const { campaigns, staticLayers, isLoading, error, isEmpty, onToggleCampaignExpanded, onToggleLayer, onToggleStaticLayer, onTogglePcdLayer, onColorModeChange } = viewModel;

  return (
    <div className="flex flex-col px-3 py-3">
      {isLoading && (
        <div className="flex flex-1 items-center justify-center">
          <Loader role="status" size={20} />
        </div>
      )}

      {error && (
        <Alert variant="error" role="alert">
          <AlertDescription>Failed to load campaigns: {error.message}</AlertDescription>
        </Alert>
      )}

      {isEmpty && (
        <p className="text-sm text-muted-foreground">No inspection campaigns found.</p>
      )}

      {!isLoading && !error && staticLayers.length > 0 && (
        <div className="mb-3">
          <p className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Area</p>
          {staticLayers.map((layer) => (
            <LayerRow
              key={layer.layerType}
              layer={layer}
              onToggle={() => onToggleStaticLayer(layer.layerType, !layer.isVisible)}
              onColorModeChange={(mode) => onColorModeChange(layer.layerType, mode)}
            />
          ))}
        </div>
      )}

      {!isLoading && !error && campaigns.length > 0 && (
        <div>
          <p className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Campaigns</p>
          {campaigns.map((campaign) => (
            <CampaignNode
              key={campaign.campaignId}
              campaign={campaign}
              onToggleExpanded={() => onToggleCampaignExpanded(campaign.campaignId)}
              onToggleLayer={(layerType, visible) => onToggleLayer(campaign.campaignId, layerType, visible)}
              onTogglePcdLayer={onTogglePcdLayer}
              onColorModeChange={onColorModeChange}
              onViewReport={onViewReport}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface CampaignNodeProps {
  campaign: CampaignRowViewModel;
  onToggleExpanded: () => void;
  onToggleLayer: (layerType: LayerType, visible: boolean) => void;
  onTogglePcdLayer: (key: string, visible: boolean) => void;
  onColorModeChange: (layerType: LayerType, mode: ColorMode) => void;
  onViewReport?: (campaignId: string) => void;
}

function CampaignNode({ campaign, onToggleExpanded, onToggleLayer, onTogglePcdLayer, onColorModeChange, onViewReport }: CampaignNodeProps) {
  return (
    <div className="mb-1">
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          role="button"
          aria-expanded={campaign.isExpanded}
          onClick={onToggleExpanded}
          className={cn(
            'flex flex-1 items-center gap-1.5 rounded px-1 py-1.5 text-left text-sm font-medium',
            'hover:bg-accent transition-colors',
          )}
        >
          {campaign.isExpanded ? (
            <IconChevronDown size={14} aria-hidden />
          ) : (
            <IconChevronRight size={14} aria-hidden />
          )}
          <span className="truncate">{campaign.label}</span>
        </button>
        {onViewReport && (
          <button
            type="button"
            aria-label={`View report for ${campaign.label}`}
            onClick={() => onViewReport(campaign.campaignId)}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <IconFileAnalytics size={14} aria-hidden />
          </button>
        )}
      </div>

      {campaign.isExpanded && (
        <ul className="ml-4 mt-0.5 space-y-0.5">
          {campaign.layers.map((layer) => (
            <LayerRow
              key={layer.layerType}
              layer={layer}
              onToggle={() => onToggleLayer(layer.layerType, !layer.isVisible)}
              onColorModeChange={(mode) => onColorModeChange(layer.layerType, mode)}
            />
          ))}
          {campaign.pcdLayers.map((layer) => (
            <PcdRow
              key={layer.key}
              layer={layer}
              onToggle={() => onTogglePcdLayer(layer.key, !layer.isVisible)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface LayerRowProps {
  layer: LayerRowViewModel;
  onToggle: () => void;
  onColorModeChange: (mode: ColorMode) => void;
}

interface PcdRowProps {
  layer: PcdLayerViewModel;
  onToggle: () => void;
}

function PcdRow({ layer, onToggle }: PcdRowProps) {
  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={layer.isVisible}
        aria-label={layer.label}
        onClick={onToggle}
        className={cn(
          'flex w-full items-center gap-2 rounded px-1 py-1 text-left text-sm',
          'hover:bg-accent transition-colors',
          layer.isVisible ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {layer.isVisible ? (
          <IconCircleFilled size={10} className="shrink-0 text-green-500" aria-hidden />
        ) : (
          <IconCircle size={10} className="shrink-0" aria-hidden />
        )}
        <span className="truncate">{layer.label}</span>
      </button>
    </li>
  );
}

function LayerRow({ layer, onToggle, onColorModeChange }: LayerRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);

  return (
    <li className="flex items-center gap-1">
      <button
        type="button"
        role="checkbox"
        aria-checked={layer.isVisible}
        aria-label={layer.label}
        onClick={onToggle}
        className={cn(
          'flex flex-1 items-center gap-2 rounded px-1 py-1 text-left text-sm',
          'hover:bg-accent transition-colors',
          layer.isVisible ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {layer.isVisible ? (
          <IconCircleFilled size={10} className="shrink-0 text-green-500" aria-hidden />
        ) : (
          <IconCircle size={10} className="shrink-0" aria-hidden />
        )}
        <span className="truncate">{layer.label}</span>
      </button>

      {layer.supportsColorMode && (
        <div className="relative shrink-0" ref={menuRef}>
          <button
            type="button"
            aria-label="Color mode options"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
            className={cn(
              'rounded p-1 text-muted-foreground transition-colors',
              'hover:bg-accent hover:text-foreground',
              menuOpen && 'bg-accent text-foreground',
            )}
          >
            <IconDotsVertical size={14} aria-hidden />
          </button>

          {menuOpen && (
            <div
              className="absolute right-0 z-50 mt-1 min-w-[8rem] rounded border border-border bg-popover py-1 shadow-md"
              role="menu"
            >
              {(['colorization', 'defects'] as ColorMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="menuitemradio"
                  aria-checked={layer.colorMode === mode}
                  onClick={() => { onColorModeChange(mode); setMenuOpen(false); }}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
                    'hover:bg-accent transition-colors',
                    layer.colorMode === mode ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {layer.colorMode === mode ? (
                    <IconCircleFilled size={8} className="shrink-0 text-green-500" aria-hidden />
                  ) : (
                    <IconCircle size={8} className="shrink-0" aria-hidden />
                  )}
                  {mode === 'colorization' ? 'Colorization' : 'Defects'}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
