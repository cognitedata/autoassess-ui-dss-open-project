import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Loader,
} from '@cognite/aura/components';

import type { FileModelStatus } from '../reveal/CampaignCadModelService';

import type { CampaignFileRow, EditCampaignViewModel } from './useEditCampaignViewModel';

const MODEL_STATUS: Record<FileModelStatus, { text: string; variant: 'success' | 'inProgress' | 'error' | 'secondary' | 'gray' }> = {
  ready: { text: '3D model ready', variant: 'success' },
  processing: { text: '3D model processing', variant: 'inProgress' },
  failed: { text: '3D processing failed', variant: 'error' },
  'campaign-model': { text: "In the campaign's 3D model", variant: 'secondary' },
  none: { text: 'Waiting for dss worker', variant: 'gray' },
};

export function EditCampaignDialog({ viewModel: vm }: { viewModel: EditCampaignViewModel }) {
  const meshes = vm.files.filter((f) => f.kind === 'mesh');
  const pointClouds = vm.files.filter((f) => f.kind === 'pointcloud');
  return (
    <Dialog open={vm.isOpen} onOpenChange={(open) => !open && vm.close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{vm.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="campaign-date">Campaign date</Label>
            <Input
              id="campaign-date"
              value={vm.campaignDate}
              onChange={(e) => vm.setCampaignDate(e.target.value)}
              placeholder="YYYY-MM-DD"
              disabled={vm.isSaving}
            />
            {vm.dateError && <p className="text-sm text-destructive">{vm.dateError}</p>}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Files</p>
            <p className="text-xs text-muted-foreground">
              A file belongs to one campaign; picking one from another campaign moves it here, with its
              3D model. Files and models are never changed or deleted.
            </p>
            {vm.isLoadingFiles && <Loader role="status" size={20} />}
            {vm.filesError && (
              <p className="text-sm text-destructive">Couldn&apos;t load the area&apos;s files: {vm.filesError.message}</p>
            )}
            {!vm.isLoadingFiles && !vm.filesError && vm.files.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No uploaded meshes or point clouds in this area yet.
              </p>
            )}
            <div className="max-h-72 space-y-3 overflow-y-auto">
              <FileGroup title="Meshes" rows={meshes} onToggle={vm.toggleFile} disabled={vm.isSaving} />
              <FileGroup title="Point clouds" rows={pointClouds} onToggle={vm.toggleFile} disabled={vm.isSaving} />
            </div>
          </div>

          {vm.saveError && (
            <p className="text-sm text-destructive">Couldn&apos;t save the campaign: {vm.saveError.message}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={vm.close} disabled={vm.isSaving}>
            Cancel
          </Button>
          <Button disabled={!vm.canSave} onClick={() => void vm.save()}>
            {vm.isSaving ? 'Saving…' : vm.mode === 'create' ? 'Create campaign' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FileGroup({
  title,
  rows,
  onToggle,
  disabled,
}: {
  title: string;
  rows: CampaignFileRow[];
  onToggle: (fileId: number) => void;
  disabled: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <fieldset>
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</legend>
      <ul className="space-y-1">
        {rows.map((row) => {
          const id = `campaign-file-${row.fileId}`;
          const status = row.modelStatus ? MODEL_STATUS[row.modelStatus] : null;
          return (
            <li key={row.fileId} className="flex items-start gap-2 rounded px-1 py-1 hover:bg-accent">
              <input
                id={id}
                type="checkbox"
                className="mt-1"
                checked={row.selected}
                disabled={disabled}
                onChange={() => onToggle(row.fileId)}
              />
              <label htmlFor={id} className="flex min-w-0 flex-1 flex-col text-sm">
                <span className="truncate">{row.label ?? row.name}</span>
                {row.label && <span className="truncate text-xs text-muted-foreground">{row.name}</span>}
                {row.otherCampaignLabel && (
                  <span className="text-xs text-muted-foreground">
                    {row.selected ? `Moves here from ${row.otherCampaignLabel}` : `In ${row.otherCampaignLabel}`}
                  </span>
                )}
              </label>
              {status && <Badge variant={status.variant}>{status.text}</Badge>}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
