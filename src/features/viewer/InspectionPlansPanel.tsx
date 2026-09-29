import { useState } from 'react';
import { Button, Badge, Loader } from '@cognite/aura/components';
import { IconPlus, IconChevronLeft, IconTrash, IconPencil } from '@tabler/icons-react';
import type { InspectionPlansViewModel } from './useInspectionPlansViewModel';
import type { InspectionPlan } from './InspectionPlanService';
import type { InspectionTask } from './InspectionTaskService';
import { INSPECTION_TYPE_LABELS } from './InspectionTaskService';
import { RecommendationsModal } from '../recommendations/RecommendationsModal';
import { PlanFormDialog } from './PlanFormDialog';
import { DeleteConfirmDialog } from '../../shared/components/DeleteConfirmDialog';

interface InspectionPlansPanelProps {
  viewModel: InspectionPlansViewModel;
  areaSpace: string;
  areaExternalId: string;
  onTaskSelected?: (task: InspectionTask) => void;
  onTaskHovered?: (task: InspectionTask | null) => void;
}

export function InspectionPlansPanel({
  viewModel,
  areaSpace,
  areaExternalId,
  onTaskSelected,
  onTaskHovered,
}: InspectionPlansPanelProps) {
  const {
    plans,
    isLoadingPlans,
    activePlan,
    tasks,
    isLoadingTasks,
    availableMaps,
    defaultMapExternalId,
    canCreatePlan,
    createPlan,
    isCreatingPlan,
    selectPlan,
    deactivatePlan,
    robotPlanExternalId,
    setPlanActive,
    setPlanInactive,
    togglePlanStatus,
    isTogglingStatus,
    updatePlan,
    isUpdatingPlan,
    deletePlan,
    isDeletingPlan,
    addTask,
    isAddingTask,
    removeTask,
  } = viewModel;

  if (isLoadingPlans) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader role="status" size={24} />
      </div>
    );
  }

  if (activePlan) {
    return (
      <ActivePlanView
        plan={activePlan}
        tasks={tasks}
        isLoadingTasks={isLoadingTasks}
        availableMaps={availableMaps}
        onBack={deactivatePlan}
        onToggleStatus={togglePlanStatus}
        isTogglingStatus={isTogglingStatus}
        onUpdatePlan={updatePlan}
        isUpdatingPlan={isUpdatingPlan}
        onDeletePlan={deletePlan}
        isDeletingPlan={isDeletingPlan}
        onRemoveTask={removeTask}
        onAddTask={addTask}
        isAddingTask={isAddingTask}
        areaSpace={areaSpace}
        areaExternalId={areaExternalId}
        onTaskSelected={onTaskSelected}
        onTaskHovered={onTaskHovered}
      />
    );
  }

  return (
    <PlanListView
      plans={plans}
      availableMaps={availableMaps}
      defaultMapExternalId={defaultMapExternalId}
      canCreatePlan={canCreatePlan}
      createPlan={createPlan}
      isCreatingPlan={isCreatingPlan}
      onSelectPlan={selectPlan}
      robotPlanExternalId={robotPlanExternalId}
      onSetPlanActive={setPlanActive}
      onSetPlanInactive={setPlanInactive}
      isTogglingStatus={isTogglingStatus}
    />
  );
}

// ---- Plan list ----

interface PlanListViewProps {
  plans: InspectionPlan[];
  availableMaps: InspectionPlansViewModel['availableMaps'];
  defaultMapExternalId: InspectionPlansViewModel['defaultMapExternalId'];
  canCreatePlan: boolean;
  createPlan(input: Parameters<InspectionPlansViewModel['createPlan']>[0]): void;
  isCreatingPlan: boolean;
  onSelectPlan(plan: InspectionPlan): void;
  robotPlanExternalId: string | null;
  onSetPlanActive(plan: InspectionPlan): void;
  onSetPlanInactive(plan: InspectionPlan): void;
  isTogglingStatus: boolean;
}

