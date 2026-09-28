import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { Button, Loader } from '@cognite/aura/components';
import { IconArrowsMaximize } from '@tabler/icons-react';
import { cn } from '../../lib/utils';
import { DeleteConfirmDialog } from '../../shared/components/DeleteConfirmDialog';
import type { SelectionHit } from './selection';
import type { InspectionPlan } from './InspectionPlanService';
import { INSPECTION_TYPE_LABELS, INSPECTION_TYPES } from './InspectionTaskService';
import type { InspectionType } from './InspectionTaskService';
import type { DefectUpdates, DefectStatus } from './DefectDetectionService';

const STATUS_LABELS: Record<DefectStatus, string> = {
  New: 'New',
  UnderReview: 'Under Review',
  Confirmed: 'Confirmed',
  Dismissed: 'Dismissed',
};
const ALL_DEFECT_STATUSES: DefectStatus[] = ['New', 'UnderReview', 'Confirmed', 'Dismissed'];

interface SelectionPanelProps {
  hit: SelectionHit | null;
  onClose: () => void;
  /** The currently active plan, if any. */
  activePlan?: InspectionPlan | null;
  /** Called when the user confirms adding the current selection to the active plan. */
  onAddToActivePlan?: (inspectionType: InspectionType) => void;
  /** Called when the user clicks the link to open the Plans tab. */
  onOpenPlansTab?: () => void;
  /** Disables the add button while a task is being persisted. */
  isAddingTask?: boolean;
  /** Called when the user confirms deleting the selected task. */
  onDeleteTask?: () => void;
  /** Disables the delete button while deletion is in flight. */
  isDeletingTask?: boolean;
  /** Called when the user clicks the "Fly to" button for a task. */
  onFlyToTask?: () => void;
  /** Called when the user edits a defect field. */
  onUpdateDefect?: (updates: DefectUpdates) => void;
  /** Called when the user clicks the "Fly to" button for a defect. */
  onFlyToDefect?: () => void;
  /** Called when the user confirms deleting the selected defect. */
  onDeleteDefect?: () => void;
  /** True while a defect update is in flight. */
  isUpdatingDefect?: boolean;
  /** True while a defect deletion is in flight. */
  isDeletingDefect?: boolean;
  /** Called when the user clicks "Fly to" for a surface region hit. */
  onFlyToRegion?: () => void;
  /** Called when the user designates the selected surface as the ground plane for this area. */
  onSetGroundPlane?: () => void;
  /** Called when the user submits the "Add defect" form in a region hit. */
  onCreateDefect?: (defectClass: string, probability: number) => void;
  /** True while a defect creation is in flight. */
  isCreatingDefect?: boolean;
  /** CDF download URL for the currently selected drone image. */
  imageDownloadUrl?: string;
  /** True while the download URL is being fetched. */
  isLoadingImageUrl?: boolean;
  /** Called when the user clicks "Fly to" for a drone image. */
  onFlyToImage?: () => void;
  /** Called on mousemove over the drone image with image-space pixel coordinates. */
  onHoverImagePixel?: (u: number, v: number) => void;
  /** Called when the mouse leaves the drone image. */
  onHoverImageExit?: () => void;
  /** Called on double-click on the drone image with image-space pixel coordinates. */
  onSelectImagePixel?: (u: number, v: number) => void;
}

