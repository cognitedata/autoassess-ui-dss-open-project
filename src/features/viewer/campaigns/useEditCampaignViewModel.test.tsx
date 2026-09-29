import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockInspectionResult } from '../../../__mocks__/inspectionResults';
import type { InspectionResult } from '../InspectionResultService';
import type { FileModelStatus } from '../reveal/CampaignCadModelService';

import type { AreaFile } from './AreaFileService';
import type { CampaignWrite } from './campaignEdit';
import { EditCampaignViewModelContext, useEditCampaignViewModel } from './useEditCampaignViewModel';
import type { EditCampaignViewModelContextType } from './useEditCampaignViewModel';

describe(useEditCampaignViewModel.name, () => {
  let deps: EditCampaignViewModelContextType;
  let wrapper: ComponentType<{ children: ReactNode }>;
  let mutateAsync: ReturnType<typeof vi.fn<(writes: CampaignWrite[]) => Promise<void>>>;

  beforeEach(() => {
    mutateAsync = vi.fn(() => Promise.resolve());
    deps = {
      useInspectionResults: vi.fn(() => success(CAMPAIGNS)),
      useAreaFiles: vi.fn(() => success(AREA_FILES)),
      useFileModelStatuses: vi.fn(() => success(new Map<number, FileModelStatus>([[11, 'ready'], [12, 'none']]))),
      useSaveCampaigns: vi.fn(() => mutation({ mutateAsync })),
      newCampaignId: () => 'result-new',
      today: () => '2026-09-28',
    };
    wrapper = ({ children }) => (
      <EditCampaignViewModelContext.Provider value={deps}>{children}</EditCampaignViewModelContext.Provider>
    );
  });

  it('should be closed and fetch no files until opened', () => {
    const { result } = render();

    expect(result.current.isOpen).toBe(false);
    expect(deps.useAreaFiles).toHaveBeenLastCalledWith('area-1', false);
  });

  it('should show a loading state while the files load', () => {
    vi.mocked(deps.useAreaFiles).mockReturnValue(pending());
    const { result } = render();

    act(() => result.current.openEdit('result-a'));

    expect(result.current.isLoadingFiles).toBe(true);
    expect(deps.useAreaFiles).toHaveBeenLastCalledWith('area-1', true);
  });

  it("should seed the dialog with the campaign's date and files", () => {
    const { result } = render();

    act(() => result.current.openEdit('result-a'));

    expect(result.current.mode).toBe('edit');
    expect(result.current.title).toBe('Edit campaign 2026-09-01');
    expect(result.current.campaignDate).toBe('2026-09-01');
    expect(result.current.files).toEqual([
      { fileId: 11, name: 'a.ply', kind: 'mesh', label: null, modelStatus: 'ready', otherCampaignLabel: null, selected: true },
      { fileId: 12, name: 'b.ply', kind: 'mesh', label: null, modelStatus: 'none', otherCampaignLabel: 'Campaign 2026-08-01', selected: false },
      { fileId: 21, name: 'c.pcd', kind: 'pointcloud', label: 'Cloud A', modelStatus: null, otherCampaignLabel: null, selected: true },
    ]);
  });

  it("should ask for the model state of meshes in the campaign they're in now", () => {
    const { result } = render();

    act(() => result.current.openEdit('result-a'));

    expect(deps.useFileModelStatuses).toHaveBeenLastCalledWith(
      [
        { fileId: 11, campaignExternalId: 'result-a' },
        { fileId: 12, campaignExternalId: 'result-b' },
      ],
      true,
    );
  });

  it('should keep classic files of the campaign that are not area CogniteFiles', () => {
    vi.mocked(deps.useInspectionResults).mockReturnValue(
      success([campaign('result-a', '2026-09-01', { cdfFileIds: [11, 99] })]),
    );
    const { result } = render();

    act(() => result.current.openEdit('result-a'));

    expect(result.current.files.find((f) => f.fileId === 99)).toMatchObject({ name: 'File 99', kind: 'mesh', selected: true });
  });

  it('should move a mesh from another campaign on save and close', async () => {
    const { result } = render();
    act(() => result.current.openEdit('result-a'));

    act(() => result.current.toggleFile(12));
    await act(async () => {
      await result.current.save();
    });

    const writes = mutateAsync.mock.calls[0][0];
    expect(writes.map((w) => [w.externalId, w.cdfFileIds])).toEqual([
      ['result-a', [11, 12]],
      ['result-b', []],
    ]);
    expect(writes[0].pcdFileLabels).toEqual(['Cloud A']);
    expect(result.current.isOpen).toBe(false);
  });

  it('should change only the date when nothing else changes', async () => {
    const { result } = render();
    act(() => result.current.openEdit('result-a'));

    act(() => result.current.setCampaignDate('2026-09-05'));
    await act(async () => {
      await result.current.save();
    });

    const writes = mutateAsync.mock.calls[0][0];
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ externalId: 'result-a', campaignDate: '2026-09-05', cdfFileIds: [11], pcdFileIds: [21] });
  });

  it('should create a new campaign from the picked files', async () => {
    const { result } = render();
    act(() => result.current.openCreate());

    expect(result.current.title).toBe('New campaign from files');
    expect(result.current.campaignDate).toBe('2026-09-28');
    expect(result.current.canSave).toBe(false); // no file picked yet

    act(() => result.current.toggleFile(11));
    await act(async () => {
      await result.current.save();
    });

    const writes = mutateAsync.mock.calls[0][0];
    expect(writes[0]).toMatchObject({
      externalId: 'result-new',
      campaignDate: '2026-09-28',
      cdfFileIds: [11],
      create: { areaSpace: 'autoassess', areaExternalId: 'area-1' },
    });
    expect(writes[1]).toMatchObject({ externalId: 'result-a', cdfFileIds: [] });
  });

  it('should refuse an invalid date', () => {
    const { result } = render();
    act(() => result.current.openEdit('result-a'));

    act(() => result.current.setCampaignDate('2026-13-01'));

    expect(result.current.dateError).toBe('Use a real date as YYYY-MM-DD');
    expect(result.current.canSave).toBe(false);
  });

  it('should keep the dialog open and expose the error when saving fails', async () => {
    const error = new Error('403');
    mutateAsync.mockRejectedValue(error);
    vi.mocked(deps.useSaveCampaigns).mockReturnValue(mutation({ mutateAsync, error }));
    const { result } = render();
    act(() => result.current.openEdit('result-a'));

    await act(async () => {
      await result.current.save();
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.saveError?.message).toBe('403');
  });

  it('should expose errors loading the files', () => {
    vi.mocked(deps.useAreaFiles).mockReturnValue(failure(new Error('403')));
    const { result } = render();

    act(() => result.current.openEdit('result-a'));

    expect(result.current.filesError?.message).toBe('403');
  });

  function render() {
    return renderHook(() => useEditCampaignViewModel('autoassess', 'area-1'), { wrapper });
  }
});

