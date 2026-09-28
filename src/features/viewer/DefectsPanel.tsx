import { Badge, Loader } from '@cognite/aura/components';

import { cn } from '../../lib/utils';

import type { DefectDetection, DefectStatus } from './DefectDetectionService';
import type { DefectsPanelViewModel, SortKey } from './useDefectsPanelViewModel';

interface DefectsPanelProps {
  viewModel: DefectsPanelViewModel;
  onDefectSelected?: (defect: DefectDetection) => void;
}

export function DefectsPanel({ viewModel, onDefectSelected }: DefectsPanelProps) {
  const {
    defects,
    isLoading,
    error,
    sortKey,
    setSortKey,
    selectedDefectId,
  } = viewModel;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader role="status" size={24} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-destructive">
        Failed to load defects: {error.message}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Sort toolbar */}
      <div
        role="toolbar"
        aria-label="Sort defects"
        className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2"
      >
        <span className="text-xs text-muted-foreground mr-1">Sort:</span>
        <SortButton label="Confidence" value="probability" current={sortKey} onSelect={setSortKey} />
        <SortButton label="Status" value="status" current={sortKey} onSelect={setSortKey} />
      </div>

      {/* Defect list */}
      {defects.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center py-8 text-center px-4">
          <p className="text-sm font-medium text-foreground">No defects recorded for this area.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Defect detection results will appear here once a campaign is complete.
          </p>
        </div>
      ) : (
        <ul
          className="flex flex-1 flex-col gap-0 overflow-y-auto"
          aria-label="Detected defects"
        >
          {defects.map((defect) => (
            <DefectRow
              key={defect.externalId}
              defect={defect}
              isSelected={defect.externalId === selectedDefectId}
              onSelect={() => onDefectSelected?.(defect)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- Sort button ----

interface SortButtonProps {
  label: string;
  value: SortKey;
  current: SortKey;
  onSelect: (key: SortKey) => void;
}

function SortButton({ label, value, current, onSelect }: SortButtonProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      aria-pressed={current === value}
      className={cn(
        'rounded px-2 py-0.5 text-xs font-medium transition-colors',
        current === value
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

// ---- Defect row ----

const STATUS_LABELS: Record<DefectStatus, string> = {
  New: 'New',
  UnderReview: 'Under review',
  Confirmed: 'Confirmed',
  Dismissed: 'Dismissed',
};


interface DefectRowProps {
  defect: DefectDetection;
  isSelected: boolean;
  onSelect: () => void;
}

function DefectRow({ defect, isSelected, onSelect }: DefectRowProps) {
  const confidencePct = Math.round(defect.probability * 100);

  return (
    <li
      className={cn(
        'flex flex-col gap-2 border-b border-border px-3 py-2 cursor-pointer transition-colors',
        isSelected ? 'bg-accent' : 'hover:bg-muted/50',
      )}
      aria-selected={isSelected}
      onClick={onSelect}
    >
      {/* Top row: class label + confidence + status badge */}
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-foreground capitalize">
          {defect.defectClass || '—'}
        </span>
        <DefectStatusBadge status={defect.status} />
      </div>

      {/* Confidence bar */}
      <div className="flex items-center gap-2">
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label={`Confidence ${confidencePct}%`}
          aria-valuenow={confidencePct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${confidencePct}%` }}
          />
        </div>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {confidencePct}%
        </span>
      </div>
    </li>
  );
}

// ---- Status badge ----

function DefectStatusBadge({ status }: { status: DefectStatus }) {
  const variant =
    status === 'Confirmed'
      ? 'default'
      : status === 'Dismissed'
        ? 'archived'
        : status === 'UnderReview'
          ? 'secondary'
          : 'secondary';
  return <Badge variant={variant}>{STATUS_LABELS[status]}</Badge>;
}
