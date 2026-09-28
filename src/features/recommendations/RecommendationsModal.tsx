import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Loader,
} from '@cognite/aura/components';

import {
  useRecommendationsViewModel,
  RecommendationsViewModelContext,
} from './useRecommendationsViewModel';
import type { Recommendation } from './types';
import type { NewTask } from '../viewer/InspectionTaskService';

export { RecommendationsViewModelContext };

interface RecommendationsModalProps {
  areaSpace: string;
  areaExternalId: string;
  /** suggestionId values of tasks already in the active plan. */
  existingTaskSuggestionIds: Set<string>;
  isOpen: boolean;
  onClose(): void;
  onAddTask(task: NewTask): void;
  isAddingTask: boolean;
}

export function RecommendationsModal({
  areaSpace,
  areaExternalId,
  existingTaskSuggestionIds,
  isOpen,
  onClose,
  onAddTask,
  isAddingTask,
}: RecommendationsModalProps) {
  const { recommendations, isLoading, error } = useRecommendationsViewModel(
    areaSpace,
    areaExternalId,
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] max-w-md flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Suggestions</DialogTitle>
        </DialogHeader>

        {isLoading && (
          <div className="flex justify-center py-8">
            <Loader role="status" size={24} />
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive">Failed to load suggestions: {error.message}</p>
        )}

        {!isLoading && !error && recommendations.length === 0 && (
          <p className="py-4 text-sm text-muted-foreground">
            No recommendations for this area.
          </p>
        )}

        {!isLoading && !error && recommendations.length > 0 && (
          <ul className="flex flex-col divide-y divide-border overflow-y-auto" aria-label="Inspection recommendations">
            {recommendations.map((rec) => (
              <RecommendationRow
                key={rec.id}
                recommendation={rec}
                alreadyAdded={existingTaskSuggestionIds.has(rec.id)}
                onAddTask={onAddTask}
                isAddingTask={isAddingTask}
              />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface RecommendationRowProps {
  recommendation: Recommendation;
  alreadyAdded: boolean;
  onAddTask(task: NewTask): void;
  isAddingTask: boolean;
}

function RecommendationRow({
  recommendation,
  alreadyAdded,
  onAddTask,
  isAddingTask,
}: RecommendationRowProps) {
  const { badge, description } = formatRecommendation(recommendation);
  const task = recommendationToTask(recommendation);

  return (
    <li className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="mb-1">
          <Badge variant="secondary">{badge}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {alreadyAdded ? (
        <span
          className="shrink-0 text-sm text-muted-foreground"
          aria-label="Already added to plan"
        >
          ✓ Added
        </span>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={isAddingTask}
          onClick={() => onAddTask(task)}
        >
          Add to plan
        </Button>
      )}
    </li>
  );
}

function formatRecommendation(rec: Recommendation): { badge: string; description: string } {
  if (rec.kind === 'ndt_repeat') {
    return {
      badge: 'NDT Repeat',
      description: `Thickness ${rec.source.thicknessMm.toFixed(1)} mm on ${rec.campaignDate} — below ${rec.thresholdMm} mm threshold`,
    };
  }
  return {
    badge: 'Confirmed Defect',
    description: `Confirmed ${rec.source.defectClass} from ${rec.campaignDate}`,
  };
}

function recommendationToTask(rec: Recommendation): NewTask {
  if (rec.kind === 'ndt_repeat') {
    return {
      taskKind: 'region',
      inspectionType: 'ndt_thickness',
      position3d: rec.source.position3d,
      normalVector: [0, 1, 0],
      radiusM: 0.3,
      suggestionId: rec.id,
    };
  }

  const [cx, cy, cz, hx, hy, hz] = rec.source.boundingBox3d;
  return {
    taskKind: 'region',
    inspectionType: 'visual',
    position3d: [cx ?? 0, cy ?? 0, cz ?? 0],
    normalVector: [0, 1, 0],
    radiusM: Math.max(hx ?? 0.3, hy ?? 0.3, hz ?? 0.3),
    suggestionId: rec.id,
  };
}
