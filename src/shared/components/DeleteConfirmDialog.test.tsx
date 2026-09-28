import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';

function renderDialog(props: Partial<Parameters<typeof DeleteConfirmDialog>[0]> = {}) {
  const defaults = {
    open: true,
    onOpenChange: vi.fn(),
    entityName: 'Test Entity',
    entityKind: 'vessel' as const,
    isDeleting: false,
    onConfirm: vi.fn(),
  };
  return render(<DeleteConfirmDialog {...defaults} {...props} />);
}

describe(DeleteConfirmDialog.name, () => {
  it('renders the entity name in the description', () => {
    renderDialog({ entityName: 'MV Nordic Star', entityKind: 'vessel' });
    expect(screen.getByText('MV Nordic Star', { exact: false })).toBeInTheDocument();
  });

  it('shows vessel-specific description text', () => {
    renderDialog({ entityKind: 'vessel' });
    expect(screen.getByText(/all its areas will be hidden/i)).toBeInTheDocument();
  });

  it('shows area-specific description text', () => {
    renderDialog({ entityKind: 'area', entityName: 'Tank A' });
    expect(screen.getByText(/Inspection campaigns/i)).toBeInTheDocument();
  });

  it('shows plan-specific description text', () => {
    renderDialog({ entityKind: 'plan', entityName: 'Q3 hull survey' });
    expect(screen.getByText(/inspection tasks will be permanently deleted/i)).toBeInTheDocument();
  });

  it('calls onConfirm when Delete button is clicked', async () => {
    const onConfirm = vi.fn();
    renderDialog({ onConfirm });

    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onOpenChange(false) when Cancel is clicked', async () => {
    const onOpenChange = vi.fn();
    renderDialog({ onOpenChange });

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('disables both buttons while isDeleting=true', () => {
    renderDialog({ isDeleting: true });

    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /deleting/i })).toBeDisabled();
  });

  it('shows "Deleting…" label on the confirm button while isPending', () => {
    renderDialog({ isDeleting: true });
    expect(screen.getByRole('button', { name: /deleting/i })).toBeInTheDocument();
  });
});
