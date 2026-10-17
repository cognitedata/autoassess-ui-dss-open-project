import {
  Alert,
  AlertDescription,
  Button,
  Loader,
} from '@cognite/aura/components';
import { IconArrowLeft, IconChartBar, IconKeyboard, IconSettings } from '@tabler/icons-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Vector3 } from 'three';

import logo from '../../../assets/autoassess-logo.png';
import { AUTOASSESS_SPACE } from '../../shared/cdf/dataModel';
import { useSetGroundPlane, useSetDefaultCameraPose } from '../areas/useMutateArea';

import { AreaSettingsModal } from './AreaSettingsModal';
import { useEditCampaignViewModel } from './campaigns/useEditCampaignViewModel';
import { formatCameraParam, parseCameraParam } from './cameraParam';
import type { CameraPose } from './cameraParam';
import type { DefectDetection, DefectUpdates } from './DefectDetectionService';
import type { InspectionTask, InspectionType } from './InspectionTaskService';
import type { PlyViewerHandle } from './PlyViewer';
import { MissingCadModelNotice } from './reveal/MissingCadModelNotice';
import { useCampaignCadModels } from './reveal/useCampaignCadModels';
import { SegmentLegend } from './SegmentLegend';
import type { SelectionHit } from './selection';
import { SelectionPanel } from './SelectionPanel';
import { useDefectsPanelViewModel } from './useDefectsPanelViewModel';
import { useDroneImages, useDroneImageDownloadUrl } from './useDroneImages';
import { useInspectionPlansViewModel } from './useInspectionPlansViewModel';
import { useLayerPanelViewModel } from './useLayerPanelViewModel';
import { useNdtMeasurements } from './useNdtMeasurements';
import { usePlyUrls } from './usePlyUrls';
import { useViewerViewModel } from './useViewerViewModel';
import { ViewerControlsModal } from './ViewerControlsModal';
import { useViewerControlsModeStore } from './viewerControlsModeStore';
import { ViewerRightPanel } from './ViewerRightPanel';
import type { RightPanelTab } from './ViewerRightPanel';

// PlyViewer uses WebGL — load it only when a model URL is ready
const PlyViewer = lazy(() =>
  import('./PlyViewer').then((m) => ({ default: m.PlyViewer })),
);