export function SelectionPanel({
  hit,
  onClose,
  activePlan,
  onAddToActivePlan,
  onOpenPlansTab,
  isAddingTask = false,
  onDeleteTask,
  isDeletingTask = false,
  onFlyToTask,
  onFlyToDefect,
  onUpdateDefect,
  onDeleteDefect,
  isUpdatingDefect = false,
  isDeletingDefect = false,
  onFlyToRegion,
  onSetGroundPlane,
  onCreateDefect,
  isCreatingDefect = false,
  imageDownloadUrl,
  isLoadingImageUrl = false,
  onFlyToImage,
  onHoverImagePixel,
  onHoverImageExit,
  onSelectImagePixel,
}: SelectionPanelProps) {
  const heading =
    hit?.kind === 'element'
      ? hit.element.elementType
      : hit?.kind === 'ndt'
        ? 'NDT Measurement'
        : hit?.kind === 'task'
          ? 'Inspection Task'
          : hit?.kind === 'defect'
            ? 'Defect'
            : hit?.kind === 'image'
              ? 'Drone Image'
              : 'Surface Position';

  return (
    <div
      data-testid="selection-panel"
      className={cn(
        'absolute left-0 top-0 z-10 h-full w-[300px] overflow-y-auto',
        'bg-background/90 backdrop-blur-sm border-r border-border',
        'transition-transform duration-300',
        hit !== null ? 'translate-x-0' : '-translate-x-full',
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold" role="heading">
          {heading}
        </h2>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close panel">
          ×
        </Button>
      </div>
      <div className="p-4 text-sm">
        {hit?.kind === 'region' && (
          <RegionContent
            hit={hit}
            onFlyToRegion={onFlyToRegion}
            onSetGroundPlane={onSetGroundPlane}
            onCreateDefect={onCreateDefect}
            isCreatingDefect={isCreatingDefect}
          />
        )}
        {hit?.kind === 'element' && <ElementContent hit={hit} />}
        {hit?.kind === 'ndt' && <NdtContent hit={hit} />}
        {hit?.kind === 'task' && (
          <TaskContent
            hit={hit}
            activePlan={activePlan ?? null}
            onDeleteTask={onDeleteTask}
            isDeletingTask={isDeletingTask}
            onFlyToTask={onFlyToTask}
          />
        )}
        {hit?.kind === 'defect' && (
          <DefectContent
            key={hit.defect.externalId}
            hit={hit}
            onFlyToDefect={onFlyToDefect}
            onUpdateDefect={onUpdateDefect}
            onDeleteDefect={onDeleteDefect}
            isUpdatingDefect={isUpdatingDefect}
            isDeletingDefect={isDeletingDefect}
          />
        )}
        {hit?.kind === 'image' && (
          <ImageContent
            hit={hit}
            downloadUrl={imageDownloadUrl}
            isLoadingUrl={isLoadingImageUrl}
            onFlyToImage={onFlyToImage}
            onHoverImagePixel={onHoverImagePixel}
            onHoverImageExit={onHoverImageExit}
            onSelectImagePixel={onSelectImagePixel}
          />
        )}

        {hit !== null && hit.kind !== 'ndt' && hit.kind !== 'task' && hit.kind !== 'image' && onAddToActivePlan !== undefined && (
          <PanelSection title="Inspection plan">
            <AddToPlanSection
              activePlan={activePlan ?? null}
              onAddToActivePlan={onAddToActivePlan}
              onOpenPlansTab={onOpenPlansTab}
              isAddingTask={isAddingTask}
            />
          </PanelSection>
        )}
      </div>
    </div>
  );
}

// ---- Section layout ----

interface PanelSectionProps {
  title: string;
  children: ReactNode;
  'aria-label'?: string;
}

function PanelSection({ title, children, 'aria-label': ariaLabel }: PanelSectionProps) {
  return (
    <section
      aria-label={ariaLabel}
      className="mt-6 border-t border-border pt-4 first:mt-0 first:border-0 first:pt-0"
    >
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {children}
    </section>
  );
}

// ---- Region content ----

interface RegionContentProps {
  hit: Extract<SelectionHit, { kind: 'region' }>;
  onFlyToRegion?: () => void;
  onSetGroundPlane?: () => void;
  onCreateDefect?: (defectClass: string, probability: number) => void;
  isCreatingDefect?: boolean;
}

function RegionContent({ hit, onFlyToRegion, onSetGroundPlane, onCreateDefect, isCreatingDefect = false }: RegionContentProps) {
  const { position, normal } = hit;
  const [defectClass, setDefectClass] = useState('');
  const [confidence, setConfidence] = useState(80);

  return (
    <>
      <PanelSection title="Position">
        <LocationSection
          position={[position.x, position.y, position.z]}
          normal={[normal.x, normal.y, normal.z]}
        />
      </PanelSection>

      {(onFlyToRegion ?? onSetGroundPlane) && (
        <PanelSection title="Actions">
          <div className="flex flex-col gap-2">
            {onFlyToRegion && (
              <Button variant="outline" size="sm" className="w-full" onClick={onFlyToRegion}>
                Fly to
              </Button>
            )}
            {onSetGroundPlane && (
              <Button variant="outline" size="sm" className="w-full" onClick={onSetGroundPlane}>
                Set as ground plane
              </Button>
            )}
          </div>
        </PanelSection>
      )}

      {onCreateDefect !== undefined && (
        <PanelSection title="Add defect" aria-label="Add defect">
          <div className="flex flex-col gap-2">
            <input
              type="text"
              placeholder="Defect class (e.g. corrosion)"
              value={defectClass}
              onChange={(e) => setDefectClass(e.target.value)}
              aria-label="Defect class"
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground"
            />
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground w-24 shrink-0">Confidence %</label>
              <input
                type="number"
                min={0}
                max={100}
                value={confidence}
                onChange={(e) => setConfidence(Math.max(0, Math.min(100, Number(e.target.value))))}
                aria-label="Confidence percentage"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground"
              />
            </div>
            <Button
              variant="default"
              size="sm"
              className="w-full"
              disabled={isCreatingDefect || defectClass.trim() === ''}
              onClick={() => onCreateDefect(defectClass.trim(), confidence / 100)}
            >
              {isCreatingDefect ? 'Adding…' : 'Add defect'}
            </Button>
          </div>
        </PanelSection>
      )}
    </>
  );
}

// ---- Element content ----

function ElementContent({ hit }: { hit: Extract<SelectionHit, { kind: 'element' }> }) {
  const { element } = hit;
  return (
    <>
      <PanelSection title="Details">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
          <dt>Type</dt><dd>{element.elementType}</dd>
          <dt>Label</dt><dd>{element.label}</dd>
        </dl>
      </PanelSection>
      <PanelSection title="Position">
        <LocationSection position={element.center as [number, number, number]} />
      </PanelSection>
    </>
  );
}

// ---- Shared location display ----

interface LocationSectionProps {
  position: [number, number, number] | null | undefined;
  normal?: [number, number, number] | null;
}

function LocationSection({ position, normal }: LocationSectionProps) {
  const fmt = (v: number | undefined) => (v !== undefined ? v.toFixed(3) : '—');
  const [px, py, pz] = position ?? [];
  const [nx, ny, nz] = normal ?? [];
  return (
    <>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        <dt>X</dt><dd>{fmt(px)}</dd>
        <dt>Y</dt><dd>{fmt(py)}</dd>
        <dt>Z</dt><dd>{fmt(pz)}</dd>
      </dl>
      {normal !== undefined && (
        <>
          <p className="mb-2 mt-4 font-medium text-muted-foreground">Normal</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            <dt>NX</dt><dd>{fmt(nx)}</dd>
            <dt>NY</dt><dd>{fmt(ny)}</dd>
            <dt>NZ</dt><dd>{fmt(nz)}</dd>
          </dl>
        </>
      )}
    </>
  );
}

// ---- NDT content ----

function NdtContent({ hit }: { hit: Extract<SelectionHit, { kind: 'ndt' }> }) {
  const { measurement } = hit;
  return (
    <>
      <PanelSection title="Measurement">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
          <dt>Timestamp</dt><dd>{new Date(measurement.timestamp).toLocaleString()}</dd>
          <dt>Thickness</dt><dd>{measurement.thicknessMm.toFixed(1)} mm</dd>
        </dl>
      </PanelSection>
      <PanelSection title="Position">
        <LocationSection position={measurement.position3d} />
      </PanelSection>
    </>
  );
}

// ---- Task content ----

interface TaskContentProps {
  hit: Extract<SelectionHit, { kind: 'task' }>;
  activePlan: InspectionPlan | null;
  onDeleteTask?: () => void;
  isDeletingTask: boolean;
  onFlyToTask?: () => void;
}

function TaskContent({ hit, activePlan, onDeleteTask, isDeletingTask, onFlyToTask }: TaskContentProps) {
  const { task } = hit;
  const typeLabel = INSPECTION_TYPE_LABELS[task.inspectionType] ?? task.inspectionType;
  const showDeleteTask = activePlan?.status === 'Draft' && onDeleteTask !== undefined;
  const showActions = onFlyToTask !== undefined || showDeleteTask;

  return (
    <>
      <PanelSection title="Details">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
          <dt>Type</dt><dd>{typeLabel}</dd>
          <dt>Kind</dt><dd>{task.taskKind}</dd>
          {task.taskKind === 'element' && (
            <>
              <dt>Element</dt><dd className="truncate">{task.targetElementExternalId ?? '—'}</dd>
            </>
          )}
        </dl>
      </PanelSection>
      {task.taskKind === 'region' && (
        <PanelSection title="Position">
          <LocationSection
            position={task.position3d as [number, number, number] | undefined}
            normal={task.normalVector as [number, number, number] | null | undefined}
          />
        </PanelSection>
      )}
      {showActions && (
        <PanelSection title="Actions">
          <div className="flex flex-col gap-2">
            {onFlyToTask && (
              <Button variant="outline" size="sm" className="w-full" onClick={onFlyToTask}>
                Fly to
              </Button>
            )}
            {showDeleteTask && (
              <Button
                variant="destructive"
                size="sm"
                className="w-full"
                onClick={onDeleteTask}
                disabled={isDeletingTask}
              >
                {isDeletingTask ? 'Deleting…' : 'Delete task'}
              </Button>
            )}
          </div>
        </PanelSection>
      )}
    </>
  );
}

// ---- Defect content ----

interface DefectContentProps {
  hit: Extract<SelectionHit, { kind: 'defect' }>;
  onFlyToDefect?: () => void;
  onUpdateDefect?: (updates: DefectUpdates) => void;
  onDeleteDefect?: () => void;
  isUpdatingDefect: boolean;
  isDeletingDefect: boolean;
}

function DefectContent({ hit, onFlyToDefect, onUpdateDefect, onDeleteDefect, isUpdatingDefect, isDeletingDefect }: DefectContentProps) {
  const { defect } = hit;
  const [defectClass, setDefectClass] = useState(defect.defectClass);
  const [confidence, setConfidence] = useState(Math.round(defect.probability * 100));
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const sourceBadge = defect.source === 'manual' ? 'Manual' : 'ML';

  const handleClassBlur = () => {
    const trimmed = defectClass.trim();
    if (trimmed && trimmed !== defect.defectClass) {
      onUpdateDefect?.({ defectClass: trimmed });
    }
  };

  const handleConfidenceBlur = () => {
    const prob = Math.max(0, Math.min(100, confidence)) / 100;
    if (prob !== defect.probability) {
      onUpdateDefect?.({ probability: prob });
    }
  };

  const position = defect.boundingBox3d.length >= 3
    ? [defect.boundingBox3d[0], defect.boundingBox3d[1], defect.boundingBox3d[2]] as [number, number, number]
    : null;

  const showActions = onFlyToDefect !== undefined || onDeleteDefect !== undefined;

  return (
    <>
      <PanelSection title="Defect">
        <div className="flex flex-col gap-3">
          <div>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {sourceBadge}
            </span>
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Defect class</label>
            <input
              type="text"
              value={defectClass}
              onChange={(e) => setDefectClass(e.target.value)}
              onBlur={handleClassBlur}
              disabled={isUpdatingDefect}
              aria-label="Defect class"
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Confidence %</label>
            <input
              type="number"
              min={0}
              max={100}
              value={confidence}
              onChange={(e) => setConfidence(Math.max(0, Math.min(100, Number(e.target.value))))}
              onBlur={handleConfidenceBlur}
              disabled={isUpdatingDefect}
              aria-label="Confidence percentage"
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground"
            />
          </div>

          <div>
            <p className="mb-1 text-xs text-muted-foreground">Status</p>
            <div className="flex flex-wrap gap-1" aria-label="Update defect status">
              {ALL_DEFECT_STATUSES.map((s) => (
                <Button
                  key={s}
                  variant={defect.status === s ? 'default' : 'outline'}
                  size="sm"
                  disabled={isUpdatingDefect}
                  onClick={() => onUpdateDefect?.({ status: s })}
                  aria-label={`Set status to ${STATUS_LABELS[s]}`}
                  aria-pressed={defect.status === s}
                >
                  {STATUS_LABELS[s]}
                </Button>
              ))}
            </div>
          </div>

          {(defect.createdTime ?? defect.lastUpdatedTime) && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {defect.createdTime && (
                <>
                  <dt>Created</dt>
                  <dd>{defect.createdTime.toLocaleString()}</dd>
                </>
              )}
              {defect.lastUpdatedTime && (
                <>
                  <dt>Updated</dt>
                  <dd>{defect.lastUpdatedTime.toLocaleString()}</dd>
                </>
              )}
            </dl>
          )}
        </div>
      </PanelSection>

      <PanelSection title="Position">
        <LocationSection position={position} normal={defect.normal3d ?? null} />
      </PanelSection>

      {showActions && (
        <PanelSection title="Actions">
          <div className="flex flex-col gap-2">
            {onFlyToDefect && (
              <Button variant="outline" size="sm" className="w-full" onClick={onFlyToDefect}>
                Fly to
              </Button>
            )}
            {onDeleteDefect !== undefined && (
              <>
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full"
                  onClick={() => setDeleteDialogOpen(true)}
                  disabled={isDeletingDefect}
                  aria-label="Delete defect"
                >
                  {isDeletingDefect ? 'Deleting…' : 'Delete defect'}
                </Button>
                <DeleteConfirmDialog
                  open={deleteDialogOpen}
                  onOpenChange={setDeleteDialogOpen}
                  entityName={defect.defectClass || 'Defect'}
                  entityKind="defect"
                  isDeleting={isDeletingDefect}
                  onConfirm={() => {
                    setDeleteDialogOpen(false);
                    onDeleteDefect();
                  }}
                />
              </>
            )}
          </div>
        </PanelSection>
      )}
    </>
  );
}

// ---- Image content ----

/** Convert quaternion [qx, qy, qz, qw] to yaw/pitch/roll in degrees (Z-Y-X convention). */
function quatToEulerDeg(qx: number, qy: number, qz: number, qw: number): [number, number, number] {
  const yaw   = Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz)) * (180 / Math.PI);
  const pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (qw * qy - qz * qx)))) * (180 / Math.PI);
  const roll  = Math.atan2(2 * (qw * qx + qy * qz), 1 - 2 * (qx * qx + qy * qy)) * (180 / Math.PI);
  return [yaw, pitch, roll];
}

