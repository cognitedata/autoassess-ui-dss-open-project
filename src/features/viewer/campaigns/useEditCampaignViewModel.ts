import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import type { InspectionResult } from '../InspectionResultService';
import type { FileModelStatus } from '../reveal/CampaignCadModelService';
import { useInspectionResults } from '../useInspectionResults';

import type { AreaFile, AreaFileKind } from './AreaFileService';
import { isValidCampaignDate, planCampaignSave } from './campaignEdit';
import type { CampaignWrite } from './campaignEdit';
import { useAreaFiles, useFileModelStatuses, useSaveCampaigns } from './useCampaignEditing';

export type EditCampaignViewModelContextType = {
  useInspectionResults: (areaSpace: string, areaExternalId: string) => UseQueryResult<InspectionResult[], Error>;
  useAreaFiles: (areaExternalId: string, enabled: boolean) => UseQueryResult<AreaFile[], Error>;
  useFileModelStatuses: (
    files: { fileId: number; campaignExternalId: string | null }[],
    enabled: boolean,
  ) => UseQueryResult<Map<number, FileModelStatus>, Error>;
  useSaveCampaigns: (areaSpace: string, areaExternalId: string) => UseMutationResult<void, Error, CampaignWrite[]>;
  newCampaignId: () => string;
  today: () => string;
};

const defaultDeps: EditCampaignViewModelContextType = {
  useInspectionResults,
  useAreaFiles,
  useFileModelStatuses,
  useSaveCampaigns,
  newCampaignId: () => `result-${crypto.randomUUID()}`,
  today: () => new Date().toISOString().slice(0, 10),
};

export const EditCampaignViewModelContext = createContext<EditCampaignViewModelContextType>(defaultDeps);

export interface CampaignFileRow {
  fileId: number;
  name: string;
  kind: AreaFileKind;
  label: string | null;
  /** For meshes: whether its 3D model is built; null for point clouds. */
  modelStatus: FileModelStatus | null;
  /** "Campaign <date>" when another campaign holds the file now (saving moves it here). */
  otherCampaignLabel: string | null;
  selected: boolean;
}

export interface EditCampaignViewModel {
  isOpen: boolean;
  mode: 'edit' | 'create';
  title: string;
  campaignDate: string;
  setCampaignDate: (date: string) => void;
  dateError: string | null;
  files: CampaignFileRow[];
  isLoadingFiles: boolean;
  filesError: Error | null;
  toggleFile: (fileId: number) => void;
  canSave: boolean;
  save: () => Promise<void>;
  isSaving: boolean;
  saveError: Error | null;
  openEdit: (campaignExternalId: string) => void;
  openCreate: () => void;
  close: () => void;
}

type DialogState = { mode: 'edit'; campaignExternalId: string } | { mode: 'create'; newExternalId: string } | null;