export function ViewerPage() {
  const { vesselId = '', areaId = '' } = useParams<{ vesselId: string; areaId: string }>();
  const navigate = useNavigate();
  const { area, vesselName, elements, isLoading, error, elementsError } = useViewerViewModel(AUTOASSESS_SPACE, areaId);

  const ndtResult = useNdtMeasurements(AUTOASSESS_SPACE, areaId);
  const ndtMeasurements = ndtResult.data ?? [];

  const droneImagesResult = useDroneImages(AUTOASSESS_SPACE, areaId);
  const droneImages = droneImagesResult.data ?? [];

  const droneImageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const img of droneImages) {
      counts.set(img.campaignExternalId, (counts.get(img.campaignExternalId) ?? 0) + 1);
    }
    return counts;
  }, [droneImages]);

  const layerPanelViewModel = useLayerPanelViewModel(
    AUTOASSESS_SPACE,
    areaId,
    elements.length > 0,
    ndtMeasurements,
    droneImageCounts,
  );

  // Campaigns with uploaded meshes. Each mesh file has its own CDF CAD model (streamed by
  // Reveal), built by `dss worker`; a campaign shows the models of the files it lists now.
  const meshCampaigns = useMemo(() => {
    const byCampaign = new Map<string, number[]>();
    for (const entry of layerPanelViewModel.allPlyEntries) {
      byCampaign.set(entry.campaignId, [...(byCampaign.get(entry.campaignId) ?? []), Number(entry.key)]);
    }
    return [...byCampaign].map(([externalId, cdfFileIds]) => ({ externalId, cdfFileIds }));
  }, [layerPanelViewModel.allPlyEntries]);
  const cadModelsResult = useCampaignCadModels(meshCampaigns);
  const cadModels = useMemo(
    () => (cadModelsResult.data?.models ?? []).filter((m) => m.status === 'Done'),
    [cadModelsResult.data],
  );
  const waitingCampaignIds = useMemo(
    () => [...new Set((cadModelsResult.data?.meshesWithoutModel ?? []).map((m) => m.campaignExternalId))],
    [cadModelsResult.data],
  );
  const processingCampaignIds = useMemo(
    () => [...new Set((cadModelsResult.data?.models ?? [])
      .filter((m) => m.status !== 'Done' && m.status !== 'Failed')
      .map((m) => m.campaignExternalId))],
    [cadModelsResult.data],
  );
  const campaignsWithoutModel = waitingCampaignIds.length + processingCampaignIds.length > 0;

  // Each CAD model's collision proxy (small decimated PLY) — ray-cast for picking and normals.
  const proxyFileIds = useMemo(() => cadModels.map((m) => m.collisionProxyFileId), [cadModels]);
  const proxyUrlsResult = usePlyUrls(proxyFileIds);
  // Memoized so the array reference is stable across re-renders triggered by visibility
  // changes — prevents PlyViewer's useEffect from re-firing and resetting the camera.
  const plyEntries = useMemo(
    () => cadModels.map((m, i) => ({
      key: m.key,
      campaignId: m.campaignExternalId,
      url: proxyUrlsResult.data?.[i] ?? '',
    })),
    [cadModels, proxyUrlsResult.data],
  );

  const pcdUrlsResult = usePlyUrls(layerPanelViewModel.allPcdFileIds);
  // Memoized so the array reference is stable across re-renders triggered by pcd
  // visibility changes — prevents PlyViewer's useEffect from re-firing and resetting the camera.
  const pcdEntries = useMemo(
    () => layerPanelViewModel.allPcdFileIds.map((id, i) => ({
      key: String(id),
      url: pcdUrlsResult.data?.[i] ?? '',
    })),
    [layerPanelViewModel.allPcdFileIds, pcdUrlsResult.data],
  );

  const plansViewModel = useInspectionPlansViewModel(AUTOASSESS_SPACE, areaId);
  const editCampaignViewModel = useEditCampaignViewModel(AUTOASSESS_SPACE, areaId);
  const [selection, setSelection] = useState<SelectionHit | null>(null);

  const selectedImageCdfFileId = selection?.kind === 'image' ? selection.image.cdfFileId : null;
  const imageDownloadUrlResult = useDroneImageDownloadUrl(selectedImageCdfFileId);

  const selectedDefectId = selection?.kind === 'defect' ? selection.defect.externalId : null;
  const defectsViewModel = useDefectsPanelViewModel(AUTOASSESS_SPACE, areaId, selectedDefectId);

  // When the selection is a defect, always show the live version from the query cache
  // rather than the snapshot captured at click time. This keeps the context panel in sync
  // with the list after edits trigger a re-fetch.
  const resolvedHit = useMemo((): SelectionHit | null => {
    if (selection?.kind === 'defect' && defectsViewModel.selectedDefect) {
      return { kind: 'defect', defect: defectsViewModel.selectedDefect };
    }
    return selection;
  }, [selection, defectsViewModel.selectedDefect]);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('layers');
  const [controlsModalOpen, setControlsModalOpen] = useState(false);
  const [areaSettingsModalOpen, setAreaSettingsModalOpen] = useState(false);
  const controlsMode = useViewerControlsModeStore((s) => s.mode);

  // Callback ref so we know when PlyViewer has mounted (it's lazy-loaded).
  // viewerMounted triggers the auto-fly effect when the URL carries ?flyToImage=<id>.
  const plyViewerRef = useRef<PlyViewerHandle | null>(null);
  const [viewerMounted, setViewerMounted] = useState(false);
  const plyViewerCallbackRef = useCallback((node: PlyViewerHandle | null) => {
    plyViewerRef.current = node;
    if (node) setViewerMounted(true);
  }, []);

  // Auto-fly when navigated from the mission report with ?flyToImage=<externalId>
  const [searchParams, setSearchParams] = useSearchParams();
  const flyToImageIdParam = searchParams.get('flyToImage');
  // ?camera=px,py,pz,tx,ty,tz overrides the area's default start pose (shareable views, regression shots)
  const cameraParam = searchParams.get('camera');
  const cameraParamPose = useMemo(() => parseCameraParam(cameraParam), [cameraParam]);
  // Keep the current view in ?camera= so a copied Fusion link reopens the same view.
  const handleCameraSettled = useCallback(
    (pose: CameraPose) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('camera', formatCameraParam(pose));
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const hasFiredFlyTo = useRef(false);
  useEffect(() => {
    if (!flyToImageIdParam || hasFiredFlyTo.current || !viewerMounted) return;
    if (droneImages.length === 0 || !plyViewerRef.current) return;
    const image = droneImages.find((img) => img.externalId === flyToImageIdParam);
    if (!image) return;
    plyViewerRef.current.flyToImage(image);
    plyViewerRef.current.selectImage(image);
    setSelection({ kind: 'image', image });
    hasFiredFlyTo.current = true;
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [flyToImageIdParam, droneImages, viewerMounted, setSearchParams]);

  const handleAddToActivePlan = (inspectionType: InspectionType) => {
    if (!resolvedHit) return;
    plansViewModel.addTaskFromHit(resolvedHit, inspectionType);
  };

  const handleClose = () => {
    setSelection(null);
    plyViewerRef.current?.clearAllSelections();
    plyViewerRef.current?.clearImageRayHover();
  };

  const handleTaskSelected = (task: InspectionTask) => {
    setSelection({ kind: 'task', task });
    plyViewerRef.current?.clearAllSelections();
    plyViewerRef.current?.selectTask(task);
    plyViewerRef.current?.hoverTask(null); // clear hover state once selected
  };

  const handleFlyToTask = () => {
    if (selection?.kind !== 'task') return;
    plyViewerRef.current?.flyToTask(selection.task);
  };

  const handleDeleteTask = () => {
    if (selection?.kind !== 'task') return;
    plansViewModel.removeTask(selection.task.space, selection.task.externalId);
    setSelection(null);
    plyViewerRef.current?.clearAllSelections();
  };

  useEffect(() => {
    if (!plansViewModel.activePlan && selection?.kind === 'task') {
      handleClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plansViewModel.activePlan]);

  const handleDefectHit = (defect: DefectDetection) => {
    setSelection({ kind: 'defect', defect });
    plyViewerRef.current?.clearAllSelections();
    plyViewerRef.current?.selectDefect(defect);
  };

  const handleFlyToRegion = () => {
    if (selection?.kind !== 'region') return;
    plyViewerRef.current?.flyTo(selection.position, selection.normal);
  };

  const setGroundPlaneMutation = useSetGroundPlane(AUTOASSESS_SPACE, areaId, vesselId);
  const setDefaultCameraPoseMutation = useSetDefaultCameraPose(AUTOASSESS_SPACE, areaId, vesselId);

  const handleSetGroundPlane = () => {
    if (selection?.kind !== 'region') return;
    const { normal } = selection;
    setGroundPlaneMutation.mutate([normal.x, normal.y, normal.z]);
  };

  const handleFlyToDefect = () => {
    if (selection?.kind !== 'defect') return;
    const { defect } = selection;
    if (defect.boundingBox3d.length >= 3) {
      const [cx, cy, cz] = defect.boundingBox3d;
      const normal = defect.normal3d ? new Vector3(...defect.normal3d) : undefined;
      plyViewerRef.current?.flyTo(new Vector3(cx, cy, cz), normal);
    }
  };

  const handleFlyToImage = () => {
    if (selection?.kind !== 'image') return;
    plyViewerRef.current?.flyToImage(selection.image);
  };

  const handleHoverImagePixel = (u: number, v: number) => {
    if (selection?.kind !== 'image') return;
    plyViewerRef.current?.hoverImageRay(selection.image, u, v);
  };

  const handleHoverImageExit = () => {
    plyViewerRef.current?.clearImageRayHover();
  };

  const handleSelectImagePixel = (u: number, v: number) => {
    if (selection?.kind !== 'image') return;
    plyViewerRef.current?.selectImageRay(selection.image, u, v);
  };

  const handleDeleteDefect = () => {
    if (selection?.kind !== 'defect') return;
    const { defect } = selection;
    defectsViewModel.deleteDefect(defect.space, defect.externalId);
    setSelection(null);
    plyViewerRef.current?.clearAllSelections();
  };

  const handleUpdateDefect = (updates: DefectUpdates) => {
    if (selection?.kind !== 'defect') return;
    const { defect } = selection;
    defectsViewModel.updateDefect(defect.space, defect.externalId, updates);
  };

  const handleCreateDefect = (defectClass: string, probability: number) => {
    if (selection?.kind !== 'region') return;
    const { position, normal } = selection;
    defectsViewModel.createDefect({
      position: [position.x, position.y, position.z],
      normal: [normal.x, normal.y, normal.z],
      defectClass,
      probability,
    });
  };

  const areaName = area?.name ?? areaId;
  const hasModel = plyEntries.length > 0 || pcdEntries.length > 0;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center gap-4 border-b border-border bg-background px-6 py-3">
        <img src={logo} alt="AutoAssess" className="h-7 w-auto" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(`/vessels/${vesselId}/areas`)}
        >
          <IconArrowLeft size={16} aria-hidden />
          Back
        </Button>
        <div className="flex-1">
          {vesselName ? (
            <>
              <h1 className="text-base font-semibold leading-tight">{vesselName}</h1>
              <p className="text-sm text-muted-foreground leading-tight">{areaName}</p>
            </>
          ) : (
            <h1 className="text-lg font-semibold">{areaName}</h1>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Camera controls"
          onClick={() => setControlsModalOpen(true)}
        >
          <IconKeyboard size={16} aria-hidden />
          <span className="text-xs text-muted-foreground">
            {controlsMode === 'ground-plane' ? 'Ground' : 'Free'}
          </span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Area settings"
          onClick={() => setAreaSettingsModalOpen(true)}
        >
          <IconSettings size={16} aria-hidden />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate(`/vessels/${vesselId}/areas/${areaId}/report`)}
        >
          <IconChartBar size={16} aria-hidden />
          Reports
        </Button>
      </header>

      {elementsError && (
        <div className="shrink-0 px-6 pt-3">
          <Alert variant="error" role="alert">
            <AlertDescription>
              Semantic overlay unavailable: {elementsError.message}
            </AlertDescription>
          </Alert>
        </div>
      )}

      <main className="relative flex flex-1 flex-row overflow-hidden">
        {/* Canvas area — SelectionPanel is absolute within this div */}
        <div className="relative flex-1 overflow-hidden">
          <SelectionPanel
            hit={resolvedHit}
            onClose={handleClose}
            activePlan={plansViewModel.activePlan}
            onAddToActivePlan={handleAddToActivePlan}
            onOpenPlansTab={() => setRightPanelTab('plans')}
            isAddingTask={plansViewModel.isAddingTask}
            onDeleteTask={handleDeleteTask}
            onFlyToTask={handleFlyToTask}
            onFlyToRegion={selection?.kind === 'region' ? handleFlyToRegion : undefined}
            onSetGroundPlane={selection?.kind === 'region' ? handleSetGroundPlane : undefined}
            onFlyToDefect={handleFlyToDefect}
            onUpdateDefect={handleUpdateDefect}
            onDeleteDefect={handleDeleteDefect}
            isUpdatingDefect={defectsViewModel.isUpdatingDefect}
            isDeletingDefect={defectsViewModel.isDeletingDefect}
            onCreateDefect={handleCreateDefect}
            isCreatingDefect={defectsViewModel.isCreatingDefect}
            imageDownloadUrl={imageDownloadUrlResult.data}
            isLoadingImageUrl={imageDownloadUrlResult.isLoading}
            onFlyToImage={selection?.kind === 'image' ? handleFlyToImage : undefined}
            onHoverImagePixel={selection?.kind === 'image' ? handleHoverImagePixel : undefined}
            onHoverImageExit={selection?.kind === 'image' ? handleHoverImageExit : undefined}
            onSelectImagePixel={selection?.kind === 'image' ? handleSelectImagePixel : undefined}
          />

          {isLoading && (
            <div className="flex h-full items-center justify-center">
              <Loader role="status" size={32} />
            </div>
          )}

          {error && (
            <div className="p-8">
              <Alert variant="error" role="alert">
                <AlertDescription>Failed to load viewer: {error.message}</AlertDescription>
              </Alert>
            </div>
          )}

          {!isLoading && !error && hasModel && (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center">
                  <Loader role="status" size={32} />
                </div>
              }
            >
              <PlyViewer
                ref={plyViewerCallbackRef}
                plyEntries={plyEntries}
                cadModels={cadModels}
                onCameraSettled={handleCameraSettled}
                pcdUrls={pcdEntries}
                elements={elements}
                ndtMeasurements={ndtMeasurements}
                defects={defectsViewModel.defects}
                droneImages={droneImages}
                onHitSelected={setSelection}
                groundPlane={area?.groundPlane}
                initialCameraPose={
                  cameraParamPose ??
                  (area?.initialCameraPosition && area?.initialCameraTarget
                    ? { position: area.initialCameraPosition, target: area.initialCameraTarget }
                    : undefined)
                }
              />
            </Suspense>
          )}

          {!isLoading && !error && hasModel && (
            <SegmentLegend cadModels={cadModels} className="absolute bottom-4 left-4" />
          )}

          {!isLoading && !error && area != null && cadModelsResult.isError && (
            <div
              className="absolute left-4 top-4 max-w-md rounded-lg bg-black/60 px-4 py-3 text-sm text-white backdrop-blur-sm"
              data-testid="cad-model-load-error"
              role="alert"
            >
              Couldn't load the 3D models: {cadModelsResult.error.message}. Reload the page; if it keeps
              failing, check that your account can read CDF 3D models.
            </div>
          )}

          {!isLoading && !error && area != null && hasModel && campaignsWithoutModel && (
            <MissingCadModelNotice
              waitingCampaignIds={waitingCampaignIds}
              processingCampaignIds={processingCampaignIds}
              className="absolute left-4 top-4 max-w-md"
            />
          )}

          {!isLoading && !error && area != null && !hasModel && !cadModelsResult.isError && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              {campaignsWithoutModel ? (
                <MissingCadModelNotice
                  waitingCampaignIds={waitingCampaignIds}
                  processingCampaignIds={processingCampaignIds}
                />
              ) : (
                <>
                  <p className="text-base font-medium text-foreground">No scan data yet</p>
                  <p className="mt-1 max-w-md text-sm text-muted-foreground">
                    Robots with <code className="font-mono">autoassess_bridge</code> upload after each
                    mission; or run <code className="font-mono">dss campaign upload &lt;folder&gt;</code>.
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        {/* Right panel — tabbed: Layers, Plans, Defects */}
        <ViewerRightPanel
          layerPanelViewModel={layerPanelViewModel}
          editCampaignViewModel={editCampaignViewModel}
          inspectionPlansViewModel={plansViewModel}
          defectsPanelViewModel={defectsViewModel}
          activeTab={rightPanelTab}
          onTabChange={setRightPanelTab}
          onDefectSelected={handleDefectHit}
          onTaskSelected={handleTaskSelected}
          onTaskHovered={(task) => plyViewerRef.current?.hoverTask(task)}
          onViewReport={(campaignId) =>
            navigate(`/vessels/${vesselId}/areas/${areaId}/report/${campaignId}`)
          }
          areaSpace={AUTOASSESS_SPACE}
          areaExternalId={areaId}
        />
      </main>

      <ViewerControlsModal
        open={controlsModalOpen}
        onOpenChange={setControlsModalOpen}
        onResetRoll={() => plyViewerRef.current?.resetRoll()}
      />
      <AreaSettingsModal
        open={areaSettingsModalOpen}
        onOpenChange={setAreaSettingsModalOpen}
        defaultCameraPose={
          area?.initialCameraPosition && area?.initialCameraTarget
            ? { position: area.initialCameraPosition, target: area.initialCameraTarget }
            : undefined
        }
        isSaving={setDefaultCameraPoseMutation.isPending}
        onResetToDefaultPose={() => {
          const p = area?.initialCameraPosition;
          const t = area?.initialCameraTarget;
          if (p && t) plyViewerRef.current?.flyToExactPose(new Vector3(...p), new Vector3(...t));
        }}
        onSaveCurrentAsPose={() => {
          const pose = plyViewerRef.current?.getCurrentCameraPose();
          if (pose) setDefaultCameraPoseMutation.mutate(pose);
        }}
      />
    </div>
  );
}
