import type { CogniteClient } from '@cognite/sdk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { assert, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InspectionResultService } from '../InspectionResultService';
import type { CampaignCadModelService } from '../reveal/CampaignCadModelService';

import type { AreaFile, AreaFileService } from './AreaFileService';
import { CampaignEditingContext, useAreaFiles, useFileModelStatuses, useSaveCampaigns } from './useCampaignEditing';
import type { CampaignEditingDeps } from './useCampaignEditing';

describe('campaign editing hooks', () => {
  let areaFiles: AreaFileService;
  let cadModels: CampaignCadModelService;
  let results: InspectionResultService;
  let queryClient: QueryClient;
  let wrapper: ComponentType<{ children: ReactNode }>;

  beforeEach(() => {
    areaFiles = { listForArea: vi.fn(() => Promise.resolve([areaFile(11)])) };
    cadModels = {
      listForCampaigns: vi.fn(() => {
        assert.fail('Not used by these hooks');
      }),
      modelStatusForFiles: vi.fn(() => Promise.resolve(new Map([[11, 'ready' as const]]))),
    };
    results = {
      listForArea: vi.fn(() => {
        assert.fail('Not used by these hooks');
      }),
      saveCampaigns: vi.fn(() => Promise.resolve()),
    };
    const deps: CampaignEditingDeps = {
      useCogniteSdk: () => ({}) as CogniteClient,
      createAreaFileService: () => areaFiles,
      createCadModelService: () => cadModels,
      createResultService: () => results,
    };
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <CampaignEditingContext.Provider value={deps}>{children}</CampaignEditingContext.Provider>
      </QueryClientProvider>
    );
  });

  describe(useAreaFiles.name, () => {
    it('should not fetch while disabled', () => {
      renderHook(() => useAreaFiles('area-1', false), { wrapper });

      expect(areaFiles.listForArea).not.toHaveBeenCalled();
    });

    it("should return the area's files", async () => {
      const { result } = renderHook(() => useAreaFiles('area-1', true), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([areaFile(11)]);
      expect(areaFiles.listForArea).toHaveBeenCalledWith('area-1');
    });

    it('should expose errors', async () => {
      vi.mocked(areaFiles.listForArea).mockRejectedValue(new Error('403'));

      const { result } = renderHook(() => useAreaFiles('area-1', true), { wrapper });

      await waitFor(() => expect(result.current.isError).toBe(true));
    });
  });

  describe(useFileModelStatuses.name, () => {
    it('should return the model state per file', async () => {
      const files = [{ fileId: 11, campaignExternalId: 'result-1' }];

      const { result } = renderHook(() => useFileModelStatuses(files, true), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.get(11)).toBe('ready');
      expect(cadModels.modelStatusForFiles).toHaveBeenCalledWith(files);
    });

    it('should not fetch for no files', () => {
      renderHook(() => useFileModelStatuses([], true), { wrapper });

      expect(cadModels.modelStatusForFiles).not.toHaveBeenCalled();
    });
  });

  describe(useSaveCampaigns.name, () => {
    it('should save the writes and refresh campaigns and 3D models', async () => {
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
      const writes = [{ space: 'autoassess', externalId: 'r', cdfFileIds: [1], pcdFileIds: [], pcdFileLabels: [] }];
      const { result } = renderHook(() => useSaveCampaigns('autoassess', 'area-1'), { wrapper });

      await act(async () => {
        await result.current.mutateAsync(writes);
      });

      expect(results.saveCampaigns).toHaveBeenCalledWith(writes);
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['inspectionResults', 'autoassess', 'area-1'] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['campaign-cad-models'] });
    });

    it('should expose save errors', async () => {
      vi.mocked(results.saveCampaigns).mockRejectedValue(new Error('403'));
      const { result } = renderHook(() => useSaveCampaigns('autoassess', 'area-1'), { wrapper });

      await act(async () => {
        await result.current.mutateAsync([]).catch(() => undefined);
      });

      await waitFor(() => expect(result.current.error?.message).toBe('403'));
    });
  });
});

function areaFile(fileId: number): AreaFile {
  return { fileId, externalId: `f${fileId}`, name: `f${fileId}.ply`, kind: 'mesh', label: null, createdTime: 1, uploaded: true };
}