/** Edit a campaign's date and files, or make a new campaign from uploaded files. */
export function useEditCampaignViewModel(areaSpace: string, areaExternalId: string): EditCampaignViewModel {
  const deps = useContext(EditCampaignViewModelContext);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [campaignDate, setCampaignDate] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());

  const isOpen = dialog !== null;
  const campaigns = deps.useInspectionResults(areaSpace, areaExternalId).data;
  const filesQuery = deps.useAreaFiles(areaExternalId, isOpen);
  const saveMutation = deps.useSaveCampaigns(areaSpace, areaExternalId);

  const target = dialog?.mode === 'edit' ? campaigns?.find((c) => c.externalId === dialog.campaignExternalId) : undefined;
  const targetId = dialog?.mode === 'edit' ? dialog.campaignExternalId : dialog?.newExternalId;

  // Which campaign holds each file right now (a file belongs to at most one).
  const holder = useMemo(() => {
    const map = new Map<number, InspectionResult>();
    for (const c of campaigns ?? []) for (const id of [...c.cdfFileIds, ...c.pcdFileIds]) map.set(id, c);
    return map;
  }, [campaigns]);

  const rowsBase = useMemo(() => {
    const areaFiles = filesQuery.data ?? [];
    const known = new Set(areaFiles.map((f) => f.fileId));
    const classic = [
      ...(target?.cdfFileIds ?? []).map((fileId) => ({ fileId, kind: 'mesh' as const })),
      ...(target?.pcdFileIds ?? []).map((fileId) => ({ fileId, kind: 'pointcloud' as const })),
    ]
      .filter((f) => !known.has(f.fileId))
      .map((f) => ({ ...f, name: `File ${f.fileId}`, label: null }));
    return [...areaFiles.map(({ fileId, name, kind, label }) => ({ fileId, name, kind, label })), ...classic];
  }, [filesQuery.data, target]);

  const meshAssignments = useMemo(
    () =>
      rowsBase
        .filter((r) => r.kind === 'mesh')
        .map((r) => ({ fileId: r.fileId, campaignExternalId: holder.get(r.fileId)?.externalId ?? null })),
    [rowsBase, holder],
  );
  const statuses = deps.useFileModelStatuses(meshAssignments, isOpen).data;

  const files = useMemo<CampaignFileRow[]>(
    () =>
      rowsBase.map((row) => {
        const owner = holder.get(row.fileId);
        return {
          ...row,
          label: row.kind === 'pointcloud' ? pointCloudLabel(row.fileId, owner, row.label) : row.label,
          modelStatus: row.kind === 'mesh' ? statuses?.get(row.fileId) ?? null : null,
          otherCampaignLabel: owner && owner.externalId !== targetId ? `Campaign ${owner.date}` : null,
          selected: selected.has(row.fileId),
        };
      }),
    [rowsBase, holder, statuses, targetId, selected],
  );

  const openEdit = useCallback(
    (campaignExternalId: string) => {
      const campaign = campaigns?.find((c) => c.externalId === campaignExternalId);
      setDialog({ mode: 'edit', campaignExternalId });
      setCampaignDate(campaign?.date ?? '');
      setSelected(new Set([...(campaign?.cdfFileIds ?? []), ...(campaign?.pcdFileIds ?? [])]));
      saveMutation.reset();
    },
    [campaigns, saveMutation],
  );

  const openCreate = useCallback(() => {
    setDialog({ mode: 'create', newExternalId: deps.newCampaignId() });
    setCampaignDate(deps.today());
    setSelected(new Set());
    saveMutation.reset();
  }, [deps, saveMutation]);

  const close = useCallback(() => setDialog(null), []);

  const toggleFile = useCallback((fileId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  }, []);

  const dateError = isOpen && !isValidCampaignDate(campaignDate) ? 'Use a real date as YYYY-MM-DD' : null;
  const canSave =
    isOpen && dateError === null && !saveMutation.isPending && (dialog?.mode === 'edit' || selected.size > 0);

  const save = useCallback(async () => {
    if (!dialog || !canSave || !targetId) return;
    const chosen = files.filter((f) => f.selected);
    const writes = planCampaignSave(
      campaigns ?? [],
      {
        space: target?.space ?? areaSpace,
        externalId: targetId,
        ...(dialog.mode === 'create' && { create: { areaSpace, areaExternalId } }),
      },
      {
        campaignDate,
        meshFileIds: chosen.filter((f) => f.kind === 'mesh').map((f) => f.fileId),
        pointClouds: chosen
          .filter((f) => f.kind === 'pointcloud')
          .map((f) => ({ fileId: f.fileId, label: f.label ?? f.name })),
      },
    );
    try {
      await saveMutation.mutateAsync(writes);
      setDialog(null);
    } catch {
      // The error is shown through saveError; the dialog stays open so nothing is lost.
    }
  }, [dialog, canSave, targetId, files, campaigns, target, areaSpace, areaExternalId, campaignDate, saveMutation]);

  const mode = dialog?.mode ?? 'edit';
  return {
    isOpen,
    mode,
    title: mode === 'create' ? 'New campaign from files' : `Edit campaign ${target?.date ?? ''}`.trim(),
    campaignDate,
    setCampaignDate,
    dateError,
    files,
    isLoadingFiles: isOpen && filesQuery.isLoading,
    filesError: filesQuery.error ?? null,
    toggleFile,
    canSave,
    save,
    isSaving: saveMutation.isPending,
    saveError: saveMutation.error ?? null,
    openEdit,
    openCreate,
    close,
  };
}

function pointCloudLabel(fileId: number, owner: InspectionResult | undefined, tagLabel: string | null): string | null {
  const index = owner ? owner.pcdFileIds.indexOf(fileId) : -1;
  return (index >= 0 ? owner?.pcdFileLabels[index] : undefined) ?? tagLabel;
}
