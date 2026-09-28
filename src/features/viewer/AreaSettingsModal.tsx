import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@cognite/aura/components';

interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
}

export interface AreaSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultCameraPose?: CameraPose;
  isSaving: boolean;
  onResetToDefaultPose: () => void;
  onSaveCurrentAsPose: () => void;
}

function formatCoord(v: number): string {
  return v.toFixed(2);
}

function PoseDisplay({ pose }: { pose: CameraPose }) {
  const [px, py, pz] = pose.position;
  const [tx, ty, tz] = pose.target;
  return (
    <div className="rounded-md bg-muted/40 p-3 font-mono text-xs text-muted-foreground space-y-1">
      <div>
        <span className="font-semibold text-foreground">Position</span>{' '}
        ({formatCoord(px)}, {formatCoord(py)}, {formatCoord(pz)})
      </div>
      <div>
        <span className="font-semibold text-foreground">Target</span>{' '}
        ({formatCoord(tx)}, {formatCoord(ty)}, {formatCoord(tz)})
      </div>
    </div>
  );
}

export function AreaSettingsModal({
  open,
  onOpenChange,
  defaultCameraPose,
  isSaving,
  onResetToDefaultPose,
  onSaveCurrentAsPose,
}: AreaSettingsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Area settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-2">
          <section>
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Starting view
            </h3>

            <div className="mb-3">
              {defaultCameraPose ? (
                <PoseDisplay pose={defaultCameraPose} />
              ) : (
                <p className="text-sm text-muted-foreground">Automatic (fit to model)</p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Go to saved starting view</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!defaultCameraPose}
                  onClick={onResetToDefaultPose}
                >
                  Return to starting view
                </Button>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Save current camera as starting view</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isSaving}
                  onClick={onSaveCurrentAsPose}
                >
                  Set current view as default
                </Button>
              </div>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
