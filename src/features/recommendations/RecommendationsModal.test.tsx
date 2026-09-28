import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { RecommendationsModal, RecommendationsViewModelContext } from './RecommendationsModal';
import type { RecommendationsViewModelContextType } from './useRecommendationsViewModel';
import type { UseQueryResult } from '@tanstack/react-query';
import { createMockNdtMeasurement } from '../../__mocks__/ndtMeasurements';
import { createMockDefectDetection } from '../../__mocks__/defectDetections';
import { createMockInspectionResult } from '../../__mocks__/inspectionResults';
import type { DefectDetection } from '../viewer/DefectDetectionService';
import type { InspectionResult } from '../viewer/InspectionResultService';
import { NDT_REPEAT_THRESHOLD_MM } from './recommendationRules';

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

function makePending<T>(): UseQueryResult<T, Error> {
  return {
    data: undefined,
    isLoading: true,
    error: null,
    status: 'pending',
    isSuccess: false,
    isError: false,
    isPending: true,
    isFetching: true,
  } as UseQueryResult<T, Error>;
}

const campaign = createMockInspectionResult({
  externalId: 'campaign-1',
  date: '2024-09-15',
  status: 'Complete',
});

const DEFAULT_PROPS = {
  areaSpace: 'autoassess',
  areaExternalId: 'area-1',
  existingTaskSuggestionIds: new Set<string>(),
  isOpen: true,
  onClose: vi.fn(),
  onAddTask: vi.fn(),
  isAddingTask: false,
};

describe(RecommendationsModal.name, () => {
  let mockContext: RecommendationsViewModelContextType;

  beforeEach(() => {
    mockContext = {
      useInspectionResults: vi.fn(() => makeSuccess([campaign])),
      useNdtMeasurementsForCampaign: vi.fn(() => makeSuccess([])),
      useDefectDetections: vi.fn(() => makeSuccess([])),
    };
  });

  function renderModal(props = DEFAULT_PROPS) {
    return render(
      createElement(
        RecommendationsViewModelContext.Provider,
        { value: mockContext },
        createElement(RecommendationsModal, props),
      ),
    );
  }

  it('renders a loader while data is loading', () => {
    vi.mocked(mockContext.useInspectionResults).mockReturnValue(makePending<InspectionResult[]>());
    renderModal();
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('shows empty state when there are no recommendations', () => {
    renderModal();
    expect(screen.getByText(/no recommendations/i)).toBeDefined();
  });

  it('renders an NDT repeat recommendation row', () => {
    const lowNdt = createMockNdtMeasurement({
      externalId: 'ndt-low',
      thicknessMm: NDT_REPEAT_THRESHOLD_MM - 2,
    });
    vi.mocked(mockContext.useNdtMeasurementsForCampaign).mockReturnValue(makeSuccess([lowNdt]));
    renderModal();
    expect(screen.getByText('NDT Repeat')).toBeDefined();
    expect(screen.getByRole('button', { name: /add to plan/i })).toBeDefined();
  });

  it('renders a confirmed defect recommendation row', () => {
    const confirmed = createMockDefectDetection({
      externalId: 'def-1',
      status: 'Confirmed',
      defectClass: 'corrosion',
      campaignExternalId: 'campaign-1',
    });
    vi.mocked(mockContext.useDefectDetections).mockReturnValue(makeSuccess([confirmed]));
    renderModal();
    expect(screen.getByText('Confirmed Defect')).toBeDefined();
    expect(screen.getByText(/confirmed corrosion/i)).toBeDefined();
  });

  it('shows "Added" instead of button when recommendation is already in the plan', () => {
    const lowNdt = createMockNdtMeasurement({
      externalId: 'ndt-added',
      thicknessMm: 5,
    });
    vi.mocked(mockContext.useNdtMeasurementsForCampaign).mockReturnValue(makeSuccess([lowNdt]));
    renderModal({
      ...DEFAULT_PROPS,
      existingTaskSuggestionIds: new Set(['ndt_repeat:ndt-added']),
    });
    expect(screen.queryByRole('button', { name: /add to plan/i })).toBeNull();
    expect(screen.getByText(/✓ Added/i)).toBeDefined();
  });

  it('calls onAddTask with a region task when "Add to plan" is clicked', async () => {
    const onAddTask = vi.fn();
    const lowNdt = createMockNdtMeasurement({
      externalId: 'ndt-clickme',
      thicknessMm: 5,
    });
    vi.mocked(mockContext.useNdtMeasurementsForCampaign).mockReturnValue(makeSuccess([lowNdt]));
    renderModal({ ...DEFAULT_PROPS, onAddTask });

    await userEvent.click(screen.getByRole('button', { name: /add to plan/i }));

    expect(onAddTask).toHaveBeenCalledOnce();
    const task = onAddTask.mock.calls[0][0];
    expect(task.taskKind).toBe('region');
    expect(task.inspectionType).toBe('ndt_thickness');
    expect(task.suggestionId).toBe('ndt_repeat:ndt-clickme');
  });

  it('calls onClose when the dialog is dismissed', async () => {
    const onClose = vi.fn();
    renderModal({ ...DEFAULT_PROPS, onClose });
    // Escape key triggers dialog close
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows error message when data loading fails', () => {
    vi.mocked(mockContext.useDefectDetections).mockReturnValue(
      {
        data: undefined,
        isLoading: false,
        error: new Error('fetch failed'),
        status: 'error',
        isSuccess: false,
        isError: true,
        isPending: false,
        isFetching: false,
      } as UseQueryResult<DefectDetection[], Error>,
    );
    renderModal();
    expect(screen.getByText(/fetch failed/i)).toBeDefined();
  });

  it('does not render content when closed', () => {
    renderModal({ ...DEFAULT_PROPS, isOpen: false });
    expect(screen.queryByText(/suggestions/i)).toBeNull();
  });
});
