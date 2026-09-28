import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@cognite/aura/components';

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityName: string;
  entityKind: 'vessel' | 'area' | 'defect' | 'plan';
  isDeleting: boolean;
  onConfirm(): void;
}

const DESCRIPTIONS: Record<'vessel' | 'area' | 'defect' | 'plan', string> = {
  vessel:
    'and all its areas will be hidden from the app. All inspection data is preserved in CDF.',
  area: 'will be hidden from the app. Inspection campaigns, measurements, and defect detections are preserved in CDF.',
  defect: 'will be permanently deleted from CDF. This action cannot be undone.',
  plan: 'will be hidden from the app, and all of its inspection tasks will be permanently deleted. This cannot be undone.',
};

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  entityName,
  entityKind,
  isDeleting,
  onConfirm,
}: DeleteConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {entityKind}?</DialogTitle>
          <DialogDescription>
            <span className="font-medium">{entityName}</span> {DESCRIPTIONS[entityKind]}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isDeleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isDeleting}>
            {isDeleting ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
