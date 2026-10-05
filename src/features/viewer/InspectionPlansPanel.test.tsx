import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { InspectionPlansPanel } from './InspectionPlansPanel';
import type { InspectionPlansViewModel } from './useInspectionPlansViewModel';
import { createMockInspectionPlan } from '../../__mocks__/inspectionPlans';
import { createMockElementTask, createMockRegionTask } from '../../__mocks__/inspectionTasks';
import { RecommendationsViewModelContext } from '../recommendations/RecommendationsModal';
import type { RecommendationsViewModelContextType } from '../recommendations/useRecommendationsViewModel';
import type { InspectionResult } from './InspectionResultService';
import type { NdtMeasurement } from './NdtMeasurementService';
import type { DefectDetection } from './DefectDetectionService';

// ---- Helpers ----

function makeSuccess<T>(data: T): UseQueryResult<T, Error> {
  return {
    data,
    isLoading: false,
    error: null,
    status: 'success',
    isSuccess: true,
    isError: false,
    isPending: false,
    isFetching: false,
  } as UseQueryResult<T, Error>;
}

function makeViewModel(overrides: Partial<InspectionPlansViewModel> = {}): InspectionPlansViewModel {
  return {
    plans: [],
    isLoadingPlans: false,
    activePlan: null,
    tasks: [],
    isLoadingTasks: false,
    availableMaps: [{ externalId: 'result-2024-09-15', label: 'Campaign 2024-09-15' }],
    defaultMapExternalId: 'result-2024-09-15',
    canCreatePlan: true,
    createPlan: vi.fn(),
    isCreatingPlan: false,
    selectPlan: vi.fn(),
    deactivatePlan: vi.fn(),
    robotPlanExternalId: null,
    setPlanActive: vi.fn(),
    setPlanInactive: vi.fn(),
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

const AREA_PROPS = { areaSpace: 'autoassess', areaExternalId: 'area-1' };

// Provide a stub RecommendationsViewModelContext so tests don't need QueryClient.
let mockRecommendationsContext: RecommendationsViewModelContextType;

function renderPanel(
  viewModel: InspectionPlansViewModel,
  extras: { onTaskSelected?: (task: import('./InspectionTaskService').InspectionTask) => void } = {},
) {
  return render(
    createElement(
      RecommendationsViewModelContext.Provider,
      { value: mockRecommendationsContext },
      createElement(InspectionPlansPanel, { viewModel, ...AREA_PROPS, ...extras }),
    ),
  );
}

describe(InspectionPlansPanel.name, () => {
  beforeEach(() => {
    mockRecommendationsContext = {
      useInspectionResults: vi.fn(() => makeSuccess<InspectionResult[]>([])),
      useNdtMeasurementsForCampaign: vi.fn(() => makeSuccess<NdtMeasurement[]>([])),
      useDefectDetections: vi.fn(() => makeSuccess<DefectDetection[]>([])),
    };
  });

  describe('plan list view (no active plan)', () => {
    it('renders a loader while plans are loading', () => {
      renderPanel(makeViewModel({ isLoadingPlans: true }));
      expect(screen.getByRole('status')).toBeDefined();
    });

    it('renders the empty state when no plans exist', () => {
      renderPanel(makeViewModel());
      expect(screen.getByText('No inspection plans yet.')).toBeDefined();
    });

    it('renders a create plan button', () => {
      renderPanel(makeViewModel());
      expect(screen.getByRole('button', { name: /create new/i })).toBeDefined();
    });

    it('opens the create plan dialog when create button is clicked', async () => {
      renderPanel(makeViewModel());
      await userEvent.click(screen.getByRole('button', { name: /create new/i }));
      expect(screen.getByRole('button', { name: /^create plan$/i })).toBeDefined();
    });

    it('calls createPlan with the entered name/description and default map when the dialog is submitted', async () => {
      const createPlan = vi.fn();
      renderPanel(makeViewModel({ createPlan }));
      await userEvent.click(screen.getByRole('button', { name: /create new/i }));
      await userEvent.type(screen.getByLabelText(/name/i), 'Q3 hull survey');
      await userEvent.click(screen.getByRole('button', { name: /^create plan$/i }));
      expect(createPlan).toHaveBeenCalledWith({
        mapExternalId: 'result-2024-09-15',
        name: 'Q3 hull survey',
        description: undefined,
      });
    });

    it('disables the create button and shows a hint when the area has no completed scan', () => {
      renderPanel(makeViewModel({ availableMaps: [], defaultMapExternalId: null, canCreatePlan: false }));
      const createButton = screen.getByRole('button', { name: /create new/i });
      expect((createButton as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByText(/complete a scan before creating a plan/i)).toBeDefined();
    });

    it('renders plan rows when plans exist', () => {
      const plan = createMockInspectionPlan({ createdTime: new Date('2026-04-13').getTime() });
      renderPanel(makeViewModel({ plans: [plan] }));
      expect(screen.getByRole('list', { name: /inspection plans/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /select plan/i })).toBeDefined();
    });

    it('renders the plan name as the label when set', () => {
      const plan = createMockInspectionPlan({ name: 'Q3 hull survey' });
      renderPanel(makeViewModel({ plans: [plan] }));
      expect(screen.getByText('Q3 hull survey')).toBeDefined();
    });

    it('falls back to the date-derived label when name is not set', () => {
      const plan = createMockInspectionPlan({
        name: null,
        createdTime: new Date('2026-04-13').getTime(),
      });
      renderPanel(makeViewModel({ plans: [plan] }));
      expect(screen.getByText(/plan from/i)).toBeDefined();
    });

    it('calls selectPlan when a plan row select button is clicked', async () => {
      const selectPlan = vi.fn();
      const plan = createMockInspectionPlan();
      renderPanel(makeViewModel({ plans: [plan], selectPlan }));
      await userEvent.click(screen.getByRole('button', { name: /select plan/i }));
      expect(selectPlan).toHaveBeenCalledWith(plan);
    });

    it('shows Draft badge on Draft plans', () => {
      const plan = createMockInspectionPlan({ status: 'Draft' });
      renderPanel(makeViewModel({ plans: [plan] }));
      expect(screen.getByText('Draft')).toBeDefined();
    });

    it('shows an Active badge on the Active plan', () => {
      const plan = createMockInspectionPlan({ status: 'Active' });
      renderPanel(makeViewModel({ plans: [plan] }));
      expect(screen.getByText('Active')).toBeDefined();
    });

    it('shows a Set active action on Ready plans and calls setPlanActive with the plan', async () => {
      const setPlanActive = vi.fn();
      const plan = createMockInspectionPlan({ status: 'Ready' });
      renderPanel(makeViewModel({ plans: [plan], setPlanActive }));
      await userEvent.click(screen.getByRole('button', { name: /set plan .* active/i }));
      expect(setPlanActive).toHaveBeenCalledWith(plan);
    });

    it('shows a Deactivate action on the Active plan and calls setPlanInactive with the plan', async () => {
      const setPlanInactive = vi.fn();
      const plan = createMockInspectionPlan({ status: 'Active' });
      renderPanel(makeViewModel({ plans: [plan], setPlanInactive }));
      await userEvent.click(screen.getByRole('button', { name: /deactivate plan/i }));
      expect(setPlanInactive).toHaveBeenCalledWith(plan);
    });

    it('does not show a Set active or Deactivate action on Draft or Complete plans', () => {
      const draft = createMockInspectionPlan({ externalId: 'plan-1', status: 'Draft' });
      const complete = createMockInspectionPlan({ externalId: 'plan-2', status: 'Complete' });
      renderPanel(makeViewModel({ plans: [draft, complete] }));
      expect(screen.queryByRole('button', { name: /set plan .* active/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /deactivate plan/i })).toBeNull();
    });

    it('marks exactly the robot plan with a "robot" chip explaining the rule', () => {
      const active = createMockInspectionPlan({ externalId: 'plan-active', name: 'Active plan', status: 'Active' });
      const ready = createMockInspectionPlan({ externalId: 'plan-ready', name: 'Ready plan', status: 'Ready' });
      renderPanel(makeViewModel({ plans: [active, ready], robotPlanExternalId: 'plan-active' }));
      expect(screen.getAllByText(/robot/i)).toHaveLength(1);
      expect(screen.getByText(/robot/i).closest('li')?.textContent).toContain('Active plan');
    });

    it('shows no robot chip when robotPlanExternalId is null', () => {
      const draft = createMockInspectionPlan({ status: 'Draft' });
      renderPanel(makeViewModel({ plans: [draft], robotPlanExternalId: null }));
      expect(screen.queryByText(/robot/i)).toBeNull();
    });

    describe('no-map guard', () => {
      it('shows a "no map" hint only on plans without a map', () => {
        const mapless = createMockInspectionPlan({
          externalId: 'plan-mapless',
          name: 'Mapless plan',
          mapExternalId: null,
        });
        const mapped = createMockInspectionPlan({
          externalId: 'plan-mapped',
          name: 'Mapped plan',
        });
        renderPanel(makeViewModel({ plans: [mapless, mapped] }));
        expect(screen.getAllByText(/no map/i)).toHaveLength(1);
        expect(screen.getByText(/no map/i).closest('li')?.textContent).toContain('Mapless plan');
      });

      it('asks for confirmation before activating a plan without a map', async () => {
        const setPlanActive = vi.fn();
        const plan = createMockInspectionPlan({ status: 'Ready', mapExternalId: null });
        renderPanel(makeViewModel({ plans: [plan], setPlanActive }));
        await userEvent.click(screen.getByRole('button', { name: /set plan .* active/i }));
        expect(screen.getByText(/no 3d map attached/i)).toBeDefined();
        expect(setPlanActive).not.toHaveBeenCalled();
      });

      it('activates the plan when the no-map confirmation is confirmed', async () => {
        const setPlanActive = vi.fn();
        const plan = createMockInspectionPlan({ status: 'Ready', mapExternalId: null });
        renderPanel(makeViewModel({ plans: [plan], setPlanActive }));
        await userEvent.click(screen.getByRole('button', { name: /set plan .* active/i }));
        await userEvent.click(screen.getByRole('button', { name: /set active anyway/i }));
        expect(setPlanActive).toHaveBeenCalledWith(plan);
      });

      it('does not activate the plan when the no-map confirmation is cancelled', async () => {
        const setPlanActive = vi.fn();
        const plan = createMockInspectionPlan({ status: 'Ready', mapExternalId: null });
        renderPanel(makeViewModel({ plans: [plan], setPlanActive }));
        await userEvent.click(screen.getByRole('button', { name: /set plan .* active/i }));
        await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
        expect(setPlanActive).not.toHaveBeenCalled();
      });

      it('activates a plan with a map immediately without any confirmation', async () => {
        const setPlanActive = vi.fn();
        const plan = createMockInspectionPlan({ status: 'Ready' });
        renderPanel(makeViewModel({ plans: [plan], setPlanActive }));
        await userEvent.click(screen.getByRole('button', { name: /set plan .* active/i }));
        expect(screen.queryByText(/no 3d map attached/i)).toBeNull();
        expect(setPlanActive).toHaveBeenCalledWith(plan);
      });
    });
  });

  describe('active plan view', () => {
    it('renders the active plan header with back button', () => {
      const plan = createMockInspectionPlan({ status: 'Draft' });
      renderPanel(makeViewModel({ activePlan: plan }));
      expect(screen.getByRole('button', { name: /back to plan list/i })).toBeDefined();
    });

    it('renders the plan name in the header when set', () => {
      const plan = createMockInspectionPlan({ status: 'Draft', name: 'Q3 hull survey' });
      renderPanel(makeViewModel({ activePlan: plan }));
      expect(screen.getByText('Q3 hull survey')).toBeDefined();
    });

    it('renders the plan description when set', () => {
      const plan = createMockInspectionPlan({ status: 'Draft', description: 'Focus on aft hull' });
      renderPanel(makeViewModel({ activePlan: plan }));
      expect(screen.getByText('Focus on aft hull')).toBeDefined();
    });

    it('does not render a description block when description is null', () => {
      const plan = createMockInspectionPlan({ status: 'Draft', description: null });
      renderPanel(makeViewModel({ activePlan: plan }));
      expect(screen.queryByText(/focus on aft hull/i)).toBeNull();
    });

    it('opens the edit dialog pre-filled when the edit button is clicked', async () => {
      const plan = createMockInspectionPlan({
        status: 'Draft',
        name: 'Q3 hull survey',
        description: 'Focus on aft hull',
      });
      renderPanel(makeViewModel({ activePlan: plan }));
      await userEvent.click(screen.getByRole('button', { name: /edit plan/i }));
      expect(screen.getByLabelText(/^name/i)).toHaveValue('Q3 hull survey');
      expect(screen.getByLabelText(/description/i)).toHaveValue('Focus on aft hull');
    });

    it('shows a map field when editing a Draft plan', async () => {
      const plan = createMockInspectionPlan({ status: 'Draft' });
      renderPanel(makeViewModel({ activePlan: plan }));
      await userEvent.click(screen.getByRole('button', { name: /edit plan/i }));
      expect(screen.getByLabelText(/map/i)).toBeDefined();
    });

    it('does not show a map field when editing a Ready plan', async () => {
      const plan = createMockInspectionPlan({ status: 'Ready' });
      renderPanel(makeViewModel({ activePlan: plan }));
      await userEvent.click(screen.getByRole('button', { name: /edit plan/i }));
      expect(screen.queryByLabelText(/map/i)).toBeNull();
    });

    it('calls updatePlan with the submitted values from the edit dialog', async () => {
      const updatePlan = vi.fn();
      const plan = createMockInspectionPlan({ status: 'Draft', name: 'Old name' });
      renderPanel(makeViewModel({ activePlan: plan, updatePlan }));
      await userEvent.click(screen.getByRole('button', { name: /edit plan/i }));
      const nameInput = screen.getByLabelText(/^name/i);
      await userEvent.clear(nameInput);
      await userEvent.type(nameInput, 'New name');
      await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
      expect(updatePlan).toHaveBeenCalledWith({
        name: 'New name',
        description: undefined,
        mapExternalId: plan.mapExternalId,
      });
    });

    it('opens the delete confirmation dialog when the delete button is clicked', async () => {
      const plan = createMockInspectionPlan({ status: 'Draft', name: 'Q3 hull survey' });
      renderPanel(makeViewModel({ activePlan: plan }));
      await userEvent.click(screen.getByRole('button', { name: /delete plan/i }));
      expect(screen.getByText(/delete plan\?/i)).toBeDefined();
    });

    it('calls deletePlan when the delete confirmation is confirmed', async () => {
      const deletePlan = vi.fn();
      const plan = createMockInspectionPlan({ status: 'Draft', name: 'Q3 hull survey' });
      renderPanel(makeViewModel({ activePlan: plan, deletePlan }));
      await userEvent.click(screen.getByRole('button', { name: /delete plan/i }));
      await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
      expect(deletePlan).toHaveBeenCalledOnce();
    });

    it('calls deactivatePlan when back button is clicked', async () => {
      const deactivatePlan = vi.fn();
      const plan = createMockInspectionPlan({ status: 'Draft' });
      renderPanel(makeViewModel({ activePlan: plan, deactivatePlan }));
      await userEvent.click(screen.getByRole('button', { name: /back to plan list/i }));
      expect(deactivatePlan).toHaveBeenCalledOnce();
    });

    it('renders tasks when tasks exist', () => {
      const plan = createMockInspectionPlan({ status: 'Draft' });
      const tasks = [createMockElementTask(), createMockRegionTask()];
      renderPanel(makeViewModel({ activePlan: plan, tasks }));
      expect(screen.getByRole('list', { name: /inspection tasks/i })).toBeDefined();
    });

    it('renders empty task state when no tasks', () => {
      const plan = createMockInspectionPlan({ status: 'Draft' });
      renderPanel(makeViewModel({ activePlan: plan }));
      expect(screen.getByText(/no tasks yet/i)).toBeDefined();
    });

    it('renders remove button for each task when plan is Draft', () => {
      const plan = createMockInspectionPlan({ status: 'Draft' });
      const tasks = [createMockElementTask()];
      renderPanel(makeViewModel({ activePlan: plan, tasks }));
      expect(screen.getByRole('button', { name: /remove task/i })).toBeDefined();
    });

    it('does not render remove button when plan is Ready', () => {
      const plan = createMockInspectionPlan({ status: 'Ready' });
      const tasks = [createMockElementTask()];
      renderPanel(makeViewModel({ activePlan: plan, tasks }));
      expect(screen.queryByRole('button', { name: /remove task/i })).toBeNull();
    });

    it('calls removeTask with task space and externalId when remove button clicked', async () => {
      const removeTask = vi.fn();
      const plan = createMockInspectionPlan({ status: 'Draft' });
      const task = createMockElementTask();
      renderPanel(makeViewModel({ activePlan: plan, tasks: [task], removeTask }));
      await userEvent.click(screen.getByRole('button', { name: /remove task/i }));
      expect(removeTask).toHaveBeenCalledWith(task.space, task.externalId);
    });

    it('renders status toggle button for Draft plans', () => {
      const plan = createMockInspectionPlan({ status: 'Draft' });
      renderPanel(makeViewModel({ activePlan: plan }));
      expect(screen.getByRole('button', { name: /mark as ready/i })).toBeDefined();
    });

    it('renders revert button for Ready plans', () => {
      const plan = createMockInspectionPlan({ status: 'Ready' });
      renderPanel(makeViewModel({ activePlan: plan }));
      expect(screen.getByRole('button', { name: /revert to draft/i })).toBeDefined();
    });

    it('does not render status toggle for Complete plans', () => {
      const plan = createMockInspectionPlan({ status: 'Complete' });
      renderPanel(makeViewModel({ activePlan: plan }));
      expect(screen.queryByRole('button', { name: /mark as ready|revert to draft/i })).toBeNull();
    });

    it('calls togglePlanStatus when status button is clicked', async () => {
      const togglePlanStatus = vi.fn();
      const plan = createMockInspectionPlan({ status: 'Draft' });
      renderPanel(makeViewModel({ activePlan: plan, togglePlanStatus }));
      await userEvent.click(screen.getByRole('button', { name: /mark as ready/i }));
      expect(togglePlanStatus).toHaveBeenCalledOnce();
    });

    it('renders Suggestions button for Draft plans', () => {
      const plan = createMockInspectionPlan({ status: 'Draft' });
      renderPanel(makeViewModel({ activePlan: plan }));
      expect(screen.getByRole('button', { name: /view inspection suggestions/i })).toBeDefined();
    });

    it('does not render Suggestions button for Ready plans', () => {
      const plan = createMockInspectionPlan({ status: 'Ready' });
      renderPanel(makeViewModel({ activePlan: plan }));
      expect(screen.queryByRole('button', { name: /view inspection suggestions/i })).toBeNull();
    });

    describe('task row selection', () => {
      it('renders task rows as clickable elements', () => {
        const plan = createMockInspectionPlan({ status: 'Draft' });
        const task = createMockElementTask();
        renderPanel(makeViewModel({ activePlan: plan, tasks: [task] }), { onTaskSelected: vi.fn() });
        expect(screen.getByRole('button', { name: /select task/i })).toBeDefined();
      });

      it('calls onTaskSelected with the task when a task row is clicked', async () => {
        const onTaskSelected = vi.fn();
        const plan = createMockInspectionPlan({ status: 'Draft' });
        const task = createMockElementTask();
        renderPanel(makeViewModel({ activePlan: plan, tasks: [task] }), { onTaskSelected });
        await userEvent.click(screen.getByRole('button', { name: /select task/i }));
        expect(onTaskSelected).toHaveBeenCalledWith(task);
      });

      it('does not call onTaskSelected when the remove button inside the row is clicked', async () => {
        const onTaskSelected = vi.fn();
        const plan = createMockInspectionPlan({ status: 'Draft' });
        const task = createMockElementTask();
        renderPanel(makeViewModel({ activePlan: plan, tasks: [task] }), { onTaskSelected });
        await userEvent.click(screen.getByRole('button', { name: /remove task/i }));
        expect(onTaskSelected).not.toHaveBeenCalled();
      });

      it('does not render task rows as clickable when onTaskSelected is not provided', () => {
        const plan = createMockInspectionPlan({ status: 'Draft' });
        const task = createMockElementTask();
        renderPanel(makeViewModel({ activePlan: plan, tasks: [task] }));
        expect(screen.queryByRole('button', { name: /select task/i })).toBeNull();
      });
    });
  });
});
