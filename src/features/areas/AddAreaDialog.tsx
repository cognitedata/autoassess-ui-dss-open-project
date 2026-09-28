import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@cognite/aura/components';
import { useCreateArea } from './useMutateArea';

interface AddAreaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vesselSpace: string;
  vesselExternalId: string;
}

export function AddAreaDialog({ open, onOpenChange, vesselSpace, vesselExternalId }: AddAreaDialogProps) {
  const [name, setName] = useState('');
  const [areaType, setAreaType] = useState('');
  const createArea = useCreateArea(vesselSpace, vesselExternalId);

  const isValid = name.trim().length > 0 && areaType.trim().length > 0;

  function handleSubmit() {
    createArea.mutate(
      { name: name.trim(), areaType: areaType.trim() },
      {
        onSuccess: () => {
          setName('');
          setAreaType('');
          onOpenChange(false);
        },
      },
    );
  }

  const errorMessage = createArea.isError
    ? `Failed to add area: ${createArea.error.message}`
    : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add area</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="area-name">Name</Label>
            <Input
              id="area-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ballast Water Tank 01"
              disabled={createArea.isPending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="area-type">Area type</Label>
            <Input
              id="area-type"
              value={areaType}
              onChange={(e) => setAreaType(e.target.value)}
              placeholder="e.g. BWT"
              disabled={createArea.isPending}
              errorMessage={errorMessage}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            disabled={!isValid || createArea.isPending}
            onClick={handleSubmit}
          >
            {createArea.isPending ? 'Adding…' : 'Add area'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