// ---- Helpers ----

const CAMPAIGNS: InspectionResult[] = [
  campaign('result-a', '2026-09-01', { cdfFileIds: [11], pcdFileIds: [21], pcdFileLabels: ['Cloud A'] }),
  campaign('result-b', '2026-08-01', { cdfFileIds: [12] }),
];

const AREA_FILES: AreaFile[] = [
  areaFile(11, 'a.ply', 'mesh'),
  areaFile(12, 'b.ply', 'mesh'),
  areaFile(21, 'c.pcd', 'pointcloud', 'tag label'),
];

function campaign(externalId: string, date: string, overrides: Partial<InspectionResult> = {}): InspectionResult {
  return createMockInspectionResult({ externalId, date, areaExternalId: 'area-1', ...overrides });
}

function areaFile(fileId: number, name: string, kind: AreaFile['kind'], label: string | null = null): AreaFile {
  return { fileId, externalId: `x${fileId}`, name, kind, label, createdTime: fileId, uploaded: true };
}

function success<T>(data: T): UseQueryResult<T, Error> {
  return { data, isLoading: false, isPending: false, isSuccess: true, isError: false, error: null, status: 'success' } as UseQueryResult<T, Error>;
}

function pending<T>(): UseQueryResult<T, Error> {
  return { data: undefined, isLoading: true, isPending: true, isSuccess: false, isError: false, error: null, status: 'pending' } as UseQueryResult<T, Error>;
}

function failure<T>(error: Error): UseQueryResult<T, Error> {
  return { data: undefined, isLoading: false, isPending: false, isSuccess: false, isError: true, error, status: 'error' } as UseQueryResult<T, Error>;
}

function mutation(
  overrides: Partial<UseMutationResult<void, Error, CampaignWrite[]>>,
): UseMutationResult<void, Error, CampaignWrite[]> {
  return { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null, reset: vi.fn(), ...overrides } as UseMutationResult<void, Error, CampaignWrite[]>;
}
