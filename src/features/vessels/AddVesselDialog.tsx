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
import { useCreateVessel } from './useMutateVessel';

interface AddVesselDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddVesselDialog({ open, onOpenChange }: AddVesselDialogProps) {
  const [name, setName] = useState('');
  const [vesselType, setVesselType] = useState('');
  const createVessel = useCreateVessel();

  const isValid = name.trim().length > 0 && vesselType.trim().length > 0;

  function handleSubmit() {
    createVessel.mutate(
      { name: name.trim(), vesselType: vesselType.trim() },
      {
        onSuccess: () => {
          setName('');
          setVesselType('');
          onOpenChange(false);
        },
      },
    );
  }

  const errorMessage = createVessel.isError
    ? `Failed to add vessel: ${createVessel.error.message}`
    : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add vessel</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="vessel-name">Name</Label>
            <Input
              id="vessel-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. MV Atlantic Star"
              disabled={createVessel.isPending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="vessel-type">Vessel type</Label>
            <Input
              id="vessel-type"
              value={vesselType}
              onChange={(e) => setVesselType(e.target.value)}
              placeholder="e.g. Bulk Carrier"
              disabled={createVessel.isPending}
              errorMessage={errorMessage}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            disabled={!isValid || createVessel.isPending}
            onClick={handleSubmit}
          >
            {createVessel.isPending ? 'Adding…' : 'Add vessel'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