function PlanListView({
  plans,
  availableMaps,
  defaultMapExternalId,
  canCreatePlan,
  createPlan,
  isCreatingPlan,
  onSelectPlan,
  robotPlanExternalId,
  onSetPlanActive,
  onSetPlanInactive,
  isTogglingStatus,
}: PlanListViewProps) {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3 p-4">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsCreateDialogOpen(true)}
        className="w-full"
        aria-label="Create new inspection plan"
        disabled={!canCreatePlan}
      >
        <IconPlus size={14} aria-hidden />
        Create new plan
      </Button>
      {!canCreatePlan && (
        <p className="text-xs text-muted-foreground">
          Complete a scan before creating a plan.
        </p>
      )}

      <PlanFormDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        mode="create"
        availableMaps={availableMaps}
        defaultMapExternalId={defaultMapExternalId}
        isSubmitting={isCreatingPlan}
        onSubmit={(input) => {
          createPlan(input);
          setIsCreateDialogOpen(false);
        }}
      />

      {plans.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-sm font-medium text-foreground">No inspection plans yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create one to start planning an inspection.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Inspection plans">
          {plans.map((plan) => (
            <PlanRow
              key={plan.externalId}
              plan={plan}
              onSelect={onSelectPlan}
              isRobotPlan={plan.externalId === robotPlanExternalId}
              onSetActive={onSetPlanActive}
              onSetInactive={onSetPlanInactive}
              isTogglingStatus={isTogglingStatus}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

const ROBOT_RULE_TOOLTIP =
  'The robot bridge flies this plan: the Active plan if one exists, otherwise the most recently updated Ready plan.';

function PlanRow({
  plan,
  onSelect,
  isRobotPlan,
  onSetActive,
  onSetInactive,
  isTogglingStatus,
}: {
  plan: InspectionPlan;
  onSelect(p: InspectionPlan): void;
  isRobotPlan: boolean;
  onSetActive(p: InspectionPlan): void;
  onSetInactive(p: InspectionPlan): void;
  isTogglingStatus: boolean;
}) {
  const label = formatPlanLabel(plan);
  return (
    <li className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="truncate text-sm">{label}</span>
        <PlanStatusBadge status={plan.status} />
        {isRobotPlan && (
          <Badge variant="sky" outline title={ROBOT_RULE_TOOLTIP} aria-label="Will be sent to robot">
            → robot
          </Badge>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {plan.status === 'Ready' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSetActive(plan)}
            disabled={isTogglingStatus}
            aria-label={`Set plan ${label} active`}
          >
            Set active
          </Button>
        )}
        {plan.status === 'Active' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSetInactive(plan)}
            disabled={isTogglingStatus}
            aria-label={`Deactivate plan ${label}`}
          >
            Deactivate
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSelect(plan)}
          aria-label={`Select plan ${label}`}
        >
          Select
        </Button>
      </div>
    </li>
  );
}

// ---- Active plan ----

interface ActivePlanViewProps {
  plan: InspectionPlan;
  tasks: InspectionTask[];
  isLoadingTasks: boolean;
  availableMaps: InspectionPlansViewModel['availableMaps'];
  onBack(): void;
  onToggleStatus(): void;
  isTogglingStatus: boolean;
  onUpdatePlan: InspectionPlansViewModel['updatePlan'];
  isUpdatingPlan: boolean;
  onDeletePlan(): void;
  isDeletingPlan: boolean;
  onRemoveTask(space: string, externalId: string): void;
  onAddTask: InspectionPlansViewModel['addTask'];
  isAddingTask: boolean;
  areaSpace: string;
  areaExternalId: string;
  onTaskSelected?: (task: InspectionTask) => void;
  onTaskHovered?: (task: InspectionTask | null) => void;
}

function ActivePlanView({
  plan,
  tasks,
  isLoadingTasks,
  availableMaps,
  onBack,
  onToggleStatus,
  isTogglingStatus,
  onUpdatePlan,
  isUpdatingPlan,
  onDeletePlan,
  isDeletingPlan,
  onRemoveTask,
  onAddTask,
  isAddingTask,
  areaSpace,
  areaExternalId,
  onTaskSelected,
  onTaskHovered,
}: ActivePlanViewProps) {
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const isDraft = plan.status === 'Draft';
  const isReady = plan.status === 'Ready';
  const canToggle = isDraft || isReady;

  const existingTaskSuggestionIds = new Set(
    tasks.map((t) => t.suggestionId).filter((id): id is string => id !== undefined),
  );

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          aria-label="Back to plan list"
          className="shrink-0"
        >
          <IconChevronLeft size={14} aria-hidden />
        </Button>
        <span className="flex-1 truncate text-sm font-medium" title={formatPlanLabel(plan)}>
          {formatPlanLabel(plan)}
        </span>
        <PlanStatusBadge status={plan.status} />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsEditDialogOpen(true)}
          aria-label="Edit plan"
          className="shrink-0"
        >
          <IconPencil size={14} aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsDeleteDialogOpen(true)}
          aria-label="Delete plan"
          className="shrink-0"
        >
          <IconTrash size={14} aria-hidden />
        </Button>
      </div>
      {plan.description && (
        <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
          {plan.description}
        </p>
      )}

      <PlanFormDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        mode="edit"
        initialValues={{ name: plan.name, description: plan.description }}
        mapField={
          isDraft ? { availableMaps, currentMapExternalId: plan.mapExternalId } : undefined
        }
        isSubmitting={isUpdatingPlan}
        onSubmit={(input) => {
          onUpdatePlan(input);
          setIsEditDialogOpen(false);
        }}
      />
      <DeleteConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        entityName={formatPlanLabel(plan)}
        entityKind="plan"
        isDeleting={isDeletingPlan}
        onConfirm={onDeletePlan}
      />

      {/* Status toggle + Suggestions */}
      {canToggle && (
        <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={onToggleStatus}
            disabled={isTogglingStatus}
            aria-label={isDraft ? 'Mark as ready' : 'Revert to draft'}
          >
            {isTogglingStatus
              ? 'Updating…'
              : isDraft
                ? 'Mark as Ready'
                : 'Revert to Draft'}
          </Button>
          {isDraft && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setIsSuggestionsOpen(true)}
              aria-label="View inspection suggestions"
            >
              Suggestions
            </Button>
          )}
        </div>
      )}

      <RecommendationsModal
        areaSpace={areaSpace}
        areaExternalId={areaExternalId}
        existingTaskSuggestionIds={existingTaskSuggestionIds}
        isOpen={isSuggestionsOpen}
        onClose={() => setIsSuggestionsOpen(false)}
        onAddTask={onAddTask}
        isAddingTask={isAddingTask}
      />

      {/* Task list */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoadingTasks ? (
          <div className="flex items-center justify-center py-6">
            <Loader role="status" size={20} />
          </div>
        ) : tasks.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-sm text-muted-foreground">
              No tasks yet. Select geometry in the viewer to add tasks.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Inspection tasks">
            {tasks.map((task) => (
              <TaskRow
                key={task.externalId}
                task={task}
                canRemove={isDraft}
                onRemove={() => onRemoveTask(task.space, task.externalId)}
                onSelect={onTaskSelected ? () => onTaskSelected(task) : undefined}
                onHover={onTaskHovered ? () => onTaskHovered(task) : undefined}
                onHoverEnd={onTaskHovered ? () => onTaskHovered(null) : undefined}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TaskRow({
  task,
  canRemove,
  onRemove,
  onSelect,
  onHover,
  onHoverEnd,
}: {
  task: InspectionTask;
  canRemove: boolean;
  onRemove(): void;
  onSelect?: () => void;
  onHover?: () => void;
  onHoverEnd?: () => void;
}) {
  const typeLabel = INSPECTION_TYPE_LABELS[task.inspectionType] ?? task.inspectionType;
  const locationLabel =
    task.taskKind === 'element'
      ? task.targetElementExternalId ?? '—'
      : task.position3d
        ? `(${task.position3d.map((v) => v.toFixed(1)).join(', ')})`
        : '—';

  if (onSelect) {
    return (
      <li
        className="flex items-start justify-between rounded-md border border-border px-3 py-2 gap-2 cursor-pointer hover:bg-muted/60"
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => e.key === 'Enter' && onSelect()}
        onMouseEnter={onHover}
        onMouseLeave={onHoverEnd}
        aria-label={`Select task at ${locationLabel}`}
      >
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-foreground">{locationLabel}</p>
          <p className="text-xs text-muted-foreground">{typeLabel}</p>
        </div>
        {canRemove && (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            aria-label={`Remove task ${locationLabel}`}
            className="shrink-0"
          >
            <IconTrash size={14} aria-hidden />
          </Button>
        )}
      </li>
    );
  }

  return (
    <li
      className="flex items-start justify-between rounded-md border border-border px-3 py-2 gap-2"
      onMouseEnter={onHover}
      onMouseLeave={onHoverEnd}
    >
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-foreground">{locationLabel}</p>
        <p className="text-xs text-muted-foreground">{typeLabel}</p>
      </div>
      {canRemove && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemove}
          aria-label={`Remove task ${locationLabel}`}
          className="shrink-0"
        >
          <IconTrash size={14} aria-hidden />
        </Button>
      )}
    </li>
  );
}

// ---- Shared helpers ----

function PlanStatusBadge({ status }: { status: InspectionPlan['status'] }) {
  const variant =
    status === 'Draft'
      ? 'secondary'
      : status === 'Ready'
        ? 'default'
        : status === 'Active'
          ? 'success'
          : 'archived';
  return <Badge variant={variant}>{status}</Badge>;
}

function formatPlanLabel(plan: InspectionPlan): string {
  if (plan.name) return plan.name;
  return `Plan from ${new Date(plan.createdTime).toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })}`;
}
