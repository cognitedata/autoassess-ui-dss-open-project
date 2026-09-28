import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createMockDefectDetection } from '../../__mocks__/defectDetections';

import { DefectsPanel } from './DefectsPanel';
import type { DefectsPanelViewModel } from './useDefectsPanelViewModel';

function makeViewModel(overrides: Partial<DefectsPanelViewModel> = {}): DefectsPanelViewModel {
  return {
    defects: [],
    isLoading: false,
    error: null,
    sortKey: 'probability',
    setSortKey: vi.fn(),
    selectedDefectId: null,
    selectedDefect: null,
    updateStatus: vi.fn(),
    isUpdatingStatus: false,
    updateDefect: vi.fn(),
    isUpdatingDefect: false,
    createDefect: vi.fn(),
    isCreatingDefect: false,
    deleteDefect: vi.fn(),
    isDeletingDefect: false,
    ...overrides,
  };
}

describe(DefectsPanel.name, () => {
  describe('loading state', () => {
    it('renders a loader while defects are loading', () => {
      render(<DefectsPanel viewModel={makeViewModel({ isLoading: true })} />);
      expect(screen.getByRole('status')).toBeDefined();
    });
  });

  describe('error state', () => {
    it('renders error message when query fails', () => {
      render(
        <DefectsPanel
          viewModel={makeViewModel({ error: new Error('Network failure') })}
        />,
      );
      expect(screen.getByText(/failed to load defects/i)).toBeDefined();
      expect(screen.getByText(/network failure/i)).toBeDefined();
    });
  });

  describe('empty state', () => {
    it('renders empty state when no defects exist', () => {
      render(<DefectsPanel viewModel={makeViewModel()} />);
      expect(screen.getByText('No defects recorded for this area.')).toBeDefined();
    });
  });

  describe('defect list', () => {
    let defect1 = createMockDefectDetection({ defectClass: 'corrosion', probability: 0.87, status: 'New' });
    let defect2 = createMockDefectDetection({ defectClass: 'crack', probability: 0.55, status: 'Confirmed' });

    beforeEach(() => {
      defect1 = createMockDefectDetection({ defectClass: 'corrosion', probability: 0.87, status: 'New' });
      defect2 = createMockDefectDetection({ defectClass: 'crack', probability: 0.55, status: 'Confirmed' });
    });

    it('renders defect rows', () => {
      render(
        <DefectsPanel
          viewModel={makeViewModel({ defects: [defect1, defect2] })}
        />,
      );
      expect(screen.getByRole('list', { name: /detected defects/i })).toBeDefined();
      expect(screen.getByText('corrosion')).toBeDefined();
      expect(screen.getByText('crack')).toBeDefined();
    });

    it('renders confidence percentage for each defect', () => {
      render(
        <DefectsPanel viewModel={makeViewModel({ defects: [defect1] })} />,
      );
      expect(screen.getByText('87%')).toBeDefined();
    });

    it('renders status badge', () => {
      render(
        <DefectsPanel viewModel={makeViewModel({ defects: [defect2] })} />,
      );
      expect(screen.getByText('Confirmed')).toBeDefined();
    });

    it('calls onDefectSelected when a row is clicked', async () => {
      const onDefectSelected = vi.fn();
      render(
        <DefectsPanel
          viewModel={makeViewModel({ defects: [defect1] })}
          onDefectSelected={onDefectSelected}
        />,
      );

      const listItem = screen.getByRole('listitem');
      await userEvent.click(listItem);

      expect(onDefectSelected).toHaveBeenCalledWith(defect1);
    });

    it('highlights selected defect row', () => {
      render(
        <DefectsPanel
          viewModel={makeViewModel({
            defects: [defect1],
            selectedDefectId: defect1.externalId,
          })}
        />,
      );
      const row = screen.getByRole('listitem');
      expect(row.getAttribute('aria-selected')).toBe('true');
    });

    it('does not render status editing buttons in the defect row', () => {
      render(<DefectsPanel viewModel={makeViewModel({ defects: [defect1] })} />);
      expect(screen.queryByRole('group', { name: /update defect status/i })).toBeNull();
    });
  });

  describe('sort toolbar', () => {
    it('renders Confidence and Status sort buttons', () => {
      render(<DefectsPanel viewModel={makeViewModel()} />);
      expect(screen.getByRole('button', { name: 'Confidence', hidden: true })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Status', hidden: true })).toBeDefined();
    });

    it('calls setSortKey when a sort button is clicked', async () => {
      const setSortKey = vi.fn();
      render(<DefectsPanel viewModel={makeViewModel({ setSortKey })} />);

      await userEvent.click(screen.getByText('Status'));

      expect(setSortKey).toHaveBeenCalledWith('status');
    });
  });
});
