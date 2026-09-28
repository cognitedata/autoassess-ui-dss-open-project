import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { SelectionPanel } from './SelectionPanel';
import type { SelectionHit } from './selection';
import { createMockInspectionPlan } from '../../__mocks__/inspectionPlans';
import { createMockElementTask, createMockRegionTask } from '../../__mocks__/inspectionTasks';
import { createMockDefectDetection, createMockManualDefectDetection } from '../../__mocks__/defectDetections';
import { createMockNdtMeasurement } from '../../__mocks__/ndtMeasurements';
import { createMockDroneImage } from '../../__mocks__/droneImages';

// Vector3-like plain objects — SelectionPanel only reads .x .y .z
function vec3(x: number, y: number, z: number) {
  return { x, y, z } as import('three').Vector3;
}

const regionHit: SelectionHit = {
  kind: 'region',
  position: vec3(1.23456, 2.34567, 3.45678),
  normal: vec3(0.1, 0.9, 0.0),
};

const elementHit: SelectionHit = {
  kind: 'element',
  element: {
    space: 'autoassess',
    externalId: 'el-42',
    elementType: 'manhole',
    label: 42,
    center: [1, 2, 3],
    areaExternalId: 'area-01',
  },
};

describe(SelectionPanel.name, () => {
  it('hides the panel when hit is null', () => {
    render(<SelectionPanel hit={null} onClose={vi.fn()} />);
    const panel = screen.getByTestId('selection-panel');
    expect(panel.className).toContain('-translate-x-full');
  });

  it('shows the panel when hit is not null', () => {
    render(<SelectionPanel hit={regionHit} onClose={vi.fn()} />);
    const panel = screen.getByTestId('selection-panel');
    expect(panel.className).toContain('translate-x-0');
    expect(panel.className).not.toContain('-translate-x-full');
  });

  it('displays "Surface Position" header for a region hit', () => {
    render(<SelectionPanel hit={regionHit} onClose={vi.fn()} />);
    expect(screen.getByRole('heading', { name: /surface position/i })).toBeDefined();
  });

  it('displays position values rounded to 3 decimals for a region hit', () => {
    render(<SelectionPanel hit={regionHit} onClose={vi.fn()} />);
    expect(screen.getByText('1.235')).toBeDefined();
    expect(screen.getByText('2.346')).toBeDefined();
    expect(screen.getByText('3.457')).toBeDefined();
  });

  it('displays normal vector values for a region hit', () => {
    render(<SelectionPanel hit={regionHit} onClose={vi.fn()} />);
    expect(screen.getByText('0.100')).toBeDefined();
    expect(screen.getByText('0.900')).toBeDefined();
    expect(screen.getByText('0.000')).toBeDefined();
  });

  it('renders a Fly to button for a region hit when onFlyToRegion is provided', () => {
    render(<SelectionPanel hit={regionHit} onClose={vi.fn()} onFlyToRegion={vi.fn()} />);
    expect(screen.getByRole('button', { name: /fly to/i })).toBeDefined();
  });

  it('does not render a Fly to button for a region hit when onFlyToRegion is not provided', () => {
    render(<SelectionPanel hit={regionHit} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /fly to/i })).toBeNull();
  });

  it('calls onFlyToRegion when Fly to button is clicked for a region hit', async () => {
    const onFlyToRegion = vi.fn();
    render(<SelectionPanel hit={regionHit} onClose={vi.fn()} onFlyToRegion={onFlyToRegion} />);
    await userEvent.click(screen.getByRole('button', { name: /fly to/i }));
    expect(onFlyToRegion).toHaveBeenCalledOnce();
  });

  it('renders a "Set as ground plane" button for a region hit when onSetGroundPlane is provided', () => {
    render(<SelectionPanel hit={regionHit} onClose={vi.fn()} onSetGroundPlane={vi.fn()} />);
    expect(screen.getByRole('button', { name: /set as ground plane/i })).toBeDefined();
  });

  it('does not render a "Set as ground plane" button when onSetGroundPlane is not provided', () => {
    render(<SelectionPanel hit={regionHit} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /set as ground plane/i })).toBeNull();
  });

  it('calls onSetGroundPlane when "Set as ground plane" button is clicked', async () => {
    const onSetGroundPlane = vi.fn();
    render(<SelectionPanel hit={regionHit} onClose={vi.fn()} onSetGroundPlane={onSetGroundPlane} />);
    await userEvent.click(screen.getByRole('button', { name: /set as ground plane/i }));
    expect(onSetGroundPlane).toHaveBeenCalledOnce();
  });

  it('displays the element type as the header for an element hit', () => {
    render(<SelectionPanel hit={elementHit} onClose={vi.fn()} />);
    expect(screen.getByRole('heading', { name: /manhole/i })).toBeDefined();
  });

  it('displays element type, label, and center coordinates for an element hit', () => {
    render(<SelectionPanel hit={elementHit} onClose={vi.fn()} />);
    // 'manhole' appears in both heading and the Type <dd> — use getAllByText
    expect(screen.getAllByText('manhole').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('42')).toBeDefined();
    expect(screen.getByText('1.000')).toBeDefined();
    expect(screen.getByText('2.000')).toBeDefined();
    expect(screen.getByText('3.000')).toBeDefined();
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    render(<SelectionPanel hit={regionHit} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: /close panel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  describe('Add-to-plan section', () => {
    it('does not render add-to-plan section when onAddToActivePlan is not provided', () => {
      render(<SelectionPanel hit={regionHit} onClose={vi.fn()} />);
      expect(screen.queryByLabelText('Add to plan')).toBeNull();
    });

    it('shows "no active plan" notice when activePlan is null', () => {
      render(
        <SelectionPanel
          hit={regionHit}
          onClose={vi.fn()}
          activePlan={null}
          onAddToActivePlan={vi.fn()}
        />,
      );
      expect(screen.getByLabelText('No active plan notice')).toBeDefined();
    });

    it('calls onOpenPlansTab when "Go to Plans" link is clicked', async () => {
      const onOpenPlansTab = vi.fn();
      render(
        <SelectionPanel
          hit={regionHit}
          onClose={vi.fn()}
          activePlan={null}
          onAddToActivePlan={vi.fn()}
          onOpenPlansTab={onOpenPlansTab}
        />,
      );
      await userEvent.click(screen.getByRole('button', { name: /go to plans/i }));
      expect(onOpenPlansTab).toHaveBeenCalledOnce();
    });

    it('shows read-only notice when activePlan is Ready', () => {
      const plan = createMockInspectionPlan({ status: 'Ready' });
      render(
        <SelectionPanel
          hit={regionHit}
          onClose={vi.fn()}
          activePlan={plan}
          onAddToActivePlan={vi.fn()}
        />,
      );
      expect(screen.getByLabelText('Plan read-only notice')).toBeDefined();
    });

    it('shows add-to-plan controls when activePlan is Draft', () => {
      const plan = createMockInspectionPlan({ status: 'Draft' });
      render(
        <SelectionPanel
          hit={regionHit}
          onClose={vi.fn()}
          activePlan={plan}
          onAddToActivePlan={vi.fn()}
        />,
      );
      expect(screen.getByLabelText('Add to plan')).toBeDefined();
      expect(screen.getByRole('button', { name: /add to plan/i })).toBeDefined();
    });

    it('calls onAddToActivePlan with selected inspection type when Add button clicked', async () => {
      const onAddToActivePlan = vi.fn();
      const plan = createMockInspectionPlan({ status: 'Draft' });
      render(
        <SelectionPanel
          hit={regionHit}
          onClose={vi.fn()}
          activePlan={plan}
          onAddToActivePlan={onAddToActivePlan}
        />,
      );
      await userEvent.click(screen.getByRole('button', { name: /^add to plan$/i }));
      expect(onAddToActivePlan).toHaveBeenCalledWith(expect.any(String));
    });

    it('disables Add button while isAddingTask is true', () => {
      const plan = createMockInspectionPlan({ status: 'Draft' });
      render(
        <SelectionPanel
          hit={regionHit}
          onClose={vi.fn()}
          activePlan={plan}
          onAddToActivePlan={vi.fn()}
          isAddingTask={true}
        />,
      );
      const btn = screen.getByRole('button', { name: /adding/i });
      expect(btn.hasAttribute('disabled')).toBe(true);
    });

    it('does not render add-to-plan section when hit is null even with props provided', () => {
      const plan = createMockInspectionPlan({ status: 'Draft' });
      render(
        <SelectionPanel
          hit={null}
          onClose={vi.fn()}
          activePlan={plan}
          onAddToActivePlan={vi.fn()}
        />,
      );
      expect(screen.queryByLabelText('Add to plan')).toBeNull();
    });
  });

  describe('task hit', () => {
    const elementTaskHit: SelectionHit = { kind: 'task', task: createMockElementTask() };
    const regionTaskHit: SelectionHit = { kind: 'task', task: createMockRegionTask() };

    it('shows "Inspection Task" heading for a task hit', () => {
      render(<SelectionPanel hit={elementTaskHit} onClose={vi.fn()} />);
      expect(screen.getByRole('heading', { name: /inspection task/i })).toBeDefined();
    });

    it('renders inspection type for an element task', () => {
      render(<SelectionPanel hit={elementTaskHit} onClose={vi.fn()} />);
      expect(screen.getByText(/visual/i)).toBeDefined();
    });

    it('renders position X/Y/Z rows for a region task', () => {
      render(<SelectionPanel hit={regionTaskHit} onClose={vi.fn()} />);
      // createMockRegionTask uses position3d: [1.1, 2.2, 3.3]
      expect(screen.getByText('1.100')).toBeDefined();
      expect(screen.getByText('2.200')).toBeDefined();
      expect(screen.getByText('3.300')).toBeDefined();
    });

    it('renders element externalId for an element task', () => {
      render(<SelectionPanel hit={elementTaskHit} onClose={vi.fn()} />);
      expect(screen.getByText(createMockElementTask().targetElementExternalId!)).toBeDefined();
    });

    it('does not render the add-to-plan section for a task hit', () => {
      const plan = createMockInspectionPlan({ status: 'Draft' });
      render(
        <SelectionPanel
          hit={elementTaskHit}
          onClose={vi.fn()}
          activePlan={plan}
          onAddToActivePlan={vi.fn()}
        />,
      );
      expect(screen.queryByLabelText('Add to plan')).toBeNull();
    });

    it('shows delete button when plan is Draft and onDeleteTask is provided', () => {
      const plan = createMockInspectionPlan({ status: 'Draft' });
      render(
        <SelectionPanel
          hit={elementTaskHit}
          onClose={vi.fn()}
          activePlan={plan}
          onDeleteTask={vi.fn()}
        />,
      );
      expect(screen.getByRole('button', { name: /delete task/i })).toBeDefined();
    });

    it('does not show delete button when plan is not Draft', () => {
      const plan = createMockInspectionPlan({ status: 'Ready' });
      render(
        <SelectionPanel
          hit={elementTaskHit}
          onClose={vi.fn()}
          activePlan={plan}
          onDeleteTask={vi.fn()}
        />,
      );
      expect(screen.queryByRole('button', { name: /delete task/i })).toBeNull();
    });

    it('does not show delete button when onDeleteTask is not provided', () => {
      const plan = createMockInspectionPlan({ status: 'Draft' });
      render(<SelectionPanel hit={elementTaskHit} onClose={vi.fn()} activePlan={plan} />);
      expect(screen.queryByRole('button', { name: /delete task/i })).toBeNull();
    });

    it('calls onDeleteTask when delete button is clicked', async () => {
      const onDeleteTask = vi.fn();
      const plan = createMockInspectionPlan({ status: 'Draft' });
      render(
        <SelectionPanel
          hit={elementTaskHit}
          onClose={vi.fn()}
          activePlan={plan}
          onDeleteTask={onDeleteTask}
        />,
      );
      await userEvent.click(screen.getByRole('button', { name: /delete task/i }));
      expect(onDeleteTask).toHaveBeenCalledOnce();
    });

    it('disables delete button while isDeletingTask is true', () => {
      const plan = createMockInspectionPlan({ status: 'Draft' });
      render(
        <SelectionPanel
          hit={elementTaskHit}
          onClose={vi.fn()}
          activePlan={plan}
          onDeleteTask={vi.fn()}
          isDeletingTask={true}
        />,
      );
      const btn = screen.getByRole('button', { name: /deleting/i });
      expect(btn.hasAttribute('disabled')).toBe(true);
    });
  });

  describe('defect hit', () => {
    const defect = createMockDefectDetection({
      externalId: 'defect-001',
      defectClass: 'corrosion',
      probability: 0.85,
      status: 'New',
      source: 'ml',
    });
    const defectHit: SelectionHit = { kind: 'defect', defect };

    it('shows "Defect" heading for a defect hit', () => {
      render(<SelectionPanel hit={defectHit} onClose={vi.fn()} />);
      expect(screen.getByRole('heading', { name: /^defect$/i })).toBeDefined();
    });

    it('renders defect class in the input', () => {
      render(<SelectionPanel hit={defectHit} onClose={vi.fn()} />);
      const input = screen.getByRole('textbox', { name: /defect class/i }) as HTMLInputElement;
      expect(input.value).toBe('corrosion');
    });

    it('renders probability as confidence percentage', () => {
      render(<SelectionPanel hit={defectHit} onClose={vi.fn()} />);
      const input = screen.getByRole('spinbutton', { name: /confidence percentage/i }) as HTMLInputElement;
      expect(Number(input.value)).toBe(85);
    });

    it('renders ML source badge', () => {
      render(<SelectionPanel hit={defectHit} onClose={vi.fn()} />);
      expect(screen.getByText('ML')).toBeDefined();
    });

    it('renders Manual source badge for manual defect', () => {
      const manualDefect = createMockDefectDetection({ source: 'manual' });
      render(<SelectionPanel hit={{ kind: 'defect', defect: manualDefect }} onClose={vi.fn()} />);
      expect(screen.getByText('Manual')).toBeDefined();
    });

    it('calls onUpdateDefect with new defect class on blur when changed', async () => {
      const onUpdateDefect = vi.fn();
      render(<SelectionPanel hit={defectHit} onClose={vi.fn()} onUpdateDefect={onUpdateDefect} />);
      const input = screen.getByRole('textbox', { name: /defect class/i });
      await userEvent.clear(input);
      await userEvent.type(input, 'crack');
      await userEvent.tab(); // blur
      expect(onUpdateDefect).toHaveBeenCalledWith({ defectClass: 'crack' });
    });

    it('calls onUpdateDefect with status when status button clicked', async () => {
      const onUpdateDefect = vi.fn();
      render(<SelectionPanel hit={defectHit} onClose={vi.fn()} onUpdateDefect={onUpdateDefect} />);
      await userEvent.click(screen.getByRole('button', { name: /set status to confirmed/i }));
      expect(onUpdateDefect).toHaveBeenCalledWith({ status: 'Confirmed' });
    });

    it('renders delete button when onDeleteDefect is provided', () => {
      render(<SelectionPanel hit={defectHit} onClose={vi.fn()} onDeleteDefect={vi.fn()} />);
      expect(screen.getByRole('button', { name: /delete defect/i })).toBeDefined();
    });

    it('opens a confirmation dialog when delete button is clicked', async () => {
      render(<SelectionPanel hit={defectHit} onClose={vi.fn()} onDeleteDefect={vi.fn()} />);
      await userEvent.click(screen.getByRole('button', { name: /delete defect/i }));
      expect(screen.getByRole('dialog')).toBeDefined();
    });

    it('calls onDeleteDefect when confirmed in the dialog', async () => {
      const onDeleteDefect = vi.fn();
      render(<SelectionPanel hit={defectHit} onClose={vi.fn()} onDeleteDefect={onDeleteDefect} />);
      await userEvent.click(screen.getByRole('button', { name: /delete defect/i }));
      await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
      expect(onDeleteDefect).toHaveBeenCalledOnce();
    });

    it('does not call onDeleteDefect when dialog is cancelled', async () => {
      const onDeleteDefect = vi.fn();
      render(<SelectionPanel hit={defectHit} onClose={vi.fn()} onDeleteDefect={onDeleteDefect} />);
      await userEvent.click(screen.getByRole('button', { name: /delete defect/i }));
      await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
      expect(onDeleteDefect).not.toHaveBeenCalled();
    });

    it('disables delete button while isDeletingDefect is true', () => {
      render(
        <SelectionPanel hit={defectHit} onClose={vi.fn()} onDeleteDefect={vi.fn()} isDeletingDefect={true} />,
      );
      const btn = screen.getByRole('button', { name: /delete defect/i });
      expect(btn.hasAttribute('disabled')).toBe(true);
    });

    it('shows add-to-plan section for a defect hit when onAddToActivePlan provided', () => {
      const plan = createMockInspectionPlan({ status: 'Draft' });
      render(
        <SelectionPanel
          hit={defectHit}
          onClose={vi.fn()}
          activePlan={plan}
          onAddToActivePlan={vi.fn()}
        />,
      );
      expect(screen.getByLabelText('Add to plan')).toBeDefined();
    });

    it('renders Fly to button when onFlyToDefect is provided', () => {
      render(<SelectionPanel hit={defectHit} onClose={vi.fn()} onFlyToDefect={vi.fn()} />);
      expect(screen.getByRole('button', { name: /fly to/i })).toBeDefined();
    });

    it('does not render Fly to button when onFlyToDefect is not provided', () => {
      render(<SelectionPanel hit={defectHit} onClose={vi.fn()} />);
      expect(screen.queryByRole('button', { name: /fly to/i })).toBeNull();
    });

    it('calls onFlyToDefect when Fly to button is clicked', async () => {
      const onFlyToDefect = vi.fn();
      render(<SelectionPanel hit={defectHit} onClose={vi.fn()} onFlyToDefect={onFlyToDefect} />);
      await userEvent.click(screen.getByRole('button', { name: /fly to/i }));
      expect(onFlyToDefect).toHaveBeenCalledOnce();
    });
  });

  describe('ndt hit', () => {
    it('shows "NDT Measurement" heading', () => {
      const hit: SelectionHit = { kind: 'ndt', measurement: createMockNdtMeasurement() };
      render(<SelectionPanel hit={hit} onClose={vi.fn()} />);
      expect(screen.getByRole('heading', { name: /ndt measurement/i })).toBeDefined();
    });

    it('renders position X/Y/Z from position3d', () => {
      const hit: SelectionHit = {
        kind: 'ndt',
        measurement: createMockNdtMeasurement({ position3d: [1.5, 2.5, 3.5] }),
      };
      render(<SelectionPanel hit={hit} onClose={vi.fn()} />);
      expect(screen.getByText('1.500')).toBeDefined();
      expect(screen.getByText('2.500')).toBeDefined();
      expect(screen.getByText('3.500')).toBeDefined();
    });

    it('renders timestamp and thickness', () => {
      const hit: SelectionHit = { kind: 'ndt', measurement: createMockNdtMeasurement() };
      render(<SelectionPanel hit={hit} onClose={vi.fn()} />);
      expect(screen.getByText('12.5 mm')).toBeDefined();
    });
  });

  describe('task location section', () => {
    it('renders position X/Y/Z rows for a region task', () => {
      const hit: SelectionHit = {
        kind: 'task',
        task: createMockRegionTask({ position3d: [4.1, 5.2, 6.3] }),
      };
      render(<SelectionPanel hit={hit} onClose={vi.fn()} />);
      expect(screen.getByText('4.100')).toBeDefined();
      expect(screen.getByText('5.200')).toBeDefined();
      expect(screen.getByText('6.300')).toBeDefined();
    });

    it('renders normal rows for a region task with normalVector', () => {
      const hit: SelectionHit = {
        kind: 'task',
        task: createMockRegionTask({ normalVector: [0.0, 1.0, 0.0] }),
      };
      render(<SelectionPanel hit={hit} onClose={vi.fn()} />);
      // NY is uniquely 1.000; NX and NZ are 0.000 (multiple matches expected)
      expect(screen.getByText('1.000')).toBeDefined();
      expect(screen.getAllByText('0.000').length).toBeGreaterThanOrEqual(2);
    });

    it('does not render a location section for an element task', () => {
      const hit: SelectionHit = { kind: 'task', task: createMockElementTask() };
      render(<SelectionPanel hit={hit} onClose={vi.fn()} />);
      // Element tasks have no 3D position — no Position heading should appear
      expect(screen.queryByText('Position')).toBeNull();
    });
  });

  describe('defect location section', () => {
    it('renders position X/Y/Z from boundingBox3d center for a defect hit', () => {
      const defect = createMockDefectDetection({ boundingBox3d: [7.1, 8.2, 9.3, 0, 0, 0, 0, 0, 0] });
      const hit: SelectionHit = { kind: 'defect', defect };
      render(<SelectionPanel hit={hit} onClose={vi.fn()} />);
      expect(screen.getByText('7.100')).toBeDefined();
      expect(screen.getByText('8.200')).toBeDefined();
      expect(screen.getByText('9.300')).toBeDefined();
    });

    it('renders normal rows when defect has normal3d', () => {
      const defect = createMockManualDefectDetection({
        boundingBox3d: [5, 6, 7, 0, 0, 0, 0, 0, 0],
        normal3d: [0.2, 0.3, 0.4],
      });
      const hit: SelectionHit = { kind: 'defect', defect };
      render(<SelectionPanel hit={hit} onClose={vi.fn()} />);
      expect(screen.getByText('Normal')).toBeDefined();
      expect(screen.getByText('0.200')).toBeDefined();
      expect(screen.getByText('0.300')).toBeDefined();
      expect(screen.getByText('0.400')).toBeDefined();
    });

    it('shows — for normal values when defect has no normal3d', () => {
      const defect = createMockDefectDetection({ normal3d: undefined });
      const hit: SelectionHit = { kind: 'defect', defect };
      render(<SelectionPanel hit={hit} onClose={vi.fn()} />);
      // normal3d absent → Normal section renders — for each of NX, NY, NZ
      const dashes = screen.getAllByText('—');
      expect(dashes.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('section labels', () => {
    it('renders Position section label for a region hit', () => {
      render(<SelectionPanel hit={regionHit} onClose={vi.fn()} />);
      expect(screen.getByText('Position')).toBeDefined();
    });

    it('renders Details and Position section labels for an element hit', () => {
      render(<SelectionPanel hit={elementHit} onClose={vi.fn()} />);
      expect(screen.getByText('Details')).toBeDefined();
      expect(screen.getByText('Position')).toBeDefined();
    });

    it('renders Position and Measurement section labels for an ndt hit', () => {
      const hit: SelectionHit = { kind: 'ndt', measurement: createMockNdtMeasurement() };
      render(<SelectionPanel hit={hit} onClose={vi.fn()} />);
      expect(screen.getByText('Position')).toBeDefined();
      expect(screen.getByText('Measurement')).toBeDefined();
    });

    it('renders Details section label for a task hit', () => {
      const hit: SelectionHit = { kind: 'task', task: createMockElementTask() };
      render(<SelectionPanel hit={hit} onClose={vi.fn()} />);
      expect(screen.getByText('Details')).toBeDefined();
    });

    it('renders Actions section label for a task when onFlyToTask is provided', () => {
      const hit: SelectionHit = { kind: 'task', task: createMockElementTask() };
      render(<SelectionPanel hit={hit} onClose={vi.fn()} onFlyToTask={vi.fn()} />);
      expect(screen.getByText('Actions')).toBeDefined();
    });

    it('does not render Actions section label for a task when no action callbacks are provided', () => {
      const hit: SelectionHit = { kind: 'task', task: createMockElementTask() };
      render(<SelectionPanel hit={hit} onClose={vi.fn()} />);
      expect(screen.queryByText('Actions')).toBeNull();
    });

    it('renders Actions section label for a defect hit when onFlyToDefect is provided', () => {
      const hit: SelectionHit = { kind: 'defect', defect: createMockDefectDetection() };
      render(<SelectionPanel hit={hit} onClose={vi.fn()} onFlyToDefect={vi.fn()} />);
      expect(screen.getByText('Actions')).toBeDefined();
    });

    it('renders Actions section label for a defect hit when onDeleteDefect is provided', () => {
      const hit: SelectionHit = { kind: 'defect', defect: createMockDefectDetection() };
      render(<SelectionPanel hit={hit} onClose={vi.fn()} onDeleteDefect={vi.fn()} />);
      expect(screen.getByText('Actions')).toBeDefined();
    });

    it('does not render Actions section label for a defect hit when no action callbacks are provided', () => {
      const hit: SelectionHit = { kind: 'defect', defect: createMockDefectDetection() };
      render(<SelectionPanel hit={hit} onClose={vi.fn()} />);
      expect(screen.queryByText('Actions')).toBeNull();
    });
  });

  describe('add defect (region hit)', () => {
    it('renders "Add defect" section when onCreateDefect is provided', () => {
      render(
        <SelectionPanel hit={regionHit} onClose={vi.fn()} onCreateDefect={vi.fn()} />,
      );
      expect(screen.getByLabelText('Add defect')).toBeDefined();
    });

    it('does not render "Add defect" section when onCreateDefect is not provided', () => {
      render(<SelectionPanel hit={regionHit} onClose={vi.fn()} />);
      expect(screen.queryByLabelText('Add defect')).toBeNull();
    });

    it('"Add defect" button is disabled when defect class is empty', () => {
      render(
        <SelectionPanel hit={regionHit} onClose={vi.fn()} onCreateDefect={vi.fn()} />,
      );
      const btn = screen.getByRole('button', { name: /^add defect$/i });
      expect(btn.hasAttribute('disabled')).toBe(true);
    });

    it('calls onCreateDefect with class and probability when submitted', async () => {
      const onCreateDefect = vi.fn();
      render(
        <SelectionPanel hit={regionHit} onClose={vi.fn()} onCreateDefect={onCreateDefect} />,
      );
      const classInput = screen.getByRole('textbox', { name: /defect class/i });
      await userEvent.type(classInput, 'pitting');
      await userEvent.click(screen.getByRole('button', { name: /^add defect$/i }));
      expect(onCreateDefect).toHaveBeenCalledWith('pitting', expect.any(Number));
    });

    it('disables "Add defect" button while isCreatingDefect is true', () => {
      render(
        <SelectionPanel hit={regionHit} onClose={vi.fn()} onCreateDefect={vi.fn()} isCreatingDefect={true} />,
      );
      const btn = screen.getByRole('button', { name: /adding/i });
      expect(btn.hasAttribute('disabled')).toBe(true);
    });
  });

  describe('image hit', () => {
    const imageHit: SelectionHit = {
      kind: 'image',
      image: createMockDroneImage({
        externalId: 'drone-image-frame-42',
        frameId: 42,
        timestamp: 1762179077.257,
        position: [1.5, -0.5, 4.8],
        orientationQuat: [0.001, 0.0003, -0.683, 0.730],
      }),
    };
    const imageUrl = 'https://cdn.example.test/frame-42.png';

    it('should show "Drone Image" heading', () => {
      render(<SelectionPanel hit={imageHit} onClose={vi.fn()} imageDownloadUrl={imageUrl} />);
      expect(screen.getByRole('heading', { name: /drone image/i })).toBeDefined();
    });

    it('should render the image with alt text containing the frame id', () => {
      render(<SelectionPanel hit={imageHit} onClose={vi.fn()} imageDownloadUrl={imageUrl} />);
      const img = screen.getByRole('img', { name: /frame 42/i }) as HTMLImageElement;
      expect(img.src).toBe(imageUrl);
    });

    it('should render frame id in metadata section', () => {
      render(<SelectionPanel hit={imageHit} onClose={vi.fn()} imageDownloadUrl={imageUrl} />);
      expect(screen.getByText('42')).toBeDefined();
    });

    it('should render formatted timestamp', () => {
      render(<SelectionPanel hit={imageHit} onClose={vi.fn()} imageDownloadUrl={imageUrl} />);
      // timestamp 1762179077.257 → 2025-11-03 14:11:17 UTC
      expect(screen.getByText(/2025-11-03/)).toBeDefined();
    });

    it('should render position values in metres', () => {
      render(<SelectionPanel hit={imageHit} onClose={vi.fn()} imageDownloadUrl={imageUrl} />);
      // Position fields rendered as "<number> m" across adjacent text nodes
      expect(screen.getByText(/1\.50/)).toBeDefined();
      expect(screen.getByText(/-0\.50/)).toBeDefined();
      expect(screen.getByText(/4\.80/)).toBeDefined();
    });

    it('should render yaw/pitch/roll labels', () => {
      render(<SelectionPanel hit={imageHit} onClose={vi.fn()} imageDownloadUrl={imageUrl} />);
      expect(screen.getByText('Yaw')).toBeDefined();
      expect(screen.getByText('Pitch')).toBeDefined();
      expect(screen.getByText('Roll')).toBeDefined();
    });

    it('should show a loading spinner while the URL is being fetched', () => {
      render(<SelectionPanel hit={imageHit} onClose={vi.fn()} isLoadingImageUrl={true} />);
      expect(screen.queryByRole('img', { name: /frame/i })).toBeNull();
      expect(screen.queryByText(/image unavailable/i)).toBeNull();
      // Loader renders a role="status" element
      expect(screen.getByRole('status')).toBeDefined();
    });

    it('should show "Image unavailable" when URL is not available and not loading', () => {
      render(<SelectionPanel hit={imageHit} onClose={vi.fn()} isLoadingImageUrl={false} />);
      expect(screen.getByText(/image unavailable/i)).toBeDefined();
    });

    it('should NOT show the "Add to plan" section', () => {
      const plan = createMockInspectionPlan();
      render(
        <SelectionPanel
          hit={imageHit}
          onClose={vi.fn()}
          imageDownloadUrl={imageUrl}
          activePlan={plan}
          onAddToActivePlan={vi.fn()}
        />,
      );
      expect(screen.queryByText(/inspection plan/i)).toBeNull();
    });

    it('renders Fly to button when onFlyToImage is provided', () => {
      render(<SelectionPanel hit={imageHit} onClose={vi.fn()} onFlyToImage={vi.fn()} />);
      expect(screen.getByRole('button', { name: /fly to/i })).toBeDefined();
    });

    it('does not render Fly to button when onFlyToImage is not provided', () => {
      render(<SelectionPanel hit={imageHit} onClose={vi.fn()} />);
      expect(screen.queryByRole('button', { name: /fly to/i })).toBeNull();
    });

    it('calls onFlyToImage when Fly to button is clicked', async () => {
      const onFlyToImage = vi.fn();
      render(<SelectionPanel hit={imageHit} onClose={vi.fn()} onFlyToImage={onFlyToImage} />);
      await userEvent.click(screen.getByRole('button', { name: /fly to/i }));
      expect(onFlyToImage).toHaveBeenCalledOnce();
    });

    describe('image ray picking interactions', () => {
      it('adds cursor-crosshair class to image when onHoverImagePixel is provided', () => {
        render(
          <SelectionPanel
            hit={imageHit}
            onClose={vi.fn()}
            imageDownloadUrl={imageUrl}
            onHoverImagePixel={vi.fn()}
          />,
        );
        const img = screen.getByRole('img', { name: /frame/i });
        expect(img.className).toContain('cursor-crosshair');
      });

      it('does not add cursor-crosshair class when no pixel callbacks are provided', () => {
        render(<SelectionPanel hit={imageHit} onClose={vi.fn()} imageDownloadUrl={imageUrl} />);
        const img = screen.getByRole('img', { name: /frame/i });
        expect(img.className).not.toContain('cursor-crosshair');
      });

      it('calls onHoverImagePixel when mouse moves over the image', () => {
        const onHoverImagePixel = vi.fn();
        render(
          <SelectionPanel
            hit={imageHit}
            onClose={vi.fn()}
            imageDownloadUrl={imageUrl}
            onHoverImagePixel={onHoverImagePixel}
          />,
        );
        const img = screen.getByRole('img', { name: /frame/i });
        fireEvent.mouseMove(img, { clientX: 100, clientY: 50 });
        expect(onHoverImagePixel).toHaveBeenCalledOnce();
        expect(onHoverImagePixel).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
      });

      it('calls onHoverImageExit when mouse leaves the image', () => {
        const onHoverImageExit = vi.fn();
        render(
          <SelectionPanel
            hit={imageHit}
            onClose={vi.fn()}
            imageDownloadUrl={imageUrl}
            onHoverImageExit={onHoverImageExit}
          />,
        );
        const img = screen.getByRole('img', { name: /frame/i });
        fireEvent.mouseLeave(img);
        expect(onHoverImageExit).toHaveBeenCalledOnce();
      });

      it('calls onSelectImagePixel when image is double-clicked', () => {
        const onSelectImagePixel = vi.fn();
        render(
          <SelectionPanel
            hit={imageHit}
            onClose={vi.fn()}
            imageDownloadUrl={imageUrl}
            onSelectImagePixel={onSelectImagePixel}
          />,
        );
        const img = screen.getByRole('img', { name: /frame/i });
        fireEvent.doubleClick(img, { clientX: 200, clientY: 100 });
        expect(onSelectImagePixel).toHaveBeenCalledOnce();
        expect(onSelectImagePixel).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
      });

      it('does not call onHoverImagePixel when image is in loading state', () => {
        const onHoverImagePixel = vi.fn();
        render(
          <SelectionPanel
            hit={imageHit}
            onClose={vi.fn()}
            isLoadingImageUrl={true}
            onHoverImagePixel={onHoverImagePixel}
          />,
        );
        expect(screen.queryByRole('img', { name: /frame/i })).toBeNull();
        expect(onHoverImagePixel).not.toHaveBeenCalled();
      });
    });

    describe('image lightbox', () => {
      it('renders an Enlarge button when image URL is available', () => {
        render(<SelectionPanel hit={imageHit} onClose={vi.fn()} imageDownloadUrl={imageUrl} />);
        expect(screen.getByRole('button', { name: /enlarge/i })).toBeDefined();
      });

      it('does not render an Enlarge button while the image is loading', () => {
        render(<SelectionPanel hit={imageHit} onClose={vi.fn()} isLoadingImageUrl={true} />);
        expect(screen.queryByRole('button', { name: /enlarge/i })).toBeNull();
      });

      it('does not render an Enlarge button when image URL is unavailable', () => {
        render(<SelectionPanel hit={imageHit} onClose={vi.fn()} />);
        expect(screen.queryByRole('button', { name: /enlarge/i })).toBeNull();
      });

      it('opens a lightbox dialog when Enlarge is clicked', async () => {
        render(<SelectionPanel hit={imageHit} onClose={vi.fn()} imageDownloadUrl={imageUrl} />);
        await userEvent.click(screen.getByRole('button', { name: /enlarge/i }));
        expect(screen.getByRole('dialog', { name: /enlarged drone image/i })).toBeDefined();
      });

      it('lightbox contains the drone image with the correct src', async () => {
        render(<SelectionPanel hit={imageHit} onClose={vi.fn()} imageDownloadUrl={imageUrl} />);
        await userEvent.click(screen.getByRole('button', { name: /enlarge/i }));
        const dialog = screen.getByRole('dialog', { name: /enlarged drone image/i });
        const img = within(dialog).getByRole('img') as HTMLImageElement;
        expect(img.src).toBe(imageUrl);
      });

      it('close button inside lightbox closes the lightbox', async () => {
        render(<SelectionPanel hit={imageHit} onClose={vi.fn()} imageDownloadUrl={imageUrl} />);
        await userEvent.click(screen.getByRole('button', { name: /enlarge/i }));
        await userEvent.click(screen.getByRole('button', { name: /close enlarged view/i }));
        expect(screen.queryByRole('dialog', { name: /enlarged drone image/i })).toBeNull();
      });

      it('clicking the dark backdrop closes the lightbox', async () => {
        render(<SelectionPanel hit={imageHit} onClose={vi.fn()} imageDownloadUrl={imageUrl} />);
        await userEvent.click(screen.getByRole('button', { name: /enlarge/i }));
        const dialog = screen.getByRole('dialog', { name: /enlarged drone image/i });
        // Fire directly on the backdrop element so e.target === e.currentTarget
        fireEvent.click(dialog);
        expect(screen.queryByRole('dialog', { name: /enlarged drone image/i })).toBeNull();
      });

      it('double-click in lightbox calls onSelectImagePixel and closes the lightbox', async () => {
        const onSelectImagePixel = vi.fn();
        render(
          <SelectionPanel
            hit={imageHit}
            onClose={vi.fn()}
            imageDownloadUrl={imageUrl}
            onSelectImagePixel={onSelectImagePixel}
          />,
        );
        await userEvent.click(screen.getByRole('button', { name: /enlarge/i }));
        const dialog = screen.getByRole('dialog', { name: /enlarged drone image/i });
        fireEvent.doubleClick(within(dialog).getByRole('img'), { clientX: 200, clientY: 100 });
        expect(onSelectImagePixel).toHaveBeenCalledOnce();
        expect(onSelectImagePixel).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
        expect(screen.queryByRole('dialog', { name: /enlarged drone image/i })).toBeNull();
      });
    });
  });
});
