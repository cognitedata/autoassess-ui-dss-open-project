import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import { PlanFormDialog } from './PlanFormDialog';
import type { MapOption } from './useInspectionPlansViewModel';

const DEFAULT_MAPS: MapOption[] = [
  { externalId: 'result-2024-09-15', label: 'Campaign 2024-09-15' },
  { externalId: 'result-2024-06-01', label: 'Campaign 2024-06-01' },
];

type CreateDialogProps = Extract<Parameters<typeof PlanFormDialog>[0], { mode: 'create' }>;
type EditDialogProps = Extract<Parameters<typeof PlanFormDialog>[0], { mode: 'edit' }>;

describe(PlanFormDialog.name, () => {
  function renderDialog(overrides: Partial<CreateDialogProps> = {}) {
    const onOpenChange = vi.fn();
    const onSubmit = vi.fn();
    render(
      <PlanFormDialog
        open
        onOpenChange={onOpenChange}
        mode="create"
        availableMaps={DEFAULT_MAPS}
        defaultMapExternalId={DEFAULT_MAPS[0].externalId}
        onSubmit={onSubmit}
        isSubmitting={false}
        {...overrides}
      />,
    );
    return { onOpenChange, onSubmit };
  }

  function renderEditDialog(overrides: Partial<EditDialogProps> = {}) {
    const onOpenChange = vi.fn();
    const onSubmit = vi.fn();
    render(
      <PlanFormDialog
        open
        onOpenChange={onOpenChange}
        mode="edit"
        initialValues={{ name: null, description: null }}
        onSubmit={onSubmit}
        isSubmitting={false}
        {...overrides}
      />,
    );
    return { onOpenChange, onSubmit };
  }

  describe('create mode', () => {
    it('should render name and description inputs as optional', () => {
      renderDialog();
      expect(screen.getByLabelText(/name/i)).toBeDefined();
      expect(screen.getByLabelText(/description/i)).toBeDefined();
    });

    it('should render both fields blank', () => {
      renderDialog();
      expect(screen.getByLabelText(/name/i)).toHaveValue('');
      expect(screen.getByLabelText(/description/i)).toHaveValue('');
    });

    it('should enable the submit button even when name/description are blank', () => {
      renderDialog();
      const submitButton = screen.getByRole('button', { name: /create plan/i });
      expect((submitButton as HTMLButtonElement).disabled).toBe(false);
    });

    it('should call onSubmit with undefined name/description and the default map when both fields are left blank', async () => {
      const { onSubmit } = renderDialog();
      await userEvent.click(screen.getByRole('button', { name: /create plan/i }));
      expect(onSubmit).toHaveBeenCalledWith({
        mapExternalId: 'result-2024-09-15',
        name: undefined,
        description: undefined,
      });
    });

    it('should call onSubmit with trimmed name/description when provided', async () => {
      const { onSubmit } = renderDialog();
      await userEvent.type(screen.getByLabelText(/name/i), '  Q3 hull survey  ');
      await userEvent.type(screen.getByLabelText(/description/i), '  Focus on aft hull  ');
      await userEvent.click(screen.getByRole('button', { name: /create plan/i }));
      expect(onSubmit).toHaveBeenCalledWith({
        mapExternalId: 'result-2024-09-15',
        name: 'Q3 hull survey',
        description: 'Focus on aft hull',
      });
    });

    it('should disable the submit button while submitting', () => {
      renderDialog({ isSubmitting: true });
      const submitButton = screen.getByRole('button', { name: /creating/i });
      expect((submitButton as HTMLButtonElement).disabled).toBe(true);
    });

    it('should show an error message when provided', () => {
      renderDialog({ error: new Error('Network error') });
      expect(screen.getByText(/network error/i)).toBeDefined();
    });

    it('should not render an error message by default', () => {
      renderDialog();
      expect(screen.queryByText(/failed to create plan/i)).toBeNull();
    });

    describe('map selection', () => {
      it('should render every available map as an option', () => {
        renderDialog();
        expect(screen.getByRole('option', { name: 'Campaign 2024-09-15' })).toBeDefined();
        expect(screen.getByRole('option', { name: 'Campaign 2024-06-01' })).toBeDefined();
      });

      it('should default the map select to defaultMapExternalId', () => {
        renderDialog({ defaultMapExternalId: 'result-2024-06-01' });
        expect(screen.getByLabelText(/map/i)).toHaveValue('result-2024-06-01');
      });

      it('should submit the user-selected map instead of the default when changed', async () => {
        const { onSubmit } = renderDialog();
        await userEvent.selectOptions(screen.getByLabelText(/map/i), 'result-2024-06-01');
        await userEvent.click(screen.getByRole('button', { name: /create plan/i }));
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({ mapExternalId: 'result-2024-06-01' }),
        );
      });

      it('should disable the submit button when there are no available maps', () => {
        renderDialog({ availableMaps: [], defaultMapExternalId: null });
        const submitButton = screen.getByRole('button', { name: /create plan/i });
        expect((submitButton as HTMLButtonElement).disabled).toBe(true);
      });
    });
  });

  describe('edit mode', () => {
    it('should not render a map select field', () => {
      renderEditDialog();
      expect(screen.queryByLabelText(/map/i)).toBeNull();
    });

    describe('when mapField is provided (Draft plan)', () => {
      it('should render a map select seeded to currentMapExternalId', () => {
        renderEditDialog({
          mapField: { availableMaps: DEFAULT_MAPS, currentMapExternalId: 'result-2024-06-01' },
        });
        expect(screen.getByLabelText(/map/i)).toHaveValue('result-2024-06-01');
      });

      it('should submit the changed map in the payload', async () => {
        const { onSubmit } = renderEditDialog({
          mapField: { availableMaps: DEFAULT_MAPS, currentMapExternalId: 'result-2024-06-01' },
        });
        await userEvent.selectOptions(screen.getByLabelText(/map/i), 'result-2024-09-15');
        await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({ mapExternalId: 'result-2024-09-15' }),
        );
      });

      it('should honestly show "No map selected" rather than defaulting to a real option', () => {
        renderEditDialog({
          mapField: { availableMaps: DEFAULT_MAPS, currentMapExternalId: null },
        });
        expect(screen.getByLabelText(/map/i)).toHaveValue('');
        expect(screen.getByRole('option', { name: 'No map selected' })).toBeDefined();
      });

      it('should enable submit even with no map chosen, so other fields can still be saved', () => {
        renderEditDialog({
          mapField: { availableMaps: DEFAULT_MAPS, currentMapExternalId: null },
        });
        const submitButton = screen.getByRole('button', { name: /save changes/i });
        expect((submitButton as HTMLButtonElement).disabled).toBe(false);
      });

      it('should omit mapExternalId from the payload when saved without picking a map', async () => {
        const { onSubmit } = renderEditDialog({
          mapField: { availableMaps: DEFAULT_MAPS, currentMapExternalId: null },
        });
        await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
        expect(onSubmit).toHaveBeenCalledWith({ name: undefined, description: undefined });
      });

      it('should include the chosen mapExternalId once a map is actively picked from the unset state', async () => {
        const { onSubmit } = renderEditDialog({
          mapField: { availableMaps: DEFAULT_MAPS, currentMapExternalId: null },
        });
        await userEvent.selectOptions(screen.getByLabelText(/map/i), 'result-2024-09-15');
        await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
        expect(onSubmit).toHaveBeenCalledWith(
          expect.objectContaining({ mapExternalId: 'result-2024-09-15' }),
        );
      });

      it('should still allow saving when there are no available maps at all', () => {
        renderEditDialog({
          mapField: { availableMaps: [], currentMapExternalId: null },
        });
        const submitButton = screen.getByRole('button', { name: /save changes/i });
        expect((submitButton as HTMLButtonElement).disabled).toBe(false);
      });
    });

    it('should pre-fill fields from initialValues', () => {
      renderEditDialog({
        initialValues: { name: 'Q3 hull survey', description: 'Focus on aft hull' },
      });
      expect(screen.getByLabelText(/name/i)).toHaveValue('Q3 hull survey');
      expect(screen.getByLabelText(/description/i)).toHaveValue('Focus on aft hull');
    });

    it('should render blank fields when initialValues are null', () => {
      renderEditDialog({ initialValues: { name: null, description: null } });
      expect(screen.getByLabelText(/name/i)).toHaveValue('');
      expect(screen.getByLabelText(/description/i)).toHaveValue('');
    });

    it('should show edit-mode title and button copy', () => {
      renderEditDialog({
        initialValues: { name: 'Q3 hull survey', description: null },
      });
      expect(screen.getByRole('button', { name: /save changes/i })).toBeDefined();
    });

    it('should show "Saving…" while submitting', () => {
      renderEditDialog({
        initialValues: { name: 'Q3 hull survey', description: null },
        isSubmitting: true,
      });
      expect(screen.getByRole('button', { name: /saving/i })).toBeDefined();
    });

    it('should submit edited values', async () => {
      const { onSubmit } = renderEditDialog({
        initialValues: { name: 'Old name', description: 'Old description' },
      });
      const nameInput = screen.getByLabelText(/name/i);
      await userEvent.clear(nameInput);
      await userEvent.type(nameInput, 'New name');
      await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
      expect(onSubmit).toHaveBeenCalledWith({ name: 'New name', description: 'Old description' });
    });

    it('should show an edit-specific error message', () => {
      renderEditDialog({
        initialValues: { name: 'X', description: null },
        error: new Error('Network error'),
      });
      expect(screen.getByText(/failed to update plan/i)).toBeDefined();
    });

    it('should re-seed fields when reopened with different initialValues', () => {
      const { rerender } = render(
        <PlanFormDialog
          open
          onOpenChange={vi.fn()}
          mode="edit"
          initialValues={{ name: 'Plan A', description: null }}
          onSubmit={vi.fn()}
          isSubmitting={false}
        />,
      );
      expect(screen.getByLabelText(/name/i)).toHaveValue('Plan A');

      rerender(
        <PlanFormDialog
          open={false}
          onOpenChange={vi.fn()}
          mode="edit"
          initialValues={{ name: 'Plan A', description: null }}
          onSubmit={vi.fn()}
          isSubmitting={false}
        />,
      );
      rerender(
        <PlanFormDialog
          open
          onOpenChange={vi.fn()}
          mode="edit"
          initialValues={{ name: 'Plan B', description: 'Second plan' }}
          onSubmit={vi.fn()}
          isSubmitting={false}
        />,
      );

      expect(screen.getByLabelText(/name/i)).toHaveValue('Plan B');
      expect(screen.getByLabelText(/description/i)).toHaveValue('Second plan');
    });
  });
});
