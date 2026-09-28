import type { UseQueryResult, UseMutationResult } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import type { DefectDetection, DefectStatus, DefectUpdates, NewManualDefect } from './DefectDetectionService';
import {
  useDefectDetections as defaultUseDefectDetections,
  useUpdateDefectStatus as defaultUseUpdateDefectStatus,
  useUpdateDefect as defaultUseUpdateDefect,
  useCreateDefect as defaultUseCreateDefect,
  useDeleteDefect as defaultUseDeleteDefect,
} from './useDefectDetections';

// ---- Dependency injection types ----

type UseDefectDetectionsFn = (
  areaSpace: string,
  areaExternalId: string,
) => UseQueryResult<DefectDetection[], Error>;

type UseUpdateDefectStatusFn = (
  areaSpace: string,
  areaExternalId: string,
) => UseMutationResult<void, Error, { space: string; externalId: string; status: DefectStatus }>;

type UseUpdateDefectFn = (
  areaSpace: string,
  areaExternalId: string,
) => UseMutationResult<void, Error, { space: string; externalId: string; updates: DefectUpdates }>;

type UseCreateDefectFn = (
  areaSpace: string,
  areaExternalId: string,
) => UseMutationResult<DefectDetection, Error, NewManualDefect>;

type UseDeleteDefectFn = (
  areaSpace: string,
  areaExternalId: string,
) => UseMutationResult<void, Error, { space: string; externalId: string }>;

export type DefectsPanelViewModelContextType = {
  useDefectDetections: UseDefectDetectionsFn;
  useUpdateDefectStatus: UseUpdateDefectStatusFn;
  useUpdateDefect: UseUpdateDefectFn;
  useCreateDefect: UseCreateDefectFn;
  useDeleteDefect: UseDeleteDefectFn;
};

const defaultDeps: DefectsPanelViewModelContextType = {
  useDefectDetections: defaultUseDefectDetections,
  useUpdateDefectStatus: defaultUseUpdateDefectStatus,
  useUpdateDefect: defaultUseUpdateDefect,
  useCreateDefect: defaultUseCreateDefect,
  useDeleteDefect: defaultUseDeleteDefect,
};

export const DefectsPanelViewModelContext =
  createContext<DefectsPanelViewModelContextType>(defaultDeps);

// ---- Public types ----

export type SortKey = 'probability' | 'status';

export interface DefectsPanelViewModel {
  defects: DefectDetection[];
  isLoading: boolean;
  error: Error | null;
  sortKey: SortKey;
  setSortKey: (key: SortKey) => void;
  selectedDefectId: string | null;
  /** Full selected defect object, derived from defects list. null if none selected. */
  selectedDefect: DefectDetection | null;
  updateStatus: (space: string, externalId: string, status: DefectStatus) => void;
  isUpdatingStatus: boolean;
  updateDefect: (space: string, externalId: string, updates: DefectUpdates) => void;
  isUpdatingDefect: boolean;
  createDefect: (defect: NewManualDefect) => void;
  isCreatingDefect: boolean;
  deleteDefect: (space: string, externalId: string) => void;
  isDeletingDefect: boolean;
}

// ---- Sort helpers ----

const STATUS_ORDER: Record<DefectStatus, number> = {
  New: 0,
  UnderReview: 1,
  Confirmed: 2,
  Dismissed: 3,
};

function sortDefects(defects: DefectDetection[], key: SortKey): DefectDetection[] {
  return [...defects].sort((a, b) => {
    if (key === 'probability') {
      return b.probability - a.probability;
    }
    return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  });
}

// ---- Implementation ----

export function useDefectsPanelViewModel(
  areaSpace: string,
  areaExternalId: string,
  selectedDefectId: string | null = null,
): DefectsPanelViewModel {
  const {
    useDefectDetections,
    useUpdateDefectStatus,
    useUpdateDefect,
    useCreateDefect,
    useDeleteDefect,
  } = useContext(DefectsPanelViewModelContext);

  const [sortKey, setSortKey] = useState<SortKey>('probability');

  const defectsQuery = useDefectDetections(areaSpace, areaExternalId);
  const updateStatusMutation = useUpdateDefectStatus(areaSpace, areaExternalId);
  const updateDefectMutation = useUpdateDefect(areaSpace, areaExternalId);
  const createDefectMutation = useCreateDefect(areaSpace, areaExternalId);
  const deleteDefectMutation = useDeleteDefect(areaSpace, areaExternalId);

  const sortedDefects = useMemo(
    () => sortDefects(defectsQuery.data ?? [], sortKey),
    [defectsQuery.data, sortKey],
  );

  const selectedDefect = useMemo(
    () => sortedDefects.find((d) => d.externalId === selectedDefectId) ?? null,
    [sortedDefects, selectedDefectId],
  );

  const updateStatus = useCallback(
    (space: string, externalId: string, status: DefectStatus) => {
      updateStatusMutation.mutate({ space, externalId, status });
    },
    [updateStatusMutation],
  );

  const updateDefect = useCallback(
    (space: string, externalId: string, updates: DefectUpdates) => {
      updateDefectMutation.mutate({ space, externalId, updates });
    },
    [updateDefectMutation],
  );

  const createDefect = useCallback(
    (defect: NewManualDefect) => {
      createDefectMutation.mutate(defect);
    },
    [createDefectMutation],
  );

  const deleteDefect = useCallback(
    (space: string, externalId: string) => {
      deleteDefectMutation.mutate({ space, externalId });
    },
    [deleteDefectMutation],
  );

  return {
    defects: sortedDefects,
    isLoading: defectsQuery.isLoading,
    error: defectsQuery.error ?? null,
    sortKey,
    setSortKey,
    selectedDefectId,
    selectedDefect,
    updateStatus,
    isUpdatingStatus: updateStatusMutation.isPending,
    updateDefect,
    isUpdatingDefect: updateDefectMutation.isPending,
    createDefect,
    isCreatingDefect: createDefectMutation.isPending,
    deleteDefect,
    isDeletingDefect: deleteDefectMutation.isPending,
  };
}