function ImageContent({
  hit,
  downloadUrl,
  isLoadingUrl = false,
  onFlyToImage,
  onHoverImagePixel,
  onHoverImageExit,
  onSelectImagePixel,
}: {
  hit: Extract<SelectionHit, { kind: 'image' }>;
  downloadUrl?: string;
  isLoadingUrl?: boolean;
  onFlyToImage?: () => void;
  onHoverImagePixel?: (u: number, v: number) => void;
  onHoverImageExit?: () => void;
  onSelectImagePixel?: (u: number, v: number) => void;
}) {
  const { image } = hit;
  const [yaw, pitch, roll] = quatToEulerDeg(
    image.orientationQuat[0],
    image.orientationQuat[1],
    image.orientationQuat[2],
    image.orientationQuat[3],
  );
  const timestamp = new Date(image.timestamp * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const fmt = (v: number) => v.toFixed(2);

  const [hoverDot, setHoverDot] = useState<{ x: number; y: number } | null>(null);
  const [enlarged, setEnlarged] = useState(false);
  // Prevent stale closure in callbacks by always reading the latest image ref
  const imageRef = useRef(image);
  imageRef.current = image;

  const hasPixelCallbacks = Boolean(onHoverImagePixel ?? onHoverImageExit ?? onSelectImagePixel);

  function getImageCoords(e: React.MouseEvent<HTMLImageElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const img = imageRef.current;
    const u = ((e.clientX - rect.left) / rect.width) * img.imageWidth;
    const v = ((e.clientY - rect.top) / rect.height) * img.imageHeight;
    return { u, v, x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handleMouseMove(e: React.MouseEvent<HTMLImageElement>) {
    const { u, v, x, y } = getImageCoords(e);
    setHoverDot({ x, y });
    onHoverImagePixel?.(u, v);
  }

  function handleMouseLeave() {
    setHoverDot(null);
    onHoverImageExit?.();
  }

  function closeLightbox() {
    setEnlarged(false);
    setHoverDot(null);
    onHoverImageExit?.();
  }

  const hoverDotEl = hoverDot ? (
    <div
      className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-yellow-400 bg-yellow-400/30"
      style={{ left: hoverDot.x, top: hoverDot.y }}
    />
  ) : null;

  return (
    <>
      <PanelSection title="Image">
        {isLoadingUrl ? (
          <div className="flex h-32 items-center justify-center rounded-md border border-border bg-muted">
            <Loader size={16} role="status" />
          </div>
        ) : downloadUrl ? (
          <>
            <div className="relative w-full">
              <img
                src={downloadUrl}
                alt={`Drone frame ${image.frameId}`}
                className={cn('w-full rounded-md border border-border', hasPixelCallbacks && 'cursor-crosshair')}
                onMouseMove={hasPixelCallbacks ? handleMouseMove : undefined}
                onMouseLeave={hasPixelCallbacks ? handleMouseLeave : undefined}
                onDoubleClick={onSelectImagePixel ? (e) => {
                  const { u, v } = getImageCoords(e);
                  onSelectImagePixel(u, v);
                } : undefined}
              />
              {hoverDotEl}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full"
              onClick={() => setEnlarged(true)}
            >
              <IconArrowsMaximize size={14} aria-hidden />
              Enlarge
            </Button>
          </>
        ) : (
          <div className="flex h-32 items-center justify-center rounded-md border border-border bg-muted text-xs text-muted-foreground">
            Image unavailable
          </div>
        )}
      </PanelSection>

      {enlarged && downloadUrl && createPortal(
        <div
          role="dialog"
          aria-modal={true}
          aria-label="Enlarged drone image"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={(e) => { if (e.target === e.currentTarget) closeLightbox(); }}
        >
          <div className="relative max-h-[95vh] max-w-[95vw]">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Close enlarged view"
              className="absolute right-2 top-2 z-10 text-white"
              onClick={closeLightbox}
            >
              ×
            </Button>
            <div className="relative">
              <img
                src={downloadUrl}
                alt={`Drone frame ${image.frameId}`}
                className={cn('max-h-[95vh] max-w-[95vw] rounded object-contain', hasPixelCallbacks && 'cursor-crosshair')}
                onMouseMove={hasPixelCallbacks ? handleMouseMove : undefined}
                onMouseLeave={hasPixelCallbacks ? handleMouseLeave : undefined}
                onDoubleClick={onSelectImagePixel ? (e) => {
                  const { u, v } = getImageCoords(e);
                  onSelectImagePixel(u, v);
                  closeLightbox();
                } : undefined}
              />
              {hoverDotEl}
            </div>
          </div>
        </div>,
        document.body,
      )}
      <PanelSection title="Metadata">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
          <dt>Frame</dt><dd>{image.frameId}</dd>
          <dt>Timestamp</dt><dd className="col-span-1 break-all text-xs">{timestamp}</dd>
        </dl>
      </PanelSection>
      <PanelSection title="Position">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
          <dt>X</dt><dd>{fmt(image.position[0])} m</dd>
          <dt>Y</dt><dd>{fmt(image.position[1])} m</dd>
          <dt>Z</dt><dd>{fmt(image.position[2])} m</dd>
        </dl>
      </PanelSection>
      <PanelSection title="Orientation">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
          <dt>Yaw</dt><dd>{fmt(yaw)}°</dd>
          <dt>Pitch</dt><dd>{fmt(pitch)}°</dd>
          <dt>Roll</dt><dd>{fmt(roll)}°</dd>
        </dl>
      </PanelSection>
      {onFlyToImage && (
        <PanelSection title="Actions">
          <Button variant="outline" size="sm" className="w-full" onClick={onFlyToImage}>
            Fly to
          </Button>
        </PanelSection>
      )}
    </>
  );
}

// ---- Add to plan section ----

interface AddToPlanSectionProps {
  activePlan: InspectionPlan | null;
  onAddToActivePlan: (inspectionType: InspectionType) => void;
  onOpenPlansTab?: () => void;
  isAddingTask: boolean;
}

function AddToPlanSection({
  activePlan,
  onAddToActivePlan,
  onOpenPlansTab,
  isAddingTask,
}: AddToPlanSectionProps) {
  const [selectedType, setSelectedType] = useState<InspectionType>(INSPECTION_TYPES[0]);

  if (!activePlan) {
    return (
      <div
        className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground"
        aria-label="No active plan notice"
      >
        No active inspection plan.{' '}
        {onOpenPlansTab && (
          <button
            type="button"
            onClick={onOpenPlansTab}
            className="underline text-foreground hover:text-primary"
            aria-label="Go to plans tab"
          >
            Go to Plans →
          </button>
        )}
      </div>
    );
  }

  if (activePlan.status !== 'Draft') {
    return (
      <div
        className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground"
        aria-label="Plan read-only notice"
      >
        Plan is read-only (status: {activePlan.status}).
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" aria-label="Add to plan">
      <p className="text-xs font-medium text-muted-foreground">Add to active plan</p>
      <select
        value={selectedType}
        onChange={(e) => setSelectedType(e.target.value as InspectionType)}
        aria-label="Inspection type"
        className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground"
      >
        {INSPECTION_TYPES.map((type) => (
          <option key={type} value={type}>
            {INSPECTION_TYPE_LABELS[type]}
          </option>
        ))}
      </select>
      <Button
        variant="default"
        size="sm"
        className="w-full"
        onClick={() => onAddToActivePlan(selectedType)}
        disabled={isAddingTask}
      >
        {isAddingTask ? 'Adding…' : 'Add to plan'}
      </Button>
    </div>
  );
}
