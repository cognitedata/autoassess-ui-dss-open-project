import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewerControlsModal } from './ViewerControlsModal';
import { useViewerSettingsStore, VIEWER_SETTINGS_DEFAULTS } from './viewerSettingsStore';
import { useViewerControlsModeStore } from './viewerControlsModeStore';

describe(ViewerControlsModal.name, () => {
  beforeEach(() => {
    localStorage.clear();
    useViewerSettingsStore.setState({ ...VIEWER_SETTINGS_DEFAULTS });
    useViewerControlsModeStore.setState({ mode: 'free' });
  });

  function renderOpen() {
    return render(<ViewerControlsModal open onOpenChange={() => {}} />);
  }

  // ── Mode toggle ────────────────────────────────────────────────────────────

  it('renders the navigation mode toggle with Free flight and Ground plane options', () => {
    renderOpen();
    expect(screen.getByRole('button', { name: /free flight/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ground plane/i })).toBeInTheDocument();
  });

  it('Free flight button is pressed by default', () => {
    renderOpen();
    expect(screen.getByRole('button', { name: /free flight/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /ground plane/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking Ground plane switches the mode in the store', () => {
    renderOpen();
    fireEvent.click(screen.getByRole('button', { name: /ground plane/i }));
    expect(useViewerControlsModeStore.getState().mode).toBe('ground-plane');
  });

  it('switching to Ground plane updates button pressed state', () => {
    renderOpen();
    fireEvent.click(screen.getByRole('button', { name: /ground plane/i }));
    expect(screen.getByRole('button', { name: /ground plane/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /free flight/i })).toHaveAttribute('aria-pressed', 'false');
  });

  // ── Controls reference (mode-dependent) ───────────────────────────────────

  it('renders the controls reference section in free mode', () => {
    renderOpen();
    expect(screen.getByText(/move forward/i)).toBeInTheDocument();
    expect(screen.getByText(/strafe/i)).toBeInTheDocument();
    expect(screen.getByText(/look around/i)).toBeInTheDocument();
  });

  it('lists pitch and roll keys in free mode', () => {
    renderOpen();
    expect(screen.getByText(/pitch/i)).toBeInTheDocument();
    expect(screen.getByText(/roll/i)).toBeInTheDocument();
  });

  it('does not list pitch in ground-plane mode', () => {
    useViewerControlsModeStore.setState({ mode: 'ground-plane' });
    renderOpen();
    expect(screen.queryByText(/pitch/i)).not.toBeInTheDocument();
  });

  it('shows ground-specific action labels in ground-plane mode', () => {
    useViewerControlsModeStore.setState({ mode: 'ground-plane' });
    renderOpen();
    expect(screen.getByText(/rise \/ lower/i)).toBeInTheDocument();
    expect(screen.getByText(/turn left \/ right/i)).toBeInTheDocument();
    expect(screen.getByText(/pan along ground/i)).toBeInTheDocument();
  });

  it('shows roll shortcut in ground-plane mode', () => {
    useViewerControlsModeStore.setState({ mode: 'ground-plane' });
    renderOpen();
    expect(screen.getByText(/roll left \/ right/i)).toBeInTheDocument();
  });

  // ── Reset roll button ──────────────────────────────────────────────────────

  it('shows Reset roll button in ground-plane mode', () => {
    useViewerControlsModeStore.setState({ mode: 'ground-plane' });
    renderOpen();
    expect(screen.getByRole('button', { name: /reset roll/i })).toBeInTheDocument();
  });

  it('does not show Reset roll button in free mode', () => {
    renderOpen();
    expect(screen.queryByRole('button', { name: /reset roll/i })).not.toBeInTheDocument();
  });

  it('calls onResetRoll when Reset roll is clicked', () => {
    useViewerControlsModeStore.setState({ mode: 'ground-plane' });
    const onResetRoll = vi.fn();
    render(<ViewerControlsModal open onOpenChange={() => {}} onResetRoll={onResetRoll} />);
    fireEvent.click(screen.getByRole('button', { name: /reset roll/i }));
    expect(onResetRoll).toHaveBeenCalledOnce();
  });

  // ── Speed sliders ──────────────────────────────────────────────────────────

  it('movement speed slider reflects the store default', () => {
    renderOpen();
    const slider = screen.getByRole('slider', { name: /movement speed/i });
    expect(slider).toHaveValue(String(VIEWER_SETTINGS_DEFAULTS.moveSpeed));
  });

  it('rotation speed slider reflects the store default', () => {
    renderOpen();
    const slider = screen.getByRole('slider', { name: /rotation speed/i });
    expect(slider).toHaveValue(String(VIEWER_SETTINGS_DEFAULTS.keyRotateSpeed));
  });

  it('mouse sensitivity slider reflects the store default', () => {
    renderOpen();
    const slider = screen.getByRole('slider', { name: /mouse sensitivity/i });
    expect(slider).toHaveValue(String(VIEWER_SETTINGS_DEFAULTS.mouseRotateSpeed));
  });

  it('changing movement speed slider updates the store', () => {
    renderOpen();
    const slider = screen.getByRole('slider', { name: /movement speed/i });
    fireEvent.change(slider, { target: { value: '25' } });
    expect(useViewerSettingsStore.getState().moveSpeed).toBe(25);
  });

  // ── Visibility ─────────────────────────────────────────────────────────────

  it('does not render when open=false', () => {
    render(<ViewerControlsModal open={false} onOpenChange={() => {}} />);
    expect(screen.queryByText(/move forward/i)).not.toBeInTheDocument();
  });
});
