import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EditCampaignDialog } from './EditCampaignDialog';
import type { CampaignFileRow, EditCampaignViewModel } from './useEditCampaignViewModel';

describe(EditCampaignDialog.name, () => {
  it('should render nothing while closed', () => {
    render(<EditCampaignDialog viewModel={viewModel({ isOpen: false })} />);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('should show the date and every file with its model state', () => {
    render(<EditCampaignDialog viewModel={viewModel()} />);

    expect(screen.getByRole('heading', { name: 'Edit campaign 2026-09-01' })).toBeInTheDocument();
    expect(screen.getByLabelText('Campaign date')).toHaveValue('2026-09-01');
    expect(screen.getByRole('checkbox', { name: /a\.ply/ })).toBeChecked();
    expect(screen.getByText('3D model ready')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /b\.ply/ })).not.toBeChecked();
    expect(screen.getByText('Waiting for dss worker')).toBeInTheDocument();
    expect(screen.getByText('In Campaign 2026-08-01')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Cloud A/ })).toBeChecked();
  });

  it('should say a selected file from another campaign moves here', () => {
    render(<EditCampaignDialog viewModel={viewModel({ files: [row({ fileId: 12, name: 'b.ply', selected: true, otherCampaignLabel: 'Campaign 2026-08-01' })] })} />);

    expect(screen.getByText('Moves here from Campaign 2026-08-01')).toBeInTheDocument();
  });

  it('should toggle a file when its checkbox is clicked', async () => {
    const vm = viewModel();
    render(<EditCampaignDialog viewModel={vm} />);

    await userEvent.click(screen.getByRole('checkbox', { name: /b\.ply/ }));

    expect(vm.toggleFile).toHaveBeenCalledWith(12);
  });

  it('should edit the date', async () => {
    const vm = viewModel();
    render(<EditCampaignDialog viewModel={vm} />);

    await userEvent.type(screen.getByLabelText('Campaign date'), '1');

    expect(vm.setCampaignDate).toHaveBeenCalled();
  });

  it('should save', async () => {
    const vm = viewModel();
    render(<EditCampaignDialog viewModel={vm} />);

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(vm.save).toHaveBeenCalled();
  });

  it('should disable saving when the view model says so', () => {
    render(<EditCampaignDialog viewModel={viewModel({ canSave: false, dateError: 'Use a real date as YYYY-MM-DD' })} />);

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(screen.getByText('Use a real date as YYYY-MM-DD')).toBeInTheDocument();
  });

  it('should label the create mode', () => {
    render(<EditCampaignDialog viewModel={viewModel({ mode: 'create', title: 'New campaign from files' })} />);

    expect(screen.getByRole('heading', { name: 'New campaign from files' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create campaign' })).toBeInTheDocument();
  });

  it('should show a loader while the files load', () => {
    render(<EditCampaignDialog viewModel={viewModel({ isLoadingFiles: true, files: [] })} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('should show file loading and saving errors', () => {
    render(<EditCampaignDialog viewModel={viewModel({ filesError: new Error('403'), saveError: new Error('409') })} />);

    expect(screen.getByText("Couldn't load the area's files: 403")).toBeInTheDocument();
    expect(screen.getByText("Couldn't save the campaign: 409")).toBeInTheDocument();
  });

  it('should say when the area has no uploaded files', () => {
    render(<EditCampaignDialog viewModel={viewModel({ files: [] })} />);

    expect(screen.getByText(/No uploaded meshes or point clouds/)).toBeInTheDocument();
  });
});

function row(overrides: Partial<CampaignFileRow>): CampaignFileRow {
  return { fileId: 11, name: 'a.ply', kind: 'mesh', label: null, modelStatus: 'ready', otherCampaignLabel: null, selected: true, ...overrides };
}

function viewModel(overrides: Partial<EditCampaignViewModel> = {}): EditCampaignViewModel {
  return {
    isOpen: true,
    mode: 'edit',
    title: 'Edit campaign 2026-09-01',
    campaignDate: '2026-09-01',
    setCampaignDate: vi.fn(),
    dateError: null,
    files: [
      row({}),
      row({ fileId: 12, name: 'b.ply', modelStatus: 'none', otherCampaignLabel: 'Campaign 2026-08-01', selected: false }),
      row({ fileId: 21, name: 'c.pcd', kind: 'pointcloud', label: 'Cloud A', modelStatus: null }),
    ],
    isLoadingFiles: false,
    filesError: null,
    toggleFile: vi.fn(),
    canSave: true,
    save: vi.fn(() => Promise.resolve()),
    isSaving: false,
    saveError: null,
    openEdit: vi.fn(),
    openCreate: vi.fn(),
    close: vi.fn(),
    ...overrides,
  };
}
