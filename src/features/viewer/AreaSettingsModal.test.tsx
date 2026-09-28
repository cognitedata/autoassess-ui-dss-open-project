import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AreaSettingsModal } from './AreaSettingsModal';

describe(AreaSettingsModal.name, () => {
  let onOpenChange: ReturnType<typeof vi.fn>;
  let onResetToDefaultPose: ReturnType<typeof vi.fn>;
  let onSaveCurrentAsPose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onOpenChange = vi.fn();
    onResetToDefaultPose = vi.fn();
    onSaveCurrentAsPose = vi.fn();
  });

  function renderModal(props: Partial<Parameters<typeof AreaSettingsModal>[0]> = {}) {
    return render(
      <AreaSettingsModal
        open={true}
        onOpenChange={onOpenChange}
        isSaving={false}
        onResetToDefaultPose={onResetToDefaultPose}
        onSaveCurrentAsPose={onSaveCurrentAsPose}
        {...props}
      />,
    );
  }

  it('should show "Automatic (fit to model)" when no default pose is set', () => {
    renderModal();

    expect(screen.getByText(/automatic/i)).toBeInTheDocument();
  });

  it('should show formatted coordinates when a default pose is set', () => {
    renderModal({
      defaultCameraPose: {
        position: [1.123, 2.456, 3.789],
        target: [4.111, 5.222, 6.333],
      },
    });

    expect(screen.getByText(/1\.12/)).toBeInTheDocument();
    expect(screen.getByText(/4\.11/)).toBeInTheDocument();
  });

  it('should disable the "Return to starting view" button when no default pose is set', () => {
    renderModal();

    const button = screen.getByRole('button', { name: /return to starting view/i });
    expect(button).toBeDisabled();
  });

  it('should enable the "Return to starting view" button when a default pose is set', () => {
    renderModal({
      defaultCameraPose: { position: [1, 2, 3], target: [4, 5, 6] },
    });

    const button = screen.getByRole('button', { name: /return to starting view/i });
    expect(button).not.toBeDisabled();
  });

  it('should call onResetToDefaultPose when "Return to starting view" is clicked', async () => {
    const user = userEvent.setup();
    renderModal({
      defaultCameraPose: { position: [1, 2, 3], target: [4, 5, 6] },
    });

    await user.click(screen.getByRole('button', { name: /return to starting view/i }));

    expect(onResetToDefaultPose).toHaveBeenCalledTimes(1);
  });

  it('should call onSaveCurrentAsPose when "Set current view as default" is clicked', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole('button', { name: /set current view as default/i }));

    expect(onSaveCurrentAsPose).toHaveBeenCalledTimes(1);
  });

  it('should disable "Set current view as default" while saving', () => {
    renderModal({ isSaving: true });

    const button = screen.getByRole('button', { name: /set current view as default/i });
    expect(button).toBeDisabled();
  });
});
