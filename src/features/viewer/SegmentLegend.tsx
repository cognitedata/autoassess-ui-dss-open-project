import { cn } from '../../lib/utils';

import type { CampaignCadModel } from './reveal/CampaignCadModelService';
import { useSegmentLegendViewModel } from './useSegmentLegendViewModel';

interface SegmentLegendProps {
  cadModels: CampaignCadModel[];
  className?: string;
}

/**
 * Overlay listing the mesh segment classes ("manhole", "structure", …) with their colours
 * while the mesh is in the Defects colour mode. Renders nothing otherwise.
 */
export function SegmentLegend({ cadModels, className }: SegmentLegendProps) {
  const { visible, entries, overflowCount } = useSegmentLegendViewModel(cadModels);
  if (!visible) return null;
  return (
    <div
      className={cn('rounded-lg bg-black/60 px-3 py-2 text-sm text-white backdrop-blur-sm', className)}
      data-testid="segment-legend"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-white/70">Segments</p>
      <ul className="mt-1 space-y-1">
        {entries.map((entry) => (
          <li key={entry.colourHex} className="flex items-center gap-2">
            <span
              aria-hidden
              data-testid="segment-legend-swatch"
              className="h-3 w-3 shrink-0 rounded-sm"
              style={{ backgroundColor: `#${entry.colourHex}` }}
            />
            <span className={entry.named ? undefined : 'font-mono text-white/70'}>{entry.label}</span>
          </li>
        ))}
      </ul>
      {overflowCount > 0 && <p className="mt-1 text-xs text-white/60">+{overflowCount} more</p>}
    </div>
  );
}
